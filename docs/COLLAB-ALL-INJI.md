# All-Inji flow on the Collab sandbox

Inji Certify issues, Inji Web holds, Inji Verify verifies: all three MOSIP modules, as deployed on
MOSIP's own Collab sandbox. This is the flow the problem statement starts from ("starting with all
three being Inji modules"). Recorded 2026-10-23.

**Result: valid**, and an implementation outside MOSIP agrees.

| | |
|---|---|
| Issuer | StayProtected Insurance on Inji Certify (Collab), signing as `did:web:api.collab.mosip.net:identity-service:56de166e-0e2f-4734-b8e7-be42b3117d39` |
| Wallet | Inji Web, `injiweb.collab.mosip.net`, guest session |
| Verifier | Inji Verify, `injiverify.collab.mosip.net` |
| Credential | W3C VC 1.1, `ldp_vc`, `Ed25519Signature2020`, type `InsuranceCredential` |
| Authorization | eSignet authorization code with PKCE `S256` |
| Presentation | Inji Verify's online-sharing QR (`INJI_OVP://`), DCQL request |
| Playground run | [`evidence/cbf7251e-2e0a-4653-aa20-230dd74fbbfd.json`](evidence/cbf7251e-2e0a-4653-aa20-230dd74fbbfd.json): opens in the History tab |

## Why the playground does not drive this one

The playground drives every flow where it can stand in the protocol path. Here it can't: Inji Web
starts issuance from its own issuer catalogue (no credential offer to hand it), and Inji Verify
fetches the presentation by sending the browser to Inji Web. Both legs happen in the browser.

So the run is captured in the browser (HAR) and imported with `scripts/import-har.mjs`, which files
it as an `endpoint-only` run like the phone-wallet runs: the exchanges appear in the inspector,
sequence diagram, history and report, marked as not traced by the playground. Cookies, tokens,
authorization codes, PKCE verifiers and OAuth `state` are removed before the record is written.

## Reproduce it (about 5 minutes)

1. Open <https://injiweb.collab.mosip.net>, choose **Continue as Guest**.
2. Pick **StayProtected Insurance → Health Insurance → Proceed**.
3. On the eSignet page enter the sample identity from the
   [Inji Web setup guide](https://docs.inji.io/inji-web/try-it-out/inji-web-setup-guide):
   policy number `12345`, full name `insuranceCredentials`, date of birth `2000-01-01`.
   Inji Web saves `InsuranceCredential.pdf`.
4. Open <https://injiverify.collab.mosip.net>, **Upload QR Code**, choose the PDF.
   Inji Verify shows *Congratulations, the given credential is valid!*

To file it in the playground, record each browser leg as a HAR (DevTools → Network → Save all as
HAR), then:

```bash
node scripts/import-har.mjs --issue issue.har --verify verify.har --base http://localhost:8787 --out docs/evidence
```

## What was exchanged

| Step | Exchange | Status |
|---|---|---|
| issue | `GET esignet-insurance…/authorize` (`response_type=code`, `code_challenge_method=S256`) | 200 |
| issue | eSignet `oauth-details` → `authenticate` → `claim-details` → `auth-code` | 200 |
| issue | `POST injiweb…/v1/mimoto/credentials/download` (`grant_type=authorization_code`, `code_verifier`) | 200, PDF |
| present | `POST injiverify…/v1/verify/v2/vp-session-request` (DCQL, `format: ldp_vc`, `require_cryptographic_holder_binding: false`) | 201 |
| present | browser sent to `injiweb…/authorize?response_type=vp_token…` | 200 |
| verify | `POST injiverify…/v1/verify/vp-session-results` | 200, `allChecksSuccessful: true` |

## Three verifiers agree

| Verifier | Result |
|---|---|
| Inji Verify (Collab) | `allChecksSuccessful: true`; signature, schema and expiry valid |
| Inji Verify 0.18.2 (local, `docker-compose.inji.yml`) | `POST /v1/verify/vc-verification` → `{"verificationStatus":"SUCCESS"}` |
| Playground reference verifier (not Inji code) | `{"valid":true,"expired":false,"errors":[]}` |

Control: changing one claim (`policyNumber`) makes the reference verifier return
`{"valid":false,"errors":["Invalid signature."]}`, so the agreement is the signature verifying, not
the check being skipped.

## What it showed

- **Works:** a Collab credential verifies end to end, across all three Inji modules and with an
  independent verifier. The issuer's `did:web` resolves from outside MOSIP.
- **Holder binding not requested.** Inji Verify's own request sets
  `require_cryptographic_holder_binding: false`, so whoever has the PDF can present it. The one-use
  limit below is the only thing standing in for binding.
- **Status not reported.** `statusCheck` is an empty array, so the response cannot tell "no status
  entry" from "not checked" (same shape as [finding 8b](FINDINGS.md#8b-inji-verify-does-not-check-revocation-for-sd-jwt-vc)).
- **The one-use limit works, but fails badly:** [finding 34](FINDINGS.md#34-a-used-up-online-sharing-qr-ends-on-a-raw-http-401).
