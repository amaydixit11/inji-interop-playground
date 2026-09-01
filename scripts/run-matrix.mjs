#!/usr/bin/env node
/**
 * Runs a matrix of interoperability tests against a running playground and
 * writes a Markdown report.
 *
 * Intended for CI: it exits non-zero when any run fails, so a nightly job
 * against the Collab environment turns into a pass/fail signal plus an
 * artefact, rather than something a human has to read.
 *
 *   node scripts/run-matrix.mjs [--base http://localhost:8787]
 *                               [--out docs/INTEROPERABILITY.md]
 *                               [--issuer <id>] [--verifier <id>]
 *                               [--formats a,b] [--faults a,b]
 *
 * Only non-interactive participants can be driven this way; a matrix including
 * a handheld wallet would stall waiting for someone to scan a QR code.
 */

const args = parseArgs(process.argv.slice(2));
const base = (args.base ?? process.env.PLAYGROUND_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const outputPath = args.out ?? 'docs/INTEROPERABILITY.md';

const DEFAULT_FORMATS = ['ldp_vc', 'vc+sd-jwt', 'dc+sd-jwt', 'mso_mdoc'];
const DEFAULT_FAULTS = [
  'none',
  'break-signature',
  'expire-credential',
  'wrong-type',
  'strip-holder-proof',
  'replay-nonce',
  'revoke-credential',
];

/**
 * Faults that only make sense for some formats.
 *
 * Running one against a format that cannot express it would report a
 * configuration limit as a test failure, which is noise rather than signal.
 */
const FAULT_FORMATS = {
  'revoke-credential': ['ldp_vc'],
};

/** Faults that only exist in one presentation flow. */
const FAULT_FLOW_MODES = {
  'replay-response-code': ['same-device'],
};

const formats = args.formats ? args.formats.split(',') : DEFAULT_FORMATS;
const faults = args.faults ? args.faults.split(',') : DEFAULT_FAULTS;
// Proof suites and protocol revisions are extra dimensions rather than part of
// the default sweep: crossing all four would be hundreds of runs, and they vary
// independently of the fault modes.
const proofTypes = args.proofTypes ? args.proofTypes.split(',') : ['Ed25519Signature2020'];
const drafts = args.drafts ? args.drafts.split(',') : ['draft-13'];
const flowModes = args.flowModes ? args.flowModes.split(',') : ['cross-device'];
const issuerId = args.issuer ?? 'reference-issuer';
const walletId = args.wallet ?? 'reference-wallet';
const verifierId = args.verifier ?? 'reference-verifier';

const { participants } = await getJson(`${base}/api/participants`);
const byId = Object.fromEntries(participants.map((p) => [p.id, p]));

for (const [role, id] of [['issuer', issuerId], ['wallet', walletId], ['verifier', verifierId]]) {
  const participant = byId[id];
  if (!participant) fail(`Unknown ${role} "${id}". Available: ${participants.filter((p) => p.role === role).map((p) => p.id).join(', ')}`);
  if (participant.interactive) {
    fail(`"${id}" needs a human to scan a QR code and cannot be driven from a matrix run.`);
  }
}

// Formats the chosen trio cannot all handle are skipped rather than run and
// reported as failures — that is a configuration mismatch, not a defect.
const supported = formats.filter((format) =>
  [issuerId, walletId, verifierId].every((id) => byId[id].formats.includes(format)),
);
const skipped = formats.filter((format) => !supported.includes(format));

console.log(`Playground: ${base}`);
console.log(`Matrix:     ${issuerId} → ${walletId} → ${verifierId}`);
console.log(`Formats:    ${supported.join(', ') || '(none)'}${skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''}`);
console.log(`Faults:     ${faults.join(', ')}`);
console.log(`Suites:     ${proofTypes.join(', ')}`);
console.log(`Revisions:  ${drafts.join(', ')}`);
console.log(`Flows:      ${flowModes.join(', ')}`);
console.log('');

const records = [];
for (const format of supported) {
  for (const proofType of proofTypes) {
    for (const draft of drafts) {
      for (const flowMode of flowModes) {
      for (const tamper of faults) {
        const allowed = FAULT_FORMATS[tamper];
        if (allowed && !allowed.includes(format)) continue;
        const allowedFlows = FAULT_FLOW_MODES[tamper];
        if (allowedFlows && !allowedFlows.includes(flowMode)) continue;
    process.stdout.write(
      `  ${format.padEnd(11)} ${tamper.padEnd(19)} ${proofTypes.length > 1 ? proofType.padEnd(22) : ''}${drafts.length > 1 ? draft.padEnd(10) : ''}`,
    );
    const record = await runOne({ format, tamper, proofType, draft, flowMode });
    records.push(record);
    const summary = record.summary ?? {};
    console.log(
      `${record.status === 'passed' ? 'PASS' : 'FAIL'}  ` +
        `${summary.checksPassed ?? 0} passed, ${summary.checksFailed ?? 0} failed, ` +
        `${summary.checksWarned ?? 0} warned, ${summary.checksExpectedFailures ?? 0} expected`,
    );
    if (record.status !== 'passed' && record.summary?.failure) {
      console.log(`      ↳ ${record.summary.failure.message}`);
    }
      }
      }
    }
  }
}

const failures = records.filter((record) => record.status !== 'passed');
const report = buildReport(records, { issuerId, walletId, verifierId, byId, skipped });
await import('node:fs/promises').then((fs) => fs.writeFile(outputPath, report, 'utf8'));

console.log('');
console.log(`${records.length - failures.length}/${records.length} passed. Report written to ${outputPath}`);
process.exit(failures.length === 0 ? 0 : 1);

/* ------------------------------------------------------------------ */

async function runOne({ format, tamper, proofType, draft, flowMode }) {
  const { runId } = await postJson(`${base}/api/runs`, {
    issuerId,
    walletId,
    verifierId,
    format,
    proofType,
    walletProofType: 'jwt',
    vciDraft: draft,
    flowMode,
    tamper,
  });

  // The run executes after the POST returns, so poll until the record is
  // persisted rather than guessing at a fixed delay.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/runs/${runId}`);
    if (response.ok) return response.json();
    await sleep(500);
  }
  fail(`Run ${runId} (${format}, ${tamper}) did not complete within 180s.`);
}

function buildReport(records, { issuerId, walletId, verifierId, byId, skipped }) {
  const passed = records.filter((r) => r.status === 'passed').length;
  const lines = [];
  const push = (...values) => lines.push(...values);

  push('# Interoperability report', '');
  push(`Generated ${new Date().toISOString()} by \`scripts/run-matrix.mjs\`.`, '');
  push('Every row is a real end-to-end `issue → hold → present → verify` cycle with all protocol');
  push('exchanges captured.', '');

  push('## Configuration', '', '| | |', '| --- | --- |');
  push(`| Issuer | ${byId[issuerId].label} (\`${issuerId}\`, ${byId[issuerId].kind}) |`);
  push(`| Wallet | ${byId[walletId].label} (\`${walletId}\`, ${byId[walletId].kind}) |`);
  push(`| Verifier | ${byId[verifierId].label} (\`${verifierId}\`, ${byId[verifierId].kind}) |`);
  push(`| Runs | ${records.length} |`);
  push(`| Passed | ${passed} |`);
  push(`| Failed | ${records.length - passed} |`);
  push(`| Traceability | ${[...new Set(records.map((r) => r.traceability))].join(', ') || 'n/a'} |`);
  if (skipped.length > 0) {
    push(`| Formats skipped | ${skipped.join(', ')} — not supported by all three participants |`);
  }
  push('');

  push('## Matrix', '');
  push('| Format | Suite | Revision | Fault injected | Result | Verdict | Pass | Fail | Expected fail | Warn |');
  push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const record of records) {
    const s = record.summary ?? {};
    push(
      `| \`${record.config.format}\` | \`${record.config.proofType}\` | \`${record.config.vciDraft ?? 'draft-13'}\` | \`${record.config.tamper}\` | **${record.status}** | ` +
        `${verdictOf(record)} | ${s.checksPassed ?? 0} | ${s.checksFailed ?? 0} | ` +
        `${s.checksExpectedFailures ?? 0} | ${s.checksWarned ?? 0} |`,
    );
  }
  push('');
  push('A run with an injected fault passes when the verifier **rejects** the credential.');
  push('`Expected fail` counts checks that failed because the fault was correctly detected.', '');

  const faulted = records.filter((record) => record.config.tamper !== 'none');
  if (faulted.length > 0) {
    push('## Fault detection', '', '| Format | Fault | Detected by |', '| --- | --- | --- |');
    for (const record of faulted) {
      const caught = record.checks
        .filter((check) => check.status === 'fail' && check.expected)
        .map((check) => check.title);
      push(
        `| \`${record.config.format}\` | \`${record.config.tamper}\` | ` +
          `${caught.length > 0 ? caught.join('; ') : '**not detected**'} |`,
      );
    }
    push('');
  }

  const problems = new Map();
  for (const record of records) {
    for (const check of record.checks) {
      if (check.status === 'warn' || (check.status === 'fail' && !check.expected)) {
        const key = `${check.status}|${check.title}|${check.detail}`;
        problems.set(key, (problems.get(key) ?? 0) + 1);
      }
    }
  }
  if (problems.size > 0) {
    push('## Findings', '');
    for (const [key, count] of [...problems.entries()].sort((a, b) => b[1] - a[1])) {
      const [status, title, detail] = key.split('|');
      push(`- **${title}** — \`${status}\`, ${count} run(s). ${detail}`);
    }
    push('');
  }

  const checks = new Map();
  for (const record of records) {
    for (const check of record.checks) checks.set(check.title, check.spec);
  }
  push('## Conformance checks exercised', '');
  push(`${checks.size} distinct assertions across this run set.`, '');
  push('| Check | Specification clause |', '| --- | --- |');
  for (const title of [...checks.keys()].sort()) push(`| ${title} | ${checks.get(title)} |`);
  push('');

  push('## Reproducing', '', '```bash', 'npm run dev            # in one terminal', 'npm run matrix         # in another', '```', '');
  push('Each run is written to `runs/<id>.json` with its full exchange log, so any row above can');
  push('be re-read in full without re-running it.', '');

  return lines.join('\n');
}

function verdictOf(record) {
  const artifact = record.artifacts.find((entry) => entry.label === 'Verification result');
  const verdict = artifact && typeof artifact.value === 'object' ? artifact.value?.verdict : undefined;
  return verdict ? `\`${verdict}\`` : '—';
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) fail(`GET ${url} failed: ${response.status}. Is the playground running?`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) fail(`POST ${url} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) parsed[token.slice(2)] = argv[++index];
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(2);
}
