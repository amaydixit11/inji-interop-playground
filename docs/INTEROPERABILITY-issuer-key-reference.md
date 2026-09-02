# Interoperability report

Generated 2026-09-02T07:25:48.677Z by `scripts/run-matrix.mjs`.

Every row is a real end-to-end `issue → hold → present → verify` cycle with all protocol
exchanges captured.

## Configuration

| | |
| --- | --- |
| Issuer | Reference Issuer (OpenID4VCI) (`reference-issuer`, mock) |
| Wallet | Reference Wallet (headless) (`reference-wallet`, mock) |
| Verifier | Reference Verifier (OpenID4VP) (`reference-verifier`, mock) |
| Runs | 4 |
| Passed | 4 |
| Failed | 0 |
| Traceability | full |

## Matrix

| Format | Suite | Revision | Fault injected | Result | Verdict | Pass | Fail | Expected fail | Warn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 26 | 0 | 0 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 25 | 0 | 1 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 26 | 0 | 0 | 0 |
| `vc+sd-jwt` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 25 | 0 | 1 | 0 |

A run with an injected fault passes when the verifier **rejects** the credential.
`Expected fail` counts checks that failed because the fault was correctly detected.

## Fault detection

| Format | Fault | Detected by |
| --- | --- | --- |
| `vc+sd-jwt` | `break-signature` | Issuer signature verifies |
| `vc+sd-jwt` | `break-signature` | Issuer signature verifies |

## Conformance checks exercised

27 distinct assertions across this run set.

| Check | Specification clause |
| --- | --- |
| Authorization server advertises the pre-authorized code grant | OpenID4VCI §3.5, RFC 8414 |
| Credential has not been revoked | OpenID4VP §7 / credential format specification |
| Credential is within its validity window | OpenID4VP §7 / credential format specification |
| Disclosures match the issuer-signed digests | OpenID4VP §7 / credential format specification |
| Issued credential is in the requested format | OpenID4VCI §7.3 |
| Issuer advertises the requested credential format | OpenID4VCI §11.2.3 |
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
| Presentation satisfies the presentation definition | OpenID4VP §7 / credential format specification |
| Proof JWT carries exactly one key identifier | OpenID4VCI §7.2.1 |
| Response carries a credential in the shape draft-13 defines | OpenID4VCI draft 11-13 §7.3 |
| Response omits the format, as draft-13 requires | OpenID4VCI draft 12 §7.3 vs draft 13 §7.3 |
| Token response uses the Bearer token type | OpenID4VCI §6.2 / RFC 6749 §5.1 |
| Verification succeeded | An untampered credential must verify. |
| Verifier accepts the issued credential on its own | W3C VC Data Model |
| Verifier correctly rejected the tampered credential (break-signature) | A tampered credential must be rejected. |
| Verifier requested a supported response mode | OpenID4VP §6.2 |
| Wallet discloses only the requested claims | OpenID4VP §7 / SD-JWT VC §5 |

## Reproducing

```bash
npm run dev            # in one terminal
npm run matrix         # in another
```

Each run is written to `runs/<id>.json` with its full exchange log, so any row above can
be re-read in full without re-running it.
