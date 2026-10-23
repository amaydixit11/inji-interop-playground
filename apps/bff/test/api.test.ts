import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 18_000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;

let server: ChildProcess;
let workdir: string;

/**
 * The real server, started the way `npm run dev:bff` starts it.
 *
 * It runs in a scratch directory because the run store and the signing keys
 * both live under the working directory, and a test should not add runs to a
 * developer's history or rotate their keys.
 */
before(async () => {
  workdir = await mkdtemp(resolve(tmpdir(), 'playground-api-'));
  server = spawn(process.execPath, ['--import', import.meta.resolve('tsx/esm'), resolve(root, 'apps/bff/src/index.ts')], {
    cwd: workdir,
    env: { ...process.env, PORT: String(PORT), PUBLIC_URL: base },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((settle) => setTimeout(settle, 250));
  }
  throw new Error('Server did not become healthy within 60s');
});

after(async () => {
  server?.kill();
  if (workdir) await rm(workdir, { recursive: true, force: true });
});

const REFERENCE = {
  issuerId: 'reference-issuer',
  walletId: 'reference-wallet',
  verifierId: 'reference-verifier',
  format: 'vc+sd-jwt',
  proofType: 'Ed25519Signature2020',
  walletProofType: 'jwt',
  tamper: 'none',
};

async function startRun(config: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
}

async function waitForRecord(id: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/runs/${id}`);
    if (response.ok) return response.json();
    await new Promise((settle) => setTimeout(settle, 200));
  }
  throw new Error(`Run ${id} was not persisted within 30s`);
}

describe('control API', () => {
  test('an unknown participant is refused, and the refusal names the valid ones', async () => {
    const response = await startRun({ ...REFERENCE, issuerId: 'nope' });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'invalid_configuration');
    assert.match(body.message, /reference-issuer/);
  });

  test('an unknown run is a 404, for reading it and for acting on it', async () => {
    assert.equal((await fetch(`${base}/api/runs/does-not-exist`)).status, 404);
    const action = await fetch(`${base}/api/runs/does-not-exist/actions/x`, { method: 'POST' });
    assert.equal(action.status, 404);
  });

  test('a run is accepted at once, then completes and is written to the history', async () => {
    const response = await startRun(REFERENCE);
    assert.equal(response.status, 202);
    const { runId } = await response.json();

    const record = await waitForRecord(runId);
    assert.equal(record.status, 'passed');
    assert.ok(record.exchanges.length > 0, 'the record carries the captured exchanges');

    const files = await readdir(resolve(workdir, 'runs'));
    assert.ok(files.includes(`${runId}.json`), 'the run is persisted as a readable file');

    const { runs } = await (await fetch(`${base}/api/runs`)).json();
    const listed = runs.find((run: { id: string }) => run.id === runId);
    assert.ok(listed, 'the run appears in the history listing');
    assert.equal(listed.exchanges, undefined, 'the listing omits payloads');
  });

  test('committed evidence runs are listed but never rewritten', async () => {
    const directory = resolve(root, 'docs/evidence');
    const [file] = (await readdir(directory)).filter((name) => name.endsWith('.json'));
    assert.ok(file, 'docs/evidence holds at least one run');
    const before = (await stat(resolve(directory, file))).mtimeMs;

    const { runs } = await (await fetch(`${base}/api/runs`)).json();
    assert.ok(runs.some((run: { id: string }) => `${run.id}.json` === file));

    const { runId } = await (await startRun(REFERENCE)).json();
    await waitForRecord(runId);
    assert.equal((await stat(resolve(directory, file))).mtimeMs, before);
  });
});

describe('importing a browser capture', () => {
  test('cookies, tokens, codes and PKCE verifiers do not reach the record', async () => {
    const entry = (url: string, extra: Record<string, unknown> = {}) => ({
      startedDateTime: '2026-10-23T12:00:00.000Z',
      time: 10,
      request: {
        method: 'GET',
        url,
        headers: [
          { name: 'Cookie', value: 'SESSION=secret-cookie' },
          { name: 'Authorization', value: 'Bearer secret-bearer' },
        ],
      },
      response: { status: 200, headers: [{ name: 'Set-Cookie', value: 'SESSION=secret-cookie' }], content: {} },
      ...extra,
    });
    const issue = {
      log: {
        entries: [
          entry('https://esignet.example/authorize?code_challenge=c&code_challenge_method=S256&state=secret-state'),
          entry('https://wallet.example/v1/mimoto/credentials/download', {
            request: {
              method: 'POST',
              url: 'https://wallet.example/v1/mimoto/credentials/download',
              headers: [],
              postData: { mimeType: 'application/x-www-form-urlencoded', text: 'code=secret-code&code_verifier=secret-verifier' },
            },
          }),
        ],
      },
    };
    const verify = {
      log: {
        entries: [
          entry('https://verify.example/v1/verify/vp-session-results', {
            request: {
              method: 'POST',
              url: 'https://verify.example/v1/verify/vp-session-results',
              headers: [],
              postData: { mimeType: 'application/json', text: '{"responseCode":"secret-response-code"}' },
            },
          }),
        ],
      },
    };

    await writeFile(resolve(workdir, 'issue.har'), JSON.stringify(issue));
    await writeFile(resolve(workdir, 'verify.har'), JSON.stringify(verify));
    const out = resolve(workdir, 'imported');

    await new Promise<void>((settle, reject) => {
      const child = spawn(process.execPath, [
        resolve(root, 'scripts/import-har.mjs'),
        '--issue', resolve(workdir, 'issue.har'),
        '--verify', resolve(workdir, 'verify.har'),
        '--out', out,
      ], { stdio: 'ignore' });
      child.on('exit', (code) => (code === 0 ? settle() : reject(new Error(`import-har exited ${code}`))));
    });

    const [file] = await readdir(out);
    const text = await readFile(resolve(out, file), 'utf8');
    assert.doesNotMatch(text, /secret-/, 'no secret value survives anywhere in the record');
    const record = JSON.parse(text);
    assert.equal(record.traceability, 'endpoint-only');
    assert.ok(record.exchanges.length === 3, 'all three recognised exchanges are kept');
  });
});
