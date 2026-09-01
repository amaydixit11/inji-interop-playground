# Interoperability report

Generated 2026-09-01T15:28:25.587Z by `scripts/run-matrix.mjs`.

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

| Format | Suite | Revision | Fault injected | Result | Verdict | Pass | Fail | Expected fail | Warn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `none` | **failed** | — | 21 | 1 | 0 | 1 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `none` | **failed** | — | 17 | 3 | 0 | 2 |

A run with an injected fault passes when the verifier **rejects** the credential.
`Expected fail` counts checks that failed because the fault was correctly detected.

## Findings

- **Authorization request parameters use the specified names** — `warn`, 2 run(s). The /vp-request response is a camelCase envelope (clientId, responseUri, presentationDefinition) rather than the specified client_id, response_uri and presentation_definition. This affects only a caller wiring a wallet against that API directly — the request object served at the request_uri does use the specified names, so the normal cross-device path is unaffected.
- **Verifier accepts the issued credential on its own** — `fail`, 1 run(s). verify-service rejected the credential before any presentation was involved: ERR_SIGNATURE_VERIFICATION_FAILED — Exception during Verification: Error while doing verification of verifiable credential: foundation.identity.jsonld.JsonLDException: There was a problem encountered loading a remote context [code=LOADING_REMOTE_CONTEXT_FAILED].. Whatever happens in the OpenID4VP exchange, the credential itself cannot be read by this verifier.
- **Verifier accepts the issued credential on its own** — `fail`, 1 run(s). verify-service rejected the credential before any presentation was involved: ERR_SIGNATURE_VERIFICATION_FAILED — Exception during Verification: getX509CertChain(...) must not be null. Whatever happens in the OpenID4VP exchange, the credential itself cannot be read by this verifier.
- **Wallet discloses only the requested claims** — `warn`, 1 run(s). The request did not constrain individual claims, so all 5 were disclosed. A verifier asking for limit_disclosure should also name the fields it needs.
- **Inji Verify credential 1 status** — `fail`, 1 run(s). verificationStatus = UNKNOWN
- **Verification succeeded** — `fail`, 1 run(s). Verifier reported "invalid" but this run expected one of: valid. 

## Conformance checks exercised

26 distinct assertions across this run set.

| Check | Specification clause |
| --- | --- |
| Authorization request parameters use the specified names | OpenID4VP §5 |
| Authorization server advertises the pre-authorized code grant | OpenID4VCI §3.5, RFC 8414 |
| Credential carries a credential subject | W3C VC Data Model §4.4 |
| Credential issuer is a resolvable identifier | W3C VC Data Model §4.5 |
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
| Request object is a signed JWT | OpenID4VP §5.10, JAR (RFC 9101) |
| Request object uses the specified parameter names | OpenID4VP §5 |
| Response carries a credential in the shape draft-13 defines | OpenID4VCI draft 11-13 §7.3 |
| Response omits the format, as draft-13 requires | OpenID4VCI draft 12 §7.3 vs draft 13 §7.3 |
| Token response uses the Bearer token type | OpenID4VCI §6.2 / RFC 6749 §5.1 |
| Verification succeeded | An untampered credential must verify. |
| Verifier accepts the issued credential on its own | W3C VC Data Model / Inji Verify credential verification |
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
