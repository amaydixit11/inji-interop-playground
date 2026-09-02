import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { RunConfig, RunEvent, StampedRunEvent } from '@interop/shared';
import { loadConfig } from './config.js';
import { Run } from './core/engine.js';
import { buildDocumentLoader, PLAYGROUND_CONTEXT, PLAYGROUND_CONTEXT_PATH, type DocumentLoader } from './core/jsonld.js';
import { getIssuerKey, getWalletKey } from './core/keys.js';
import { Registry } from './core/registry.js';
import { computeStats } from './core/stats.js';
import { RunStore } from './core/store.js';
import { createMockIssuer } from './services/mock-issuer.js';
import { createMockVerifier } from './services/mock-verifier.js';

const config = loadConfig();
const app = express();

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));

const issuerKey = () => getIssuerKey(config.publicUrl);
const walletKey = () => getWalletKey(config.publicUrl);

/**
 * The document loader is rebuilt lazily and cached, because it needs the
 * playground's own DID documents as static entries — resolving them over HTTP
 * would mean the server calling itself, which deadlocks under a single worker.
 */
let documentLoaderPromise: Promise<DocumentLoader> | undefined;
async function loadDocumentLoader(): Promise<DocumentLoader> {
  documentLoaderPromise ??= (async () => {
    const [issuer, wallet] = await Promise.all([issuerKey(), walletKey()]);
    return buildDocumentLoader({
      publicUrl: config.publicUrl,
      statics: {
        [issuer.did]: issuer.didDocument,
        [issuer.kid]: issuer.verificationMethod,
        [`${issuer.did}#jwk-1`]: (issuer.didDocument.verificationMethod as unknown[])[1],
        [issuer.mdocKid]: (issuer.didDocument.verificationMethod as unknown[])[2],
        [issuer.suiteKid2018]: issuer.verificationMethod2018,
        [issuer.rsaKid]: issuer.rsaKey.verificationMethod(),
        [wallet.did]: wallet.didDocument,
        [wallet.suiteKid]: wallet.suiteVerificationMethod,
        [wallet.kid]: (wallet.didDocument.verificationMethod as unknown[])[0],
      },
    });
  })();
  return documentLoaderPromise;
}

// Resolved eagerly at startup so adapters can take it synchronously.
let documentLoader: DocumentLoader = () => {
  throw new Error('Document loader is not ready yet');
};

const registry = new Registry({
  publicUrl: config.publicUrl,
  walletKey,
  documentLoader: () => documentLoader,
  env: config,
});

const store = new RunStore();
const activeRuns = new Map<string, Run>();
const sockets = new Set<WebSocket>();
/** Recent events, replayed to a client that connects mid-run. */
const eventLog = new Map<string, StampedRunEvent[]>();

function broadcast(event: RunEvent): void {
  const log = eventLog.get(event.runId) ?? [];
  // Stamped with its position so a client can discard anything it has already
  // applied, whether it arrived over the socket or in the catch-up log.
  const stamped: StampedRunEvent = { ...event, seq: log.length + 1 };
  log.push(stamped);
  eventLog.set(event.runId, log);

  const payload = JSON.stringify(stamped);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

/**
 * Rewrites a URL the playground published for itself onto loopback.
 *
 * Without this, a container whose published port differs from its listening
 * port cannot follow its own credential offer: the offer correctly names the
 * public address, which does not resolve from inside the container.
 */
function dialInternally(url: string): string {
  return url.startsWith(config.publicUrl) ? config.internalUrl + url.slice(config.publicUrl.length) : url;
}

/* --------------------------- Hosted participants -------------------------- */

app.use('/mock-issuer', createMockIssuer({
  publicUrl: config.publicUrl,
  basePath: '/mock-issuer',
  issuerKey,
  documentLoader: () => documentLoader,
}));

app.use('/mock-verifier', createMockVerifier({
  publicUrl: config.publicUrl,
  basePath: '/mock-verifier',
  documentLoader: () => documentLoader,
  resolveUrl: dialInternally,
}));

/* ----------------------------- Identity docs ------------------------------ */

// `did:web:host:issuer` resolves to `/issuer/did.json`, per the did:web method.
app.get('/issuer/did.json', async (_req, res) => {
  res.json((await issuerKey()).didDocument);
});

app.get('/wallet/did.json', async (_req, res) => {
  res.json((await walletKey()).didDocument);
});

app.get(PLAYGROUND_CONTEXT_PATH, (_req, res) => {
  res.type('application/ld+json').json(PLAYGROUND_CONTEXT);
});

/* --------------------------------- API ----------------------------------- */

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', publicUrl: config.publicUrl });
});

app.get('/api/participants', (_req, res) => {
  res.json({ participants: registry.participants(), publicUrl: config.publicUrl });
});

app.get('/api/runs', (_req, res) => {
  res.json({ runs: store.list() });
});

/** Aggregate view over the whole run history: success rates and latency. */
app.get('/api/stats', (_req, res) => {
  res.json(computeStats(store.list()));
});

app.get('/api/runs/:id', (req, res) => {
  const record = store.get(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(record);
});

/** Events emitted so far for a run, so a late-joining client can catch up. */
app.get('/api/runs/:id/events', (req, res) => {
  res.json({ events: eventLog.get(req.params.id) ?? [] });
});

app.post('/api/runs', async (req, res) => {
  const runConfig = req.body as RunConfig;

  let run: Run;
  try {
    run = new Run(
      runConfig,
      {
        issuer: registry.issuer(runConfig.issuerId),
        wallet: registry.wallet(runConfig.walletId),
        verifier: registry.verifier(runConfig.verifierId),
      },
      broadcast,
      dialInternally,
    );
  } catch (error) {
    res.status(400).json({ error: 'invalid_configuration', message: String(error) });
    return;
  }

  activeRuns.set(run.id, run);
  res.status(202).json({ runId: run.id });

  // Executed after responding: runs are long-lived and driven over the socket.
  run
    .execute()
    .then((record) => store.save(record))
    .catch((error) => {
      console.error(`Run ${run.id} crashed outside the engine:`, error);
    })
    .finally(() => activeRuns.delete(run.id));
});

/** Signals that a human has completed an out-of-band step (a QR scan). */
app.post('/api/runs/:id/actions/:actionId', (req, res) => {
  const run = activeRuns.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'not_found', message: 'No active run with that id' });
    return;
  }
  const resolved = run.resolveUserAction(req.params.actionId, req.body ?? {});
  if (!resolved) {
    res.status(409).json({ error: 'no_pending_action', message: 'That action is not currently awaited' });
    return;
  }
  res.json({ status: 'ok' });
});

app.post('/api/runs/:id/abort', (req, res) => {
  const run = activeRuns.get(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  run.abort('Aborted by the operator');
  res.json({ status: 'ok' });
});

/* --------------------------- verify-service proxy ------------------------- */

/**
 * Same-origin passthrough to the configured verify-service.
 *
 * MOSIP's own React SDK is a component library meant to be embedded in someone
 * else's relying-party page, but verify-service sends no CORS headers and
 * answers preflight with 403 — so a browser cannot call it from anywhere except
 * a page served from its own origin. A same-origin proxy is the workaround any
 * integrator ends up writing, so the playground writes it once and says so.
 *
 * Deliberately fixed to the configured target rather than taking a URL: an open
 * forwarder reachable from a browser is a liability, and nothing here needs one.
 */
app.use('/proxy/verify', async (req, res) => {
  const target = new URL(`.${req.url}`, `${config.verifyBaseUrl.replace(/\/$/, '')}/`).toString();

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        ...(req.header('content-type') ? { 'content-type': req.header('content-type') as string } : {}),
        ...(req.header('accept') ? { accept: req.header('accept') as string } : {}),
        // Forwarded so the cookie-correlated session API keeps working.
        ...(req.header('cookie') ? { cookie: req.header('cookie') as string } : {}),
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
    });

    const body = await upstream.text();
    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) res.setHeader('set-cookie', setCookie);

    res
      .status(upstream.status)
      .type(upstream.headers.get('content-type') ?? 'application/json')
      .send(body);
  } catch (error) {
    res.status(502).json({
      error: 'upstream_unreachable',
      error_description: `Could not reach ${target}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

/* ------------------------------ Static UI -------------------------------- */

// In production the built UI is served by this same process, so the playground
// is one container rather than two that must agree on a proxy configuration.
// In development Vite serves it instead and this directory does not exist.
const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  // Client-side routing fallback, excluding paths this server owns.
  app.get(/^\/(?!api|ws|mock-issuer|mock-verifier|issuer|wallet|contexts).*/, (_req, res) => {
    res.sendFile(resolve(webDist, 'index.html'));
  });
}

/* -------------------------------- Startup -------------------------------- */

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => sockets.delete(socket));
});

async function start(): Promise<void> {
  documentLoader = await loadDocumentLoader();
  await store.load();

  const [issuer, wallet] = await Promise.all([issuerKey(), walletKey()]);

  server.listen(config.port, () => {
    console.log(`Inji Interoperability Playground BFF listening on ${config.publicUrl}`);
    console.log(`  Reference issuer   ${config.publicUrl}/mock-issuer`);
    console.log(`  Reference verifier ${config.publicUrl}/mock-verifier`);
    console.log(`  Issuer DID         ${issuer.did}`);
    console.log(`  Wallet DID         ${wallet.did}`);
    if (existsSync(webDist)) console.log(`  UI                 ${config.publicUrl}`);
    if (config.publicUrl.includes('localhost')) {
      console.log(
        '  Note: PUBLIC_URL is localhost, so QR codes will not resolve from a phone. Set PUBLIC_URL to a tunnel URL for handheld wallet runs.',
      );
    }
  });
}

start().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
