# Interoperability report

Generated 2026-09-01T06:53:53.647Z by `scripts/run-matrix.mjs`.

Every row is a real end-to-end `issue → hold → present → verify` cycle with all protocol
exchanges captured.

## Configuration

| | |
| --- | --- |
| Issuer | Reference Issuer (OpenID4VCI) (`reference-issuer`, mock) |
| Wallet | Reference Wallet (headless) (`reference-wallet`, mock) |
| Verifier | Inji Verify (`inji-verify`, inji) |
| Runs | 2 |
| Passed | 0 |
| Failed | 2 |
| Traceability | full |

## Matrix

| Format | Fault injected | Result | Verdict | Pass | Fail | Expected fail | Warn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ldp_vc` | `none` | **failed** | — | 18 | 0 | 0 | 1 |
| `vc+sd-jwt` | `none` | **failed** | — | 14 | 2 | 0 | 2 |

A run with an injected fault passes when the verifier **rejects** the credential.
`Expected fail` counts checks that failed because the fault was correctly detected.

## Findings

- **Authorization request parameters use the specified names** — `warn`, 2 run(s). verify-service returns its authorization request as a camelCase envelope (clientId, responseUri, presentationDefinition). OpenID4VP defines these as client_id, response_uri and presentation_definition, so the caller must translate before handing the request to a wallet.
- **Wallet discloses only the requested claims** — `warn`, 1 run(s). The request did not constrain individual claims, so all 5 were disclosed. A verifier asking for limit_disclosure should also name the fields it needs.
- **Inji Verify credential 1 status** — `fail`, 1 run(s). verificationStatus = UNKNOWN
- **Verification succeeded** — `fail`, 1 run(s). Verifier reported "invalid" but this run expected one of: valid. 

## Conformance checks exercised

22 distinct assertions across this run set.

| Check | Specification clause |
| --- | --- |
| Authorization request parameters use the specified names | OpenID4VP §5 |
| Authorization server advertises the pre-authorized code grant | OpenID4VCI §3.5, RFC 8414 |
| Credential carries a credential subject | W3C VC Data Model §4.4 |
| Credential issuer is a resolvable identifier | W3C VC Data Model §4.5 |
| Credential response carries a credential | OpenID4VCI §7.3 |
| Every @context entry resolves to a JSON-LD context | W3C VC Data Model §4.1, JSON-LD 1.1 §3.1 |
| Inji Verify credential 1 status | Inji Verify verification result |
| Issued credential is in the requested format | OpenID4VCI §7.3 |
| Issuer advertises the requested credential format | OpenID4VCI §11.2.3 |
| Issuer supplied a nonce for the holder proof | OpenID4VCI §7.2 (c_nonce) / §8 (Nonce Endpoint) |
| Metadata advertises a credential endpoint | OpenID4VCI §11.2.3 |
| Metadata uses the draft-13+ credential_configurations_supported shape | OpenID4VCI §11.2.3 |
| Offer carries a pre-authorized code | OpenID4VCI §4.1.1 |
| Offer names the credential issuer | OpenID4VCI §4.1.1 |
| Offer uses credential_configuration_ids | OpenID4VCI §4.1.1 |
| Proof JWT carries exactly one key identifier | OpenID4VCI §7.2.1 |
| Proof verification method identifies a single key | W3C VC Data Integrity §2.2 |
| Token response uses the Bearer token type | OpenID4VCI §6.2 / RFC 6749 §5.1 |
| Verification succeeded | An untampered credential must verify. |
| Verifier honoured the requested nonce | OpenID4VP §5 |
| Verifier requested a supported response mode | OpenID4VP §6.2 |
| Wallet discloses only the requested claims | OpenID4VP §7 / SD-JWT VC §5 |

## Reproducing

```bash
npm run dev            # in one terminal
npm run matrix         # in another
```

Each run is written to `runs/<id>.json` with its full exchange log, so any row above can
be re-read in full without re-running it.
