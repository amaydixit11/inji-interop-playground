# Test data

You don't need an account, password or API key to evaluate the playground. Everything below is
created locally on first start.

## Sample credential subject

Every credential is issued with these claims unless a run overrides `claims`
(`apps/bff/src/core/credentials.ts`):

```json
{
  "fullName": "Ada Lovelace",
  "dateOfBirth": "1815-12-10",
  "gender": "Female",
  "nationality": "GB",
  "idNumber": "INJI-0000-0001"
}
```

For SD-JWT credentials the reference verifier asks for `fullName` and `dateOfBirth` only, so selective disclosure is
visible: the other three claims are withheld by the wallet.

## Keys and identifiers

Generated into `.keys/` on first start and gitignored. Delete the folder to rotate them.

| | Value with the default `PUBLIC_URL=http://localhost:8787` |
|---|---|
| Issuer DID | `did:web:localhost%3A8787:issuer` → `/issuer/did.json` |
| Wallet DID | `did:web:localhost%3A8787:wallet` → `/wallet/did.json` |
| Issuer JWKS | `http://localhost:8787/mock-issuer/.well-known/jwks.json` |
| Signing | Ed25519 for Data Integrity and SD-JWT; P-256 for mDoc |

## Participants

| Role | id | Needs |
|---|---|---|
| Issuer | `reference-issuer` | nothing |
| Issuer | `inji-certify` | `docker compose -f docker-compose.inji.yml up` |
| Issuer | `external-issuer` | its URL in the run's `overrides` |
| Wallet | `reference-wallet` | nothing (headless) |
| Wallet | `inji-wallet` | a phone with Inji Wallet and a public `PUBLIC_URL`: [PHONE-TEST.md](PHONE-TEST.md) |
| Wallet | `inji-web` | `INJI_WEB_URL` |
| Verifier | `reference-verifier` | nothing |
| Verifier | `inji-verify` | the Inji compose stack |
| Verifier | `external-verifier` | its URL in the run's `overrides` |

## Ready-made run configurations

The **Scenarios** panel in the UI runs these in one click (`packages/shared/src/scenarios.ts`):

| Scenario | Question it answers |
|---|---|
| `happy-path` | Does the whole cycle work? |
| `selective-disclosure` | Can the holder reveal only part of a credential? |
| `forged-signature` | Does the verifier catch a forged credential? |
| `revoked` | Is a revoked credential still accepted? |
| `mdoc` | Does an ISO mobile driving licence work? |
| `replay` | Can a captured presentation be replayed? |
| `same-device` | What changes in a same-device flow? |

Minimal API run, no Docker needed:

```json
{
  "issuerId": "reference-issuer",
  "walletId": "reference-wallet",
  "verifierId": "reference-verifier",
  "format": "ldp_vc",
  "proofType": "Ed25519Signature2020",
  "walletProofType": "jwt",
  "tamper": "none"
}
```

## Pinned Inji versions

From `docker-compose.inji.yml`. These are the exact builds every finding was measured against.

| Service | Image |
|---|---|
| Inji Certify | `injistack/inji-certify-with-plugins:0.14.0` |
| Inji Verify | `injistack/inji-verify-service:0.18.2` |
| Mimoto | `injistack/mimoto:0.21.0` |
| Inji Web | `injistack/inji-web:0.16.0` |

The Postgres databases in that stack use the defaults from MOSIP's published compose files. They
are local throwaway containers, not real accounts.

## Recorded runs

Saved to `runs/<runId>.json` (gitignored). `docs/baseline-reference.json` is the committed baseline
the CI regression check compares against.
