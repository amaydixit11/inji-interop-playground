# Test cases and results

Three layers, each run on 2026-10-23 against commit `a8027b4`.

| Layer | What it proves | Command | Result |
|---|---|---|---|
| Unit + API | Each protocol primitive behaves to spec, including the edge cases; the HTTP API and capture import behave as documented | `npm test` | **96 / 96 pass**, 20 suites |
| End-to-end fault matrix | A full `issue → hold → present → verify` cycle, every format, every fault | `node scripts/run-matrix.mjs` | **27 / 27 pass** on the reference stack |
| Live Inji stack | What happens when real Inji releases talk to each other and to the spec | runs from the UI against `docker-compose.inji.yml` | **27 ranked findings**, 5 blockers: [FINDINGS.md](FINDINGS.md) |

A run with an injected fault **passes when the verifier rejects the credential**. A verifier that
accepts a forged, expired, revoked or replayed credential is the failure being tested for.

---

## 1. Unit tests: `apps/bff/test/*.test.ts`

```bash
npm install
npm test
```

| Suite | Cases | Edge cases covered |
|---|---|---|
| DCQL query construction | 4 | per-format type constraints; segment paths, not JSONPath; namespaced mdoc paths |
| DCQL evaluation | 10 | wrong type set; missing claim; value constraint; wrong format fails rather than being ignored; empty query is not silently satisfied |
| mdoc happy path | 2 | credential is base64url CBOR, not JSON |
| mdoc selective disclosure | 2 | withheld elements leave the issuer signature intact |
| mdoc negative paths | 8 | corrupted issuer signature; mismatched digest; expiry reported separately from authenticity; missing or foreign device signature; response replayed to another verifier; unresolvable issuer key fails closed; non-CBOR token |
| Presentation Exchange constraints | 8 | `const`, `contains`, `pattern`; required vs optional fields; nested and indexed paths; unknown filter keyword does not silently reject |
| Status lists | 9 | bit order; gzip/base64 round trip; out-of-range index refused; missing/malformed entry is "unchecked", not "not revoked"; unreachable list is "unknown", not "good standing" |
| QR capacity | 5 | thresholds inclusive; measured in bytes, not characters |
| SD-JWT issuance | 4 | one disclosure per claim; payload commits by digest; order-independent digests; fresh salt per issuance |
| SD-JWT presentation | 6 | withheld claims still committed to; forged disclosure rejected; key binding hash covers exactly what was presented; corrupted `sd_hash` caught |
| SD-JWT parsing | 2 | trailing `~` means no key binding; empty token rejected |
| Expected outcomes | 6 | every tamper mode has an expected verdict; "expired" may be rejected but never reported valid |
| Run narrative | 6 | holder binding only claimed when a check established it; unchecked properties reported with a reason |
| Step deadlines | 2 | every phase has a bounded time budget |
| Grant types | 2 | PKCE challenge derived with S256, not passed through |
| Certify admin API probe | 3 | leaked persistence errors and Java controller signatures detected |
| Data Integrity suites | 11 | Ed25519Signature2020 / 2018, RsaSignature2018: sign, verify, altered signature fails, altered claim fails |
| Signature corruption | 1 | altering the last base64url character can be a no-op, so the tamper avoids it |
| Control API (`api.test.ts`) | 4 | unknown participant → 400 naming valid ids; unknown run → 404; a run is accepted with 202 then persisted; evidence runs are listed but never rewritten |
| Importing a browser capture | 1 | no cookie, bearer token, authorization code, PKCE verifier, `state` or response code survives into the record |

Result:

```
ℹ tests 91
ℹ suites 18
ℹ pass 91
ℹ fail 0
ℹ duration_ms 607
```

---

## 2. End-to-end fault matrix

```bash
npm run dev:bff            # in one terminal
node scripts/run-matrix.mjs --issuer reference-issuer --verifier reference-verifier --out /tmp/matrix.md
```

Each row is a real HTTP cycle between the reference issuer, the headless reference wallet and the
reference verifier, with every exchange captured.

| Fault | What it does | Expected verdict |
|---|---|---|
| `none` | happy path | `valid` |
| `break-signature` | flips a byte in the credential signature | `invalid` |
| `expire-credential` | backdates the expiry | `valid-but-expired` |
| `wrong-type` | presents a credential the request did not ask for | `invalid` |
| `strip-holder-proof` | removes the holder binding | `invalid` |
| `replay-nonce` | answers with a stale nonce | `invalid` |
| `revoke-credential` | revokes right after issuing (not mdoc: ISO 18013-5 has no status list) | `invalid` |

Result: **27 / 27 passed**.

| Format | Suite | Revision | Fault injected | Result | Verdict | Pass | Fail | Expected fail | Warn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 34 | 0 | 0 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 32 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 32 | 0 | 1 | 2 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 33 | 0 | 1 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 32 | 0 | 1 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 32 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **passed** | `invalid` | 31 | 0 | 3 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 33 | 0 | 0 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 32 | 0 | 1 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 32 | 0 | 0 | 1 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 32 | 0 | 1 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 29 | 0 | 1 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 32 | 0 | 1 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **passed** | `invalid` | 32 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 33 | 0 | 0 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 32 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 32 | 0 | 0 | 1 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 32 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 29 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 32 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **passed** | `invalid` | 32 | 0 | 1 | 0 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 31 | 0 | 0 | 0 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 30 | 0 | 0 | 1 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 29 | 0 | 1 | 1 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 30 | 0 | 1 | 0 |


`Pass` counts conformance checks that passed. `Expected fail` counts checks that failed because the
fault was correctly detected. `Warn` flags something worth knowing that is not a failure.

---

## 3. Against the live Inji stack

`docker-compose.inji.yml` brings up Inji Certify 0.14.0, Inji Verify service 0.18.2, Mimoto 0.21.0
and Inji Web 0.16.0. Pairing each one with a reference implementation on the other side isolates
faults to one component.

This is where the playground proved useful: **27 ranked findings** against Inji releases, 5 of them blockers. With its
published configuration, Inji Certify cannot complete a single pre-authorized-code issuance, and Inji
Verify accepts a revoked SD-JWT credential as valid.

Inji Verify does pass end to end with an SD-JWT that embeds its certificate chain (`x5c`): run
`c300c565-2409-4f9e-9d13-008ffb2724b3`, 30 checks, 0 failed, and it rejects a broken signature and an
expired credential correctly. But the same matrix shows it also accepts a presentation with no holder
proof, a replayed nonce and the wrong credential type (findings 31–33):
[INTEROPERABILITY-inji-verify.md](INTEROPERABILITY-inji-verify.md).

Every finding has its reproduction, the error
text quoted verbatim, the blast radius and a fix estimate in [FINDINGS.md](FINDINGS.md). Write-ups
ready to file upstream are in [upstream-issues/](upstream-issues/).

## 4. All three Inji modules, on Collab

Inji Certify → Inji Web → Inji Verify on MOSIP's Collab sandbox: **valid**, and confirmed by local
Inji Verify and by the playground's own verifier. Imported as run
`cbf7251e-2e0a-4653-aa20-230dd74fbbfd` (7 passed, 0 failed, 3 warned), which loads into the History
tab. Steps and exchanges: [COLLAB-ALL-INJI.md](COLLAB-ALL-INJI.md).

## 5. Phone wallet

Issuing to and presenting from Inji Wallet on a real phone needs a person and a public tunnel URL.
The procedure and what was verified are in [PHONE-TEST.md](PHONE-TEST.md).

## Continuous integration

`.github/workflows/ci.yml` runs type checks, unit tests, the reference matrix and a regression check against `docs/baseline-reference.json` on every push.
`.github/workflows/nightly-collab.yml` runs the matrix against MOSIP's Collab environment nightly.
