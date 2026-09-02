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
 *                               [--save-baseline baseline.json]
 *                               [--baseline baseline.json] [--fail-on-regression]
 *
 * Baselines are for the person changing one of these services. Record what your
 * build does today, change it, run again against the baseline, and the exit code
 * and report say whether anything that used to pass now does not — which is a
 * far more useful signal than an absolute pass count that was never 100% to
 * begin with.
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
  // mdoc is excluded: ISO/IEC 18013-5 defines no status list to reference, so
  // there is nothing for a revocation fault to act on.
  'revoke-credential': ['ldp_vc', 'vc+sd-jwt', 'dc+sd-jwt'],
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
const vcVersions = args.vcVersions ? args.vcVersions.split(',') : ['1.1'];
const keyRefs = args.keyRefs ? args.keyRefs.split(',') : ['did'];
const queryLanguages = args.queryLanguages ? args.queryLanguages.split(',') : ['presentation-exchange'];
const baselinePath = args.baseline;
const saveBaselinePath = args['save-baseline'];
const failOnRegression = 'fail-on-regression' in args;
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
console.log(`Data model: ${vcVersions.join(', ')}`);
console.log(`Issuer key: ${keyRefs.join(', ')}`);
console.log(`Request:    ${queryLanguages.join(', ')}`);
console.log('');

const records = [];
for (const format of supported) {
  for (const proofType of proofTypes) {
    for (const draft of drafts) {
      for (const flowMode of flowModes) {
      for (const vcVersion of vcVersions) {
      for (const issuerKeyReference of keyRefs) {
      for (const queryLanguage of queryLanguages) {
      for (const tamper of faults) {
        // The issuer key reference only exists for SD-JWT credentials.
        if (issuerKeyReference !== 'did' && !format.endsWith('sd-jwt')) continue;
        // The data model revision only exists for JSON-LD credentials.
        if (vcVersion !== '1.1' && format !== 'ldp_vc') continue;
        const allowed = FAULT_FORMATS[tamper];
        if (allowed && !allowed.includes(format)) continue;
        const allowedFlows = FAULT_FLOW_MODES[tamper];
        if (allowedFlows && !allowedFlows.includes(flowMode)) continue;
    process.stdout.write(
      `  ${format.padEnd(11)} ${tamper.padEnd(19)} ${proofTypes.length > 1 ? proofType.padEnd(22) : ''}${drafts.length > 1 ? draft.padEnd(10) : ''}`,
    );
    const record = await runOne({
      format, tamper, proofType, draft, flowMode, vcVersion, issuerKeyReference, queryLanguage,
    });
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
    }
  }
}

const fs = await import('node:fs/promises');
const failures = records.filter((record) => record.status !== 'passed');

let comparison;
if (baselinePath) {
  comparison = compareToBaseline(await readBaseline(baselinePath), records);
  printComparison(comparison);
}

if (saveBaselinePath) {
  await fs.writeFile(saveBaselinePath, JSON.stringify(toBaseline(records), null, 2), 'utf8');
  console.log(`\nBaseline written to ${saveBaselinePath}`);
}

const report = buildReport(records, { issuerId, walletId, verifierId, byId, skipped, comparison });
await fs.writeFile(outputPath, report, 'utf8');

console.log('');
console.log(`${records.length - failures.length}/${records.length} passed. Report written to ${outputPath}`);

// Exit code priority: when a baseline is given, regressions are the signal
// worth failing on. An absolute failure count is close to meaningless against a
// service with known open defects, and would make the check permanently red.
if (comparison && failOnRegression) {
  if (comparison.regressed.length > 0) {
    console.error(`\n${comparison.regressed.length} regression(s) against the baseline.`);
    process.exit(1);
  }
  console.log('No regressions against the baseline.');
  process.exit(0);
}

process.exit(failures.length === 0 ? 0 : 1);

/* ------------------------------------------------------------------ */

async function runOne({
  format, tamper, proofType, draft, flowMode, vcVersion, issuerKeyReference, queryLanguage,
}) {
  const { runId } = await postJson(`${base}/api/runs`, {
    issuerId,
    walletId,
    verifierId,
    format,
    proofType,
    walletProofType: 'jwt',
    vciDraft: draft,
    flowMode,
    vcVersion,
    issuerKeyReference,
    queryLanguage,
    tamper,
  });

  // The run executes after the POST returns, so poll until the record is
  // persisted rather than guessing at a fixed delay.
  //
  // Generous, because a verifier that rejects a submission never flips its
  // status and the adapter polls its full timeout waiting — which is honest
  // behaviour and slow. A tighter deadline reports that as a harness timeout
  // rather than as the finding it is.
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/runs/${runId}`);
    if (response.ok) return response.json();
    await sleep(500);
  }
  fail(`Run ${runId} (${format}, ${tamper}) did not complete within 180s.`);
}

/** Reduces a run set to the assertion outcomes worth comparing later. */
function toBaseline(records) {
  return {
    recordedAt: new Date().toISOString(),
    runs: records.map((record) => ({
      key: runKey(record),
      status: record.status,
      checks: Object.fromEntries(
        record.checks.map((check) => [check.id, check.expected ? 'expected' : check.status]),
      ),
    })),
  };
}

/** A run's identity across executions: same inputs, same key. */
function runKey(record) {
  const c = record.config;
  return [
    record.participants.issuer.label,
    record.participants.wallet.label,
    record.participants.verifier.label,
    c.format,
    c.proofType,
    c.vciDraft ?? 'draft-13',
    c.flowMode ?? 'cross-device',
    c.vcVersion ?? '1.1',
    c.issuerKeyReference ?? 'did',
    c.queryLanguage ?? 'presentation-exchange',
    c.tamper,
  ].join(' | ');
}

async function readBaseline(path) {
  try {
    const fs = await import('node:fs/promises');
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch (error) {
    fail(`Could not read baseline ${path}: ${error.message}`);
  }
}

/**
 * Diffs this run set against a baseline.
 *
 * Reports fixes as prominently as regressions: someone verifying that their
 * change did what they intended needs to see the assertions that started
 * passing, not only the ones that stopped.
 */
function compareToBaseline(baseline, records) {
  const before = new Map(baseline.runs.map((run) => [run.key, run]));
  const regressed = [];
  const fixed = [];
  const added = [];
  const removed = [];

  for (const record of records) {
    const key = runKey(record);
    const prior = before.get(key);
    if (!prior) {
      added.push({ key, status: record.status });
      continue;
    }

    // A check that has vanished is a regression in its own right: the verifier
    // has stopped asking a question it used to ask, which no comparison of the
    // surviving checks would ever reveal.
    const currentIds = new Set(record.checks.map((check) => check.id));
    for (const [id, then] of Object.entries(prior.checks)) {
      if (currentIds.has(id)) continue;
      if (then !== 'pass' && then !== 'expected') continue;
      regressed.push({
        key,
        id,
        title: id,
        then,
        now: 'no longer evaluated',
        detail: 'This assertion ran in the baseline and does not run now.',
      });
    }

    for (const check of record.checks) {
      const now = check.expected ? 'expected' : check.status;
      const then = prior.checks[check.id];
      if (then === undefined) continue;
      if (then === now) continue;

      // "pass" and "expected" are both acceptable outcomes; a move between the
      // other states is what counts.
      const wasGood = then === 'pass' || then === 'expected';
      const isGood = now === 'pass' || now === 'expected';
      if (wasGood && !isGood) regressed.push({ key, id: check.id, title: check.title, then, now, detail: check.detail });
      else if (!wasGood && isGood) fixed.push({ key, id: check.id, title: check.title, then, now });
    }
  }

  const seen = new Set(records.map(runKey));
  for (const [key] of before) if (!seen.has(key)) removed.push({ key });

  return { regressed, fixed, added, removed, recordedAt: baseline.recordedAt };
}

function printComparison(comparison) {
  console.log('');
  console.log(`Against baseline recorded ${comparison.recordedAt}:`);
  console.log(`  ${comparison.regressed.length} regressed · ${comparison.fixed.length} fixed · ${comparison.added.length} new run(s) · ${comparison.removed.length} no longer run`);
  for (const entry of comparison.regressed) {
    console.log(`  REGRESSED  ${entry.title}`);
    console.log(`             ${entry.then} → ${entry.now} · ${entry.key}`);
  }
  for (const entry of comparison.fixed) {
    console.log(`  FIXED      ${entry.title} (${entry.then} → ${entry.now})`);
  }
}

function buildReport(records, { issuerId, walletId, verifierId, byId, skipped, comparison }) {
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

  if (comparison) {
    push('## Against the baseline', '');
    push(`Baseline recorded ${comparison.recordedAt}.`, '');
    push(
      `**${comparison.regressed.length} regressed · ${comparison.fixed.length} fixed · ` +
        `${comparison.added.length} new · ${comparison.removed.length} no longer run**`,
      '',
    );
    if (comparison.regressed.length > 0) {
      push('### Regressions', '', '| Check | Was | Now | Run |', '| --- | --- | --- | --- |');
      for (const entry of comparison.regressed) {
        push(`| ${entry.title} | ${entry.then} | **${entry.now}** | \`${entry.key}\` |`);
      }
      push('');
    }
    if (comparison.fixed.length > 0) {
      push('### Fixed', '', '| Check | Was | Now |', '| --- | --- | --- |');
      for (const entry of comparison.fixed) push(`| ${entry.title} | ${entry.then} | **${entry.now}** |`);
      push('');
    }
  }

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
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    // A flag followed by another flag, or by nothing, is boolean. Consuming the
    // next token unconditionally makes `--fail-on-regression --out x` swallow
    // `--out` and silently write to the default path.
    if (next === undefined || next.startsWith('--')) {
      parsed[token.slice(2)] = true;
    } else {
      parsed[token.slice(2)] = next;
      index += 1;
    }
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
