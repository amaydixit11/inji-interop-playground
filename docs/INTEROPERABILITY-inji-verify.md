# Interoperability report

Generated 2026-10-23T12:00:10.353Z by `scripts/run-matrix.mjs`.

Every row is a real end-to-end `issue → hold → present → verify` cycle with all protocol
exchanges captured.

## Configuration

| | |
| --- | --- |
| Issuer | Reference Issuer (OpenID4VCI) (`reference-issuer`, mock) |
| Wallet | Reference Wallet (headless) (`reference-wallet`, mock) |
| Verifier | Inji Verify (`inji-verify`, inji) |
| Runs | 21 |
| Passed | 9 |
| Failed | 12 |
| Traceability | full |

## Matrix

| Format | Suite | Revision | Fault injected | Result | Verdict | Pass | Fail | Expected fail | Warn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `none` | **failed** | — | 29 | 1 | 0 | 2 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **failed** | — | 29 | 0 | 1 | 2 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **failed** | — | 29 | 0 | 1 | 3 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **failed** | — | 29 | 0 | 1 | 2 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **failed** | — | 29 | 0 | 1 | 2 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **failed** | — | 29 | 0 | 1 | 2 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **failed** | — | 29 | 0 | 1 | 2 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `none` | **failed** | — | 25 | 3 | 0 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | — | 26 | 0 | 2 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | — | 26 | 0 | 2 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | — | 26 | 0 | 2 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | — | 26 | 0 | 2 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | — | 26 | 0 | 2 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **passed** | — | 26 | 0 | 2 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | — | 30 | 0 | 0 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | — | 26 | 0 | 2 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | — | 29 | 0 | 0 | 4 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **failed** | — | 29 | 1 | 0 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **failed** | — | 29 | 1 | 0 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **failed** | — | 29 | 1 | 0 | 3 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **failed** | — | 29 | 1 | 0 | 3 |

A run with an injected fault passes when the verifier **rejects** the credential.
`Expected fail` counts checks that failed because the fault was correctly detected.

## Fault detection

| Format | Fault | Detected by |
| --- | --- | --- |
| `ldp_vc` | `break-signature` | Verifier accepts the issued credential on its own |
| `ldp_vc` | `expire-credential` | Verifier accepts the issued credential on its own |
| `ldp_vc` | `wrong-type` | Verifier accepts the issued credential on its own |
| `ldp_vc` | `strip-holder-proof` | Verifier accepts the issued credential on its own |
| `ldp_vc` | `replay-nonce` | Verifier accepts the issued credential on its own |
| `ldp_vc` | `revoke-credential` | Verifier accepts the issued credential on its own |
| `vc+sd-jwt` | `break-signature` | Verifier accepts the issued credential on its own; Inji Verify: Signature and schema |
| `vc+sd-jwt` | `expire-credential` | Verifier accepts the issued credential on its own; Inji Verify: Signature and schema |
| `vc+sd-jwt` | `wrong-type` | Verifier accepts the issued credential on its own; Inji Verify: Signature and schema |
| `vc+sd-jwt` | `strip-holder-proof` | Verifier accepts the issued credential on its own; Inji Verify: Signature and schema |
| `vc+sd-jwt` | `replay-nonce` | Verifier accepts the issued credential on its own; Inji Verify: Signature and schema |
| `vc+sd-jwt` | `revoke-credential` | Verifier accepts the issued credential on its own; Inji Verify: Signature and schema |
| `vc+sd-jwt` | `break-signature` | Verifier accepts the issued credential on its own; Inji Verify: Signature and schema |
| `vc+sd-jwt` | `expire-credential` | **not detected** |
| `vc+sd-jwt` | `wrong-type` | **not detected** |
| `vc+sd-jwt` | `strip-holder-proof` | **not detected** |
| `vc+sd-jwt` | `replay-nonce` | **not detected** |
| `vc+sd-jwt` | `revoke-credential` | **not detected** |

## Findings

- **This run can be attributed to specific participant builds** — `warn`, 21 run(s). No version available for inji-verify. http://localhost:8010/v1/verify/actuator/info returned HTTP 404. Without it a result cannot be tied to a release, so a regression cannot be attributed to a change. Set a "version" override on the participant to label the run by hand.
- **Authorization request parameters use the specified names** — `warn`, 21 run(s). The /vp-request response is a camelCase envelope (clientId, responseUri, presentationDefinition) rather than the specified client_id, response_uri and presentation_definition. This affects only a caller wiring a wallet against that API directly — the request object served at the request_uri does use the specified names, so the normal cross-device path is unaffected.
- **Inji Verify: Revocation status was checked** — `warn`, 14 run(s). verify-service returned an empty status list. Its log reports status checking as unsupported for this credential format, so a revoked credential would be accepted.
- **Verifier accepts the issued credential on its own** — `fail`, 1 run(s). verify-service rejected the credential before any presentation was involved: ERR_SIGNATURE_VERIFICATION_FAILED — Exception during Verification: Error while doing verification of verifiable credential: foundation.identity.jsonld.JsonLDException: There was a problem encountered loading a remote context [code=LOADING_REMOTE_CONTEXT_FAILED].. Whatever happens in the OpenID4VP exchange, the credential itself cannot be read by this verifier.
- **Wallet presents an expired credential rather than blocking it** — `warn`, 1 run(s). The held credential is past its expiration date. This wallet forwards it so the verifier can be observed rejecting it; a production wallet may instead refuse to present it at all.
- **Verifier accepts the issued credential on its own** — `fail`, 1 run(s). verify-service rejected the credential before any presentation was involved: ERR_SIGNATURE_VERIFICATION_FAILED — Exception during Verification: getX509CertChain(...) must not be null. Whatever happens in the OpenID4VP exchange, the credential itself cannot be read by this verifier.
- **Inji Verify: Signature and schema** — `fail`, 1 run(s). ERR_SIGNATURE_VERIFICATION_FAILED — Exception during Verification: getX509CertChain(...) must not be null
- **Verification succeeded** — `fail`, 1 run(s). Verifier reported "invalid" but this run expected one of: valid. 
- **Inji Verify: Within validity period** — `warn`, 1 run(s). Inji Verify reports the credential as expired.
- **Verifier correctly rejected the tampered credential (wrong-type)** — `fail`, 1 run(s). Verifier reported "valid" but this run expected one of: invalid, error. Accepting a deliberately corrupted credential is a verifier defect.
- **Verifier correctly rejected the tampered credential (strip-holder-proof)** — `fail`, 1 run(s). Verifier reported "valid" but this run expected one of: invalid, error. Accepting a deliberately corrupted credential is a verifier defect.
- **Verifier correctly rejected the tampered credential (replay-nonce)** — `fail`, 1 run(s). Verifier reported "valid" but this run expected one of: invalid, error. Accepting a deliberately corrupted credential is a verifier defect.
- **Verifier correctly rejected the tampered credential (revoke-credential)** — `fail`, 1 run(s). Verifier reported "valid" but this run expected one of: invalid, error. Accepting a deliberately corrupted credential is a verifier defect.

## Conformance checks exercised

45 distinct assertions across this run set.

| Check | Specification clause |
| --- | --- |
| Authorization request parameters use the specified names | OpenID4VP §5 |
| Authorization server advertises the pre-authorized code grant | OpenID4VCI §3.5, RFC 8414 |
| Credential carries a credential subject | W3C VC Data Model §4.4 |
| Credential issuer is a resolvable identifier | W3C VC Data Model §4.5 |
| Credential offer URI fits in a scannable QR code | ISO/IEC 18004 (QR capacity) / OpenID4VP §5.10 |
| Credential uses the W3C data model it was issued under (1.1) | W3C VC Data Model 1.1 §4.6 / 2.0 §4.8 |
| Every @context entry resolves to a JSON-LD context | W3C VC Data Model §4.1, JSON-LD 1.1 §3.1 |
| Inji Verify: Holder proof | Inji Verify credential verification |
| Inji Verify: Revocation status was checked | W3C Bitstring Status List / IETF Token Status List |
| Inji Verify: Signature and schema | Inji Verify credential verification |
| Inji Verify: Within validity period | Inji Verify credential verification |
| Issued credential is in the requested format | OpenID4VCI §7.3 |
| Issuer advertises the requested credential format | OpenID4VCI §11.2.3 |
| Issuer publishes resolvable key material at its identifier | did:web method / RFC 7517 |
| Issuer supplied a nonce for the holder proof | OpenID4VCI §7.2 (c_nonce) / §8 (Nonce Endpoint) |
| Metadata advertises a credential endpoint | OpenID4VCI §11.2.3 |
| Metadata uses the draft-13+ credential_configurations_supported shape | OpenID4VCI §11.2.3 |
| Offer advertises a grant the wallet can complete | OpenID4VCI §4.1.1 |
| Offer carries a pre-authorized code | OpenID4VCI §4.1.1 |
| Offer names the credential issuer | OpenID4VCI §4.1.1 |
| Offer uses credential_configuration_ids | OpenID4VCI §4.1.1 |
| OpenID4VP request URI (QR payload) fits in a scannable QR code | ISO/IEC 18004 (QR capacity) / OpenID4VP §5.10 |
| Proof JWT carries exactly one key identifier | OpenID4VCI §7.2.1 |
| Proof verification method identifies a single key | W3C VC Data Integrity §2.2 |
| Request is small enough to scan because it is passed by reference | OpenID4VP §5.10 (request_uri) |
| Request object is a signed JWT | OpenID4VP §5.10, JAR (RFC 9101) |
| Request object uses the specified parameter names | OpenID4VP §5 |
| Response carries a credential in the shape draft-13 defines | OpenID4VCI draft 11-13 §7.3 |
| Response carries a presentation submission | OpenID4VP 1.0 §8.1 / OpenID4VP draft 21 §6.1 |
| Response omits the format, as draft-13 requires | OpenID4VCI draft 12 §7.3 vs draft 13 §7.3 |
| This run can be attributed to specific participant builds | Playground provenance |
| Token response uses the Bearer token type | OpenID4VCI §6.2 / RFC 6749 §5.1 |
| Verification succeeded | An untampered credential must verify. |
| Verifier accepts the issued credential on its own | W3C VC Data Model / Inji Verify credential verification |
| Verifier correctly rejected the tampered credential (break-signature) | A tampered credential must be rejected. |
| Verifier correctly rejected the tampered credential (expire-credential) | An expired credential must be reported as expired, or at minimum rejected. |
| Verifier correctly rejected the tampered credential (replay-nonce) | A tampered credential must be rejected. |
| Verifier correctly rejected the tampered credential (revoke-credential) | A revoked credential must be rejected even though its signature is intact. |
| Verifier correctly rejected the tampered credential (strip-holder-proof) | A tampered credential must be rejected. |
| Verifier correctly rejected the tampered credential (wrong-type) | A tampered credential must be rejected. |
| Verifier honoured the requested nonce | OpenID4VP §5 |
| Verifier requested a supported response mode | OpenID4VP §6.2 |
| Wallet discloses only the requested claims | OpenID4VP §7 / SD-JWT VC §5 |
| Wallet presents an expired credential rather than blocking it | Playground wallet policy |
| assertionMethod entries reference a verification method | DID Core §5.3.2 |

## Reproducing

```bash
npm run dev            # in one terminal
npm run matrix         # in another
```

Each run is written to `runs/<id>.json` with its full exchange log, so any row above can
be re-read in full without re-running it.
