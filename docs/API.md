# API

One Node process (`apps/bff`) serves everything below, on `PUBLIC_URL` (default `http://localhost:8787`).

| Prefix | What it is |
|---|---|
| `/api/*` | Playground control API, used by the web UI to start and inspect runs |
| `/ws` | WebSocket stream of live run events |
| `/mock-issuer/*` | Hosted reference issuer (OpenID4VCI) |
| `/mock-verifier/*` | Hosted reference verifier (OpenID4VP) |
| `/proxy/verify/*` | Same-origin passthrough to the configured Inji Verify `verify-service` |
| `/issuer/did.json`, `/wallet/did.json` | `did:web` documents for the playground's issuer and wallet keys |

**Authentication.** The control API has none: the playground is a local sandbox and is not meant to
be exposed publicly. The reference issuer's credential endpoint takes an OAuth `Bearer` access token
from its own `/token` endpoint, as OpenID4VCI requires.

**Errors.** Every endpoint answers failures as `{ "error": "<code>", "error_description": "..." }`
(the control API uses `message` instead of `error_description`).

---

## Control API

### `GET /api/health`

```json
{ "status": "ok", "publicUrl": "http://localhost:8787" }
```

### `GET /api/participants`

Lists every issuer, wallet and verifier a run can use.

```json
{
  "participants": [
    { "id": "reference-issuer", "role": "issuer", ... },
    { "id": "inji-certify", "role": "issuer", ... },
    { "id": "reference-wallet", "role": "wallet", ... },
    { "id": "inji-verify", "role": "verifier", ... }
  ],
  "publicUrl": "http://localhost:8787"
}
```

Ids: issuers `reference-issuer`, `inji-certify`, `external-issuer`; wallets `reference-wallet`,
`inji-wallet`, `inji-web`; verifiers `reference-verifier`, `inji-verify`, `external-verifier`.

### `POST /api/runs`

Starts a run: issue a credential, put it in a wallet, present it to a verifier, check every step.
Returns at once with `202`; follow progress on `/ws` or by polling `GET /api/runs/:id`.

Request (`RunConfig`, `packages/shared/src/domain.ts`):

| Field | Required | Values |
|---|---|---|
| `issuerId`, `walletId`, `verifierId` | yes | participant ids above |
| `format` | yes | `ldp_vc`, `vc+sd-jwt`, `dc+sd-jwt`, `mso_mdoc` |
| `proofType` | yes | `Ed25519Signature2020`, `Ed25519Signature2018`, `DataIntegrityProof`, `RsaSignature2018`, `ES256`, `EdDSA`, `RS256` |
| `walletProofType` | yes | `jwt`, `cwt`, `none` |
| `tamper` | yes | `none`, `break-signature`, `expire-credential`, `wrong-type`, `replay-nonce`, `strip-holder-proof`, `revoke-credential`, `replay-response-code` |
| `vciDraft` | no | `draft-11`, `draft-12`, `draft-13` (default), `1.0` |
| `flowMode` | no | `cross-device` (default), `same-device` |
| `vcVersion` | no | `1.1` (default), `2.0` |
| `issuerKeyReference` | no | `did` (default), `x5c` |
| `queryLanguage` | no | `presentation-exchange` (default), `dcql` |
| `grantType` | no | `pre-authorized_code` (default), `authorization_code` |
| `stopAfter` | no | `discover`, `offer`, `issue`, `present`, `verify`: end the run early |
| `claims` | no | object; defaults to a sample identity |
| `overrides` | no | `{ "<participantId>": { "<field>": "<value>" } }` |

```bash
curl -X POST localhost:8787/api/runs -H 'content-type: application/json' -d '{
  "issuerId": "reference-issuer", "walletId": "reference-wallet", "verifierId": "reference-verifier",
  "format": "ldp_vc", "proofType": "Ed25519Signature2020", "walletProofType": "jwt", "tamper": "none"
}'
```

```json
{ "runId": "95925553-0ca4-4bd4-aa76-0663c59360aa" }
```

Every field is checked before the run starts: an unknown `format`, `tamper`, `stopAfter` or other
option is refused with `400 invalid_configuration` and the allowed values, rather than run as the
default. A body that is not JSON gets `400 invalid_json`.

`400 invalid_configuration` when an id is unknown:

```json
{ "error": "invalid_configuration", "message": "Error: No issuer registered with id \"nope\". Available: reference-issuer, inji-certify, external-issuer" }
```

### `GET /api/runs`

Summaries of every saved run.

### `GET /api/runs/:id`

The full run record: `id`, `config`, `status`, `startedAt`, `finishedAt`, `participants`, `steps`,
`exchanges` (every HTTP request/response), `checks` (conformance results), `artifacts`, `summary`,
`narrative`, `versions`, `traceability`. `404 not_found` if unknown.

`status` is one of `pending`, `running`, `awaiting-user`, `passed`, `failed`, `aborted`.

```json
{
  "status": "passed",
  "summary": {
    "checksPassed": 34, "checksFailed": 0, "checksWarned": 0, "checksExpectedFailures": 0,
    "durationMs": 1318,
    "stepDurations": { "discover": 15, "offer": 5, "issue": 1277, "present": 20, "verify": 1 }
  }
}
```

### `GET /api/runs/:id/events`

Every event emitted so far, so a client that connects late can catch up: `{ "events": [ ... ] }`.

### `POST /api/runs/:id/actions/:actionId`

Tells a run that a person finished an out-of-band step, such as scanning a QR code with a phone
wallet. `200 { "status": "ok" }`, `404` if the run is not active, `409 no_pending_action` if that
action is not being waited on.

### `POST /api/runs/:id/abort`

Stops an active run. `200 { "status": "ok" }` or `404`.

### `GET /api/stats`

Aggregates over all saved runs: totals, pass counts, p50/p95 latency, per-step medians, and
breakdowns by format and by issuer.

```json
{ "total": 21, "passed": 18, "failed": 3, "durationP50": 55, "durationP95": 1171,
  "stepMedians": { "discover": 9, "offer": 4, "issue": 13, "present": 14, "verify": 2 },
  "byFormat": [ { "key": "ldp_vc", "total": 15, "passed": 12, "durationP50": 107 } ], ... }
```

---

## WebSocket `/ws`

Connect to `ws://<host>/ws`. The server pushes every run's events as JSON; it reads nothing from the client.

| `type` | Payload |
|---|---|
| `run.started` | `config` |
| `step.status` | `step`, `status`, `note?` |
| `http` | `exchange`: one captured request/response |
| `check` | `check`: one conformance result |
| `artifact` | `artifact`: credential, presentation, QR and so on |
| `log` | `level`, `message` |
| `user.action` | `action`: a QR to scan or a link to open |
| `run.finished` | `status`, `summary` |

Every event also carries `runId` and `at` (ISO timestamp).

---

## Reference issuer `/mock-issuer`

Standard OpenID4VCI. A wallet only needs the issuer URL `http://localhost:8787/mock-issuer`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/.well-known/openid-credential-issuer` | Issuer metadata and supported credential configurations |
| GET | `/.well-known/oauth-authorization-server` | Token and authorize endpoints; both grants; PKCE `S256` |
| GET | `/.well-known/jwks.json` | Issuer public keys |
| GET | `/.well-known/did.json` | Issuer DID document |
| POST | `/offers` | *Playground only.* Creates a credential offer |
| GET | `/credential-offer/:id` | The offer by reference |
| GET | `/authorize` | Authorization code grant; consents at once and redirects with `code` |
| POST | `/token` | Exchanges a pre-authorized code or authorization code for an access token |
| POST | `/nonce` | A fresh `c_nonce` |
| POST | `/credential` | Issues the credential (draft 13 / 1.0 response) |
| POST | `/vd11/credential`, `/vd12/credential` | The same, in the draft 11 / 12 response shape |
| GET | `/status-list/:id` | Revocation list as a signed W3C VC (for `ldp_vc`) |
| GET | `/token-status-list/:id` | The same list as a Token Status List JWT (for SD-JWT) |
| POST | `/status-list/:id/revoke` | *Playground only.* `{ "index": 3 }` revokes one credential |

### `POST /mock-issuer/offers`

All fields are optional: `format` (default `ldp_vc`), `claims`, `proofType`, `vcVersion`,
`issuerKeyReference`, `grantType`, `tamper`, `txCode`.

```bash
curl -X POST localhost:8787/mock-issuer/offers -H 'content-type: application/json' -d '{"format":"vc+sd-jwt"}'
```

```json
{
  "offer_id": "5764a7aa-8c34-4f54-b77a-7e6766f93b00",
  "credential_offer": {
    "credential_issuer": "http://localhost:8787/mock-issuer",
    "credential_configuration_ids": ["InteropTestCredential_sd_jwt"],
    "grants": { "urn:ietf:params:oauth:grant-type:pre-authorized_code": { "pre-authorized_code": "gQqdS7aZG7kTGsCZ6WtSax3YfP37E_wD" } }
  },
  "credential_offer_uri": "http://localhost:8787/mock-issuer/credential-offer/5764a7aa-8c34-4f54-b77a-7e6766f93b00",
  "offer_deeplink": "openid-credential-offer://?credential_offer=...",
  "offer_by_reference": "openid-credential-offer://?credential_offer_uri=..."
}
```

### `POST /mock-issuer/token`

Form-encoded. Pre-authorized code:

```bash
curl -X POST localhost:8787/mock-issuer/token \
  -d 'grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code&pre-authorized_code=<code>'
```

Authorization code: `grant_type=authorization_code&code=<code>&code_verifier=<verifier>&redirect_uri=<uri>`.

```json
{ "access_token": "...", "token_type": "Bearer", "expires_in": 300, "c_nonce": "...", "c_nonce_expires_in": 300,
  "authorization_details": [ { "type": "openid_credential", "credential_configuration_id": "InteropTestCredential_sd_jwt" } ] }
```

Codes are single use. A reused, unknown or expired code returns:

```json
{ "error": "invalid_grant", "error_description": "Unknown or already-redeemed pre-authorized code" }
```

### `POST /mock-issuer/credential`

Header `Authorization: Bearer <access_token>`. Body: `{ "format": "...", "proof": { "proof_type": "jwt", "jwt": "<holder proof bound to c_nonce>" } }`.

```json
{ "credential": "<credential>", "credentials": [ { "credential": "<credential>" } ], "c_nonce": "...", "c_nonce_expires_in": 300 }
```

Errors: `401 invalid_token` (missing or expired token), `400` for a bad holder proof (returns a fresh
`c_nonce`), `400 unsupported_credential_format`. Access tokens are single use.

---

## Reference verifier `/mock-verifier`

Standard OpenID4VP with `direct_post`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/requests` | *Playground only.* Opens a verification session |
| GET | `/request/:requestId` | Authorization request (`request_uri` target) |
| GET | `/presentation-definition/:requestId` | The Presentation Exchange definition |
| POST | `/response` | Wallet posts `vp_token`, `presentation_submission`, `state` |
| GET | `/return?response_code=` | Same-device return; the code works only once |
| GET | `/result/:transactionId` | Verification outcome |
| POST | `/verify-credential` | Verifies one `ldp_vc` with no presentation (mirrors Inji Verify `/v2/vc-verification`) |

### `POST /mock-verifier/requests`

Body (all optional): `format`, `queryLanguage` (`dcql` or Presentation Exchange), `sameDevice`,
`clientId`, `presentationDefinition`.

```json
{
  "transaction_id": "txn-fa9adc64-cbae-47d7-9115-eb6a07386437",
  "request_id": "req-741c5809-6adc-457e-af9b-4284c97059eb",
  "request_uri": "http://localhost:8787/mock-verifier/request/req-741c5809-6adc-457e-af9b-4284c97059eb",
  "authorization_request": { "client_id": "...", "response_type": "vp_token", "response_mode": "direct_post", ... },
  "nonce": "...", "state": "...",
  "response_uri": "http://localhost:8787/mock-verifier/response",
  "deeplink": "openid4vp://authorize?client_id=...&request_uri=...",
  "deeplink_by_value": "openid4vp://authorize?..."
}
```

### `GET /mock-verifier/result/:transactionId`

`status` is `pending`, `error` or `complete`. When `complete`:

```json
{ "transaction_id": "txn-...", "status": "complete", "verdict": "...", "checks": [ ... ], "claims": { ... },
  "presentation_submission": { ... }, "vp_token": "..." }
```

---

## Verify proxy `/proxy/verify/*`

Forwards any method to `VERIFY_BASE_URL` with the same path. It is needed because Inji Verify's
`verify-service` sends no CORS headers, so a browser cannot call it directly. The target is fixed by
configuration and cannot be set per request, so the proxy cannot be used to reach other hosts.
`502 upstream_unreachable` if the service is down.
