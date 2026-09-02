# Interoperability report

Generated 2026-09-02T10:21:12.978Z by `scripts/run-matrix.mjs`.

Every row is a real end-to-end `issue → hold → present → verify` cycle with all protocol
exchanges captured.

## Configuration

| | |
| --- | --- |
| Issuer | Reference Issuer (OpenID4VCI) (`reference-issuer`, mock) |
| Wallet | Reference Wallet (headless) (`reference-wallet`, mock) |
| Verifier | Reference Verifier (OpenID4VP) (`reference-verifier`, mock) |
| Runs | 27 |
| Passed | 27 |
| Failed | 0 |
| Traceability | full |

## Matrix

| Format | Suite | Revision | Fault injected | Result | Verdict | Pass | Fail | Expected fail | Warn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 32 | 0 | 0 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 30 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 30 | 0 | 1 | 2 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 31 | 0 | 1 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 30 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **passed** | `invalid` | 30 | 0 | 2 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 31 | 0 | 0 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 30 | 0 | 0 | 1 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 27 | 0 | 1 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 31 | 0 | 0 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 30 | 0 | 0 | 1 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 27 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `dc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **passed** | `invalid` | 30 | 0 | 1 | 0 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 29 | 0 | 0 | 0 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 28 | 0 | 1 | 0 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 28 | 0 | 0 | 1 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 28 | 0 | 1 | 0 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 27 | 0 | 1 | 1 |
| `mso_mdoc` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 28 | 0 | 1 | 0 |

A run with an injected fault passes when the verifier **rejects** the credential.
`Expected fail` counts checks that failed because the fault was correctly detected.

## Fault detection

| Format | Fault | Detected by |
| --- | --- | --- |
| `ldp_vc` | `break-signature` | Verifier accepts the issued credential on its own; Presentation and credential proofs verify |
| `ldp_vc` | `expire-credential` | Verifier accepts the issued credential on its own |
| `ldp_vc` | `wrong-type` | Presentation satisfies the presentation definition |
| `ldp_vc` | `strip-holder-proof` | Presentation carries a holder proof |
| `ldp_vc` | `replay-nonce` | Presentation and credential proofs verify; Holder echoed the verifier nonce |
| `ldp_vc` | `revoke-credential` | Presentation and credential proofs verify; Credential has not been revoked |
| `vc+sd-jwt` | `break-signature` | Issuer signature verifies |
| `vc+sd-jwt` | `expire-credential` | **not detected** |
| `vc+sd-jwt` | `wrong-type` | Presentation satisfies the presentation definition |
| `vc+sd-jwt` | `strip-holder-proof` | Presentation includes a key binding JWT |
| `vc+sd-jwt` | `replay-nonce` | Key binding JWT echoes the verifier nonce |
| `vc+sd-jwt` | `revoke-credential` | Credential has not been revoked |
| `dc+sd-jwt` | `break-signature` | Issuer signature verifies |
| `dc+sd-jwt` | `expire-credential` | **not detected** |
| `dc+sd-jwt` | `wrong-type` | Presentation satisfies the presentation definition |
| `dc+sd-jwt` | `strip-holder-proof` | Presentation includes a key binding JWT |
| `dc+sd-jwt` | `replay-nonce` | Key binding JWT echoes the verifier nonce |
| `dc+sd-jwt` | `revoke-credential` | Credential has not been revoked |
| `mso_mdoc` | `break-signature` | Issuer authentication verifies |
| `mso_mdoc` | `expire-credential` | **not detected** |
| `mso_mdoc` | `wrong-type` | Presentation satisfies the presentation definition |
| `mso_mdoc` | `strip-holder-proof` | Document includes device authentication |
| `mso_mdoc` | `replay-nonce` | Device authentication verifies against the session transcript |

## Findings

- **Wallet presents an expired credential rather than blocking it** — `warn`, 1 run(s). The held credential is past its expiration date. This wallet forwards it so the verifier can be observed rejecting it; a production wallet may instead refuse to present it at all.
- **Credential is within its validity window** — `warn`, 1 run(s). The credential expiration date is in the past.
- **Credential is within its validity window** — `warn`, 1 run(s). Credential expired at 2026-09-01T10:21:03.000Z.
- **Credential is within its validity window** — `warn`, 1 run(s). Credential expired at 2026-09-01T10:21:07.000Z.
- **Document is within its validity window** — `warn`, 1 run(s). validUntil was 2026-09-01T10:21:10.956Z.
- **DeviceResponse binds to this request** — `warn`, 1 run(s). Device authentication omitted; the response proves issuance but not possession.

## Conformance checks exercised

55 distinct assertions across this run set.

| Check | Specification clause |
| --- | --- |
| Authorization server advertises the pre-authorized code grant | OpenID4VCI §3.5, RFC 8414 |
| Credential carries a credential subject | W3C VC Data Model §4.4 |
| Credential has not been revoked | OpenID4VP §7 / credential format specification |
| Credential is within its validity window | OpenID4VP §7 / credential format specification |
| Credential issuer is a resolvable identifier | W3C VC Data Model §4.5 |
| Credential offer URI fits in a scannable QR code | ISO/IEC 18004 (QR capacity) / OpenID4VP §5.10 |
| Credential uses the W3C data model it was issued under (1.1) | W3C VC Data Model 1.1 §4.6 / 2.0 §4.8 |
| Device authentication verifies against the session transcript | OpenID4VP §7 / credential format specification |
| DeviceResponse binds to this request | ISO/IEC 18013-5 §9.1.3, ISO/IEC 18013-7 Annex B |
| DeviceResponse reports success status | OpenID4VP §7 / credential format specification |
| Disclosed elements match the signed digests | OpenID4VP §7 / credential format specification |
| Disclosures match the issuer-signed digests | OpenID4VP §7 / credential format specification |
| Document includes device authentication | OpenID4VP §7 / credential format specification |
| Document is within its validity window | OpenID4VP §7 / credential format specification |
| Document type matches the signed MobileSecurityObject | OpenID4VP §7 / credential format specification |
| Every @context entry resolves to a JSON-LD context | W3C VC Data Model §4.1, JSON-LD 1.1 §3.1 |
| Holder echoed the verifier nonce | OpenID4VP §7 / credential format specification |
| Issued credential is in the requested format | OpenID4VCI §7.3 |
| Issuer advertises the requested credential format | OpenID4VCI §11.2.3 |
| Issuer authentication verifies | OpenID4VP §7 / credential format specification |
| Issuer publishes resolvable key material at its identifier | did:web method / RFC 7517 |
| Issuer signature verifies | OpenID4VP §7 / credential format specification |
| Issuer supplied a nonce for the holder proof | OpenID4VCI §7.2 (c_nonce) / §8 (Nonce Endpoint) |
| Key binding JWT covers the presented disclosures | OpenID4VP §7 / credential format specification |
| Key binding JWT echoes the verifier nonce | OpenID4VP §7 / credential format specification |
| Key binding JWT is addressed to this verifier | OpenID4VP §7 / credential format specification |
| Key binding JWT is signed by the confirmed holder key | OpenID4VP §7 / credential format specification |
| Metadata advertises a credential endpoint | OpenID4VCI §11.2.3 |
| Metadata uses the draft-13+ credential_configurations_supported shape | OpenID4VCI §11.2.3 |
| Offer carries a pre-authorized code | OpenID4VCI §4.1.1 |
| Offer names the credential issuer | OpenID4VCI §4.1.1 |
| Offer uses credential_configuration_ids | OpenID4VCI §4.1.1 |
| OpenID4VP request URI (QR payload) fits in a scannable QR code | ISO/IEC 18004 (QR capacity) / OpenID4VP §5.10 |
| Presentation and credential proofs verify | OpenID4VP §7 / credential format specification |
| Presentation carries a holder proof | OpenID4VP §7 / credential format specification |
| Presentation includes a key binding JWT | OpenID4VP §7 / credential format specification |
| Presentation satisfies the presentation definition | OpenID4VP §7 / credential format specification |
| Proof JWT carries exactly one key identifier | OpenID4VCI §7.2.1 |
| Proof verification method identifies a single key | W3C VC Data Integrity §2.2 |
| Response carries a credential in the shape draft-13 defines | OpenID4VCI draft 11-13 §7.3 |
| Response omits the format, as draft-13 requires | OpenID4VCI draft 12 §7.3 vs draft 13 §7.3 |
| This run can be attributed to specific participant builds | Playground provenance |
| Token response uses the Bearer token type | OpenID4VCI §6.2 / RFC 6749 §5.1 |
| Verification succeeded | An untampered credential must verify. |
| Verifier accepts the issued credential on its own | W3C VC Data Model |
| Verifier correctly rejected the tampered credential (break-signature) | A tampered credential must be rejected. |
| Verifier correctly rejected the tampered credential (expire-credential) | An expired credential must be reported as expired, or at minimum rejected. |
| Verifier correctly rejected the tampered credential (replay-nonce) | A tampered credential must be rejected. |
| Verifier correctly rejected the tampered credential (revoke-credential) | A revoked credential must be rejected even though its signature is intact. |
| Verifier correctly rejected the tampered credential (strip-holder-proof) | A tampered credential must be rejected. |
| Verifier correctly rejected the tampered credential (wrong-type) | A tampered credential must be rejected. |
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
