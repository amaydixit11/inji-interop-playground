# Interoperability report

Generated 2026-09-01T15:37:23.074Z by `scripts/run-matrix.mjs`.

Every row is a real end-to-end `issue → hold → present → verify` cycle with all protocol
exchanges captured.

## Configuration

| | |
| --- | --- |
| Issuer | Reference Issuer (OpenID4VCI) (`reference-issuer`, mock) |
| Wallet | Reference Wallet (headless) (`reference-wallet`, mock) |
| Verifier | Reference Verifier (OpenID4VP) (`reference-verifier`, mock) |
| Runs | 14 |
| Passed | 14 |
| Failed | 0 |
| Traceability | full |

## Matrix

| Format | Suite | Revision | Fault injected | Result | Verdict | Pass | Fail | Expected fail | Warn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 26 | 0 | 0 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 24 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 24 | 0 | 1 | 2 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 25 | 0 | 1 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 24 | 0 | 1 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 24 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **passed** | `invalid` | 24 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 28 | 0 | 0 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 26 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `expire-credential` | **passed** | `valid-but-expired` | 26 | 0 | 1 | 2 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `wrong-type` | **passed** | `invalid` | 27 | 0 | 1 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `strip-holder-proof` | **passed** | `invalid` | 26 | 0 | 1 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `replay-nonce` | **passed** | `invalid` | 26 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `revoke-credential` | **passed** | `invalid` | 26 | 0 | 2 | 0 |

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
| `ldp_vc` | `break-signature` | Verifier accepts the issued credential on its own; Presentation and credential proofs verify |
| `ldp_vc` | `expire-credential` | Verifier accepts the issued credential on its own |
| `ldp_vc` | `wrong-type` | Presentation satisfies the presentation definition |
| `ldp_vc` | `strip-holder-proof` | Presentation carries a holder proof |
| `ldp_vc` | `replay-nonce` | Presentation and credential proofs verify; Holder echoed the verifier nonce |
| `ldp_vc` | `revoke-credential` | Presentation and credential proofs verify; Credential has not been revoked |

## Findings

- **Wallet presents an expired credential rather than blocking it** — `warn`, 2 run(s). The held credential is past its expiration date. This wallet forwards it so the verifier can be observed rejecting it; a production wallet may instead refuse to present it at all.
- **Credential is within its validity window** — `warn`, 2 run(s). The credential expiration date is in the past.

## Conformance checks exercised

35 distinct assertions across this run set.

| Check | Specification clause |
| --- | --- |
| Authorization server advertises the pre-authorized code grant | OpenID4VCI §3.5, RFC 8414 |
| Credential carries a credential subject | W3C VC Data Model §4.4 |
| Credential has not been revoked | OpenID4VP §7 / credential format specification |
| Credential is within its validity window | OpenID4VP §7 / credential format specification |
| Credential issuer is a resolvable identifier | W3C VC Data Model §4.5 |
| Every @context entry resolves to a JSON-LD context | W3C VC Data Model §4.1, JSON-LD 1.1 §3.1 |
| Holder echoed the verifier nonce | OpenID4VP §7 / credential format specification |
| Issued credential is in the requested format | OpenID4VCI §7.3 |
| Issuer advertises the requested credential format | OpenID4VCI §11.2.3 |
| Issuer supplied a nonce for the holder proof | OpenID4VCI §7.2 (c_nonce) / §8 (Nonce Endpoint) |
| Metadata advertises a credential endpoint | OpenID4VCI §11.2.3 |
| Metadata uses the draft-13+ credential_configurations_supported shape | OpenID4VCI §11.2.3 |
| Offer carries a pre-authorized code | OpenID4VCI §4.1.1 |
| Offer names the credential issuer | OpenID4VCI §4.1.1 |
| Offer uses credential_configuration_ids | OpenID4VCI §4.1.1 |
| Presentation and credential proofs verify | OpenID4VP §7 / credential format specification |
| Presentation carries a holder proof | OpenID4VP §7 / credential format specification |
| Presentation satisfies the presentation definition | OpenID4VP §7 / credential format specification |
| Proof JWT carries exactly one key identifier | OpenID4VCI §7.2.1 |
| Proof verification method identifies a single key | W3C VC Data Integrity §2.2 |
| Response carries a credential in the shape draft-13 defines | OpenID4VCI draft 11-13 §7.3 |
| Response code is redeemable | OpenID4VP §7.2 |
| Response omits the format, as draft-13 requires | OpenID4VCI draft 12 §7.3 vs draft 13 §7.3 |
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
| Verifier returns a redirect_uri for the same-device flow | OpenID4VP §7.2 (response_uri with redirect) |
| Wallet presents an expired credential rather than blocking it | Playground wallet policy |

## Reproducing

```bash
npm run dev            # in one terminal
npm run matrix         # in another
```

Each run is written to `runs/<id>.json` with its full exchange log, so any row above can
be re-read in full without re-running it.
