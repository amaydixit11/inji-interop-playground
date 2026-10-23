#!/usr/bin/env node
/**
 * Turns browser captures of an all-Inji flow into a playground run record.
 *
 * Inji Web and Inji Verify talk to each other through the browser, so the
 * playground cannot sit in the path the way it does for its own adapters. What
 * it can do is read a HAR of that browser session and file it as an
 * `endpoint-only` run: the exchanges appear in the protocol inspector, the
 * sequence diagram and the history like any other run, marked as imported.
 *
 *   node scripts/import-har.mjs --issue issue.har --verify verify.har
 *                               [--base http://localhost:8787] [--out runs/]
 *
 * `issue.har` covers Inji Web downloading a credential, `verify.har` covers
 * Inji Verify checking it. With `--base`, the credential Inji Verify returned
 * is also checked by the playground's reference verifier, so the record says
 * whether an implementation outside MOSIP agrees.
 *
 * Cookies, bearer tokens, authorization codes and PKCE verifiers are removed:
 * the record is meant to be committed and attached to bug reports.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = parseArgs(process.argv.slice(2));
if (!args.issue || !args.verify) {
  console.error('Usage: node scripts/import-har.mjs --issue issue.har --verify verify.har [--base URL] [--out runs/]');
  process.exit(1);
}

const SECRET_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'x-xsrf-token', 'x-csrf-token']);
const SECRET_PARAMS = ['code', 'code_verifier', 'state', 'access_token', 'id_token'];
// The same values inside JSON bodies, plus the verifier's one-time response code.
const SECRET_KEYS = new Set([...SECRET_PARAMS, 'codeVerifier', 'responseCode', 'accessToken', 'idToken']);

/**
 * The API calls worth showing, in the order the protocol makes them. Page
 * loads, scripts and images are dropped; anything unrecognised is too, because
 * a mislabelled exchange is worse than a missing one.
 */
const RULES = [
  { match: /esignet[^/]*\/authorize/, step: 'issue', label: 'Authorization Request (PKCE)', from: 'Wallet', to: 'Authorization Server' },
  { match: /\/authorization\/v3\/oauth-details/, step: 'issue', label: 'eSignet: OAuth details', from: 'Wallet', to: 'Authorization Server' },
  { match: /\/authorization\/v3\/authenticate/, step: 'issue', label: 'eSignet: Authenticate the holder', from: 'Wallet', to: 'Authorization Server' },
  { match: /\/authorization\/claim-details/, step: 'issue', label: 'eSignet: Claim details', from: 'Wallet', to: 'Authorization Server' },
  { match: /\/authorization\/auth-code/, step: 'issue', label: 'eSignet: Authorization code', from: 'Authorization Server', to: 'Wallet' },
  { match: /\/mimoto\/credentials\/download/, step: 'issue', label: 'Token + Credential Request (via Mimoto)', from: 'Wallet', to: 'Issuer' },
  { match: /\/v2\/vp-session-request/, step: 'present', label: 'Create Authorization Request', from: 'Verifier', to: 'Verifier' },
  { match: /injiweb[^/]*\/authorize/, step: 'present', label: 'Authorization Request (INJI_OVP)', from: 'Verifier', to: 'Wallet' },
  { match: /\/mimoto\/authorize/, step: 'present', label: 'Authorization Response (vp_token)', from: 'Wallet', to: 'Verifier' },
  { match: /\/vp-session-results/, step: 'verify', label: 'Fetch Verification Result', from: 'Verifier', to: 'Verifier' },
];

const entries = [
  ...(await readHar(args.issue)),
  ...(await readHar(args.verify)),
];

const exchanges = [];
for (const entry of entries) {
  const rule = RULES.find((r) => r.match.test(entry.request.url));
  if (!rule) continue;
  exchanges.push({
    id: randomUUID(),
    step: rule.step,
    label: rule.label,
    from: rule.from,
    to: rule.to,
    method: entry.request.method,
    url: redactUrl(entry.request.url),
    requestHeaders: headers(entry.request.headers),
    requestBody: body(entry.request.postData?.text, entry.request.postData?.mimeType),
    status: entry.response.status || undefined,
    responseHeaders: headers(entry.response.headers),
    responseBody: body(entry.response.content?.text, entry.response.content?.mimeType, entry.response.content?.size),
    durationMs: Math.round(entry.time),
    // Status 0 is a request the browser followed as a redirect without a
    // readable response, which is all the capture can say about it.
    error: entry.response.status ? undefined : 'Followed as a browser redirect; no response was captured.',
    startedAt: entry.startedDateTime,
  });
}

const find = (label) => exchanges.find((e) => e.label === label);
const download = find('Token + Credential Request (via Mimoto)');
const request = find('Create Authorization Request');
const result = find('Fetch Verification Result');
const verdict = result?.responseBody?.credentialResults?.[0];
const dcql = request?.requestBody?.dcqlQuery?.credentials?.[0];
const credential = verdict?.verifiableCredential ? JSON.parse(verdict.verifiableCredential) : undefined;
const authorize = find('Authorization Request (PKCE)');
const pkce = authorize ? new URL(authorize.url).searchParams.get('code_challenge_method') : null;

const checks = [];
const check = (step, id, title, status, spec, detail, attributedTo) =>
  checks.push({ id, step, title, status, spec, detail, ...(attributedTo ? { attributedTo } : {}) });

check('issue', 'wallet.traceability', 'Wallet exchanges were captured', 'warn', 'Playground observability',
  'Imported from a browser capture of Inji Web and Inji Verify. The playground was not in the path, so wallet-internal steps (Mimoto to Certify) are not visible.');
check('issue', 'issue.pkce', 'Authorization code request uses PKCE S256', pkce === 'S256' ? 'pass' : 'fail', 'RFC 7636',
  pkce ? `code_challenge_method=${pkce}` : 'No authorization request was captured.', 'wallet');
check('issue', 'issue.downloaded', 'Wallet obtained the credential', download?.status === 200 ? 'pass' : 'fail', 'OpenID4VCI §7–8',
  download ? `Mimoto answered ${download.status} with ${download.responseBody?.omitted ?? 'a body'}.` : 'No download was captured.', 'issuer');
check('present', 'present.query', 'Verifier states what it wants', dcql ? 'pass' : 'fail', 'OpenID4VP 1.0 §6 (DCQL)',
  dcql ? `DCQL, format ${dcql.format}, types ${JSON.stringify(dcql.meta?.type_values)}.` : 'No authorization request was captured.', 'verifier');
check('present', 'present.holder-binding', 'Verifier requires holder binding', dcql?.require_cryptographic_holder_binding === false ? 'warn' : 'pass',
  'OpenID4VP 1.0 §6.1', `require_cryptographic_holder_binding is ${dcql?.require_cryptographic_holder_binding}. Without it, whoever holds the QR can present the credential.`, 'verifier');
check('verify', 'verify.signature', 'Inji Verify: signature and schema', verdict?.schemaAndSignatureCheck?.valid ? 'pass' : 'fail', 'W3C VC Data Integrity',
  verdict ? JSON.stringify(verdict.schemaAndSignatureCheck) : 'No verification result was captured.', 'verifier');
check('verify', 'verify.expiry', 'Inji Verify: validity period', verdict?.expiryCheck?.valid ? 'pass' : 'fail', 'W3C VC 1.1 §4.7',
  credential ? `expirationDate ${credential.expirationDate}` : 'No credential returned.', 'verifier');
check('verify', 'verify.status', 'Inji Verify: revocation status', Array.isArray(verdict?.statusCheck) && verdict.statusCheck.length === 0 ? 'warn' : 'pass',
  'W3C Bitstring Status List', 'statusCheck is empty: the credential carries no status entry, or status was not checked. The response does not say which.', 'verifier');

if (args.base && credential) {
  const response = await fetch(`${String(args.base).replace(/\/$/, '')}/mock-verifier/verify-credential`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'ldp_vc', credential }),
  });
  const independent = await response.json();
  check('verify', 'verify.independent', 'An independent verifier agrees', independent.valid === Boolean(verdict?.allChecksSuccessful) ? 'pass' : 'fail',
    'Cross-implementation', `Reference verifier (not Inji code): ${JSON.stringify(independent)}`);
}

check('verify', 'verify.outcome', 'Verification succeeded', verdict?.allChecksSuccessful ? 'pass' : 'fail', 'Run expectation',
  `allChecksSuccessful: ${verdict?.allChecksSuccessful}`, 'verifier');

const passed = checks.filter((c) => c.status === 'pass').length;
const failed = checks.filter((c) => c.status === 'fail').length;
const warned = checks.filter((c) => c.status === 'warn').length;
const times = entries.map((e) => Date.parse(e.startedDateTime)).filter(Number.isFinite);
const startedAt = new Date(Math.min(...times)).toISOString();
const finishedAt = new Date(Math.max(...entries.map((e) => Date.parse(e.startedDateTime) + e.time))).toISOString();
const proofType = credential?.proof?.type ?? 'Ed25519Signature2020';

const participant = (id, role, label, summary) => ({
  id, role, label, kind: 'inji', summary, traceability: 'endpoint-only',
  formats: ['ldp_vc'], specs: [], interactive: true, config: [],
});

const record = {
  id: randomUUID(),
  config: {
    issuerId: 'inji-certify',
    walletId: 'inji-web',
    verifierId: 'inji-verify',
    format: 'ldp_vc',
    proofType,
    walletProofType: 'none',
    grantType: 'authorization_code',
    queryLanguage: dcql ? 'dcql' : 'presentation-exchange',
    tamper: 'none',
  },
  status: failed === 0 ? 'passed' : 'failed',
  startedAt,
  finishedAt,
  participants: {
    issuer: participant('inji-certify', 'issuer', 'Inji Certify (Collab)', `Issuer ${credential?.issuer ?? 'unknown'}, reached through Mimoto.`),
    wallet: participant('inji-web', 'wallet', 'Inji Web (Collab)', 'injiweb.collab.mosip.net, guest session.'),
    verifier: participant('inji-verify', 'verifier', 'Inji Verify (Collab)', 'injiverify.collab.mosip.net.'),
  },
  steps: {
    // Inji Web starts from its own issuer catalogue, so there is no discovery
    // or credential offer for the playground to observe.
    discover: 'skipped',
    offer: 'skipped',
    issue: download?.status === 200 ? 'passed' : 'failed',
    present: request ? 'passed' : 'failed',
    verify: verdict?.allChecksSuccessful ? 'passed' : 'failed',
  },
  exchanges,
  checks,
  artifacts: credential ? [{ id: randomUUID(), step: 'verify', kind: 'json', label: 'Credential returned by Inji Verify', value: credential }] : [],
  summary: {
    checksPassed: passed,
    checksFailed: failed,
    checksWarned: warned,
    checksExpectedFailures: 0,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
  },
  versions: [
    { participantId: 'inji-certify', role: 'issuer', value: 'collab', source: 'declared', detail: 'MOSIP Collab sandbox, imported from a browser capture' },
    { participantId: 'inji-verify', role: 'verifier', value: 'collab', source: 'declared', detail: 'MOSIP Collab sandbox, imported from a browser capture' },
  ],
  traceability: 'endpoint-only',
};

const directory = resolve(args.out ?? 'runs');
await mkdir(directory, { recursive: true });
const path = resolve(directory, `${record.id}.json`);
await writeFile(path, JSON.stringify(record, null, 2), 'utf8');
console.log(`${record.status.toUpperCase()}  ${passed} passed, ${failed} failed, ${warned} warned · ${exchanges.length} exchanges`);
console.log(`Run ${record.id} written to ${path}`);

/* ------------------------------------------------------------------ */

async function readHar(path) {
  return JSON.parse(await readFile(path, 'utf8')).log.entries;
}

function headers(list = []) {
  return Object.fromEntries(
    list.filter((h) => !SECRET_HEADERS.has(h.name.toLowerCase()) && !h.name.startsWith(':')).map((h) => [h.name.toLowerCase(), h.value]),
  );
}

function redactUrl(url) {
  const parsed = new URL(url);
  for (const name of SECRET_PARAMS) if (parsed.searchParams.has(name)) parsed.searchParams.set(name, '[redacted]');
  return parsed.toString();
}

function body(text, mimeType = '', size) {
  if (!text) return mimeType.includes('pdf') ? { omitted: `${mimeType}, ${size} bytes` } : undefined;
  if (mimeType.includes('pdf')) return { omitted: `${mimeType}, ${size} bytes` };
  if (mimeType.includes('x-www-form-urlencoded')) {
    const params = new URLSearchParams(text);
    for (const name of SECRET_PARAMS) if (params.has(name)) params.set(name, '[redacted]');
    return Object.fromEntries(params);
  }
  try {
    return redactJson(JSON.parse(text));
  } catch {
    return text;
  }
}

function redactJson(value) {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, SECRET_KEYS.has(key) && typeof inner === 'string' ? '[redacted]' : redactJson(inner)]),
  );
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      parsed[token.slice(2)] = true;
    } else {
      parsed[token.slice(2)] = next;
      index += 1;
    }
  }
  return parsed;
}
