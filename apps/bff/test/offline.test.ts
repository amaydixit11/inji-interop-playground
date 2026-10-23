import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test, { after, before, describe } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const PORT = 19_000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;

let server: ChildProcess;
let workdir: string;

/**
 * The reference stack must not need the internet.
 *
 * JSON-LD contexts it signs with used to be fetched from w3id.org on first use,
 * so a cold start on a flaky network failed the first demo run. The server here
 * runs with every non-loopback request rejected.
 */
before(async () => {
  workdir = await mkdtemp(resolve(tmpdir(), 'playground-offline-'));
  server = spawn(
    process.execPath,
    [
      '--import', import.meta.resolve('tsx/esm'),
      '--import', pathToFileURL(resolve(here, 'fixtures/offline.mjs')).href,
      resolve(root, 'apps/bff/src/index.ts'),
    ],
    { cwd: workdir, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: base }, stdio: 'ignore' },
  );
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

async function run(config: Record<string, unknown>): Promise<Record<string, any>> {
  const response = await fetch(`${base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      issuerId: 'reference-issuer',
      walletId: 'reference-wallet',
      verifierId: 'reference-verifier',
      proofType: 'Ed25519Signature2020',
      walletProofType: 'jwt',
      ...config,
    }),
  });
  const { runId } = await response.json();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const record = await fetch(`${base}/api/runs/${runId}`);
    if (record.ok) return record.json();
    await new Promise((settle) => setTimeout(settle, 200));
  }
  throw new Error(`Run ${runId} did not finish`);
}

describe('with no network', () => {
  for (const [format, tamper] of [
    ['ldp_vc', 'none'],
    ['ldp_vc', 'revoke-credential'],
    ['vc+sd-jwt', 'none'],
    ['mso_mdoc', 'none'],
  ] as const) {
    test(`${format} with ${tamper} completes as expected`, async () => {
      const record = await run({ format, tamper });
      assert.equal(record.status, 'passed', record.summary?.failure?.message);
    });
  }
});
