# Interoperability report

Generated 2026-09-02T11:34:03.363Z by `scripts/run-matrix.mjs`.

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
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 34 | 0 | 0 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 32 | 0 | 2 | 0 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `none` | **passed** | `valid` | 37 | 0 | 0 | 1 |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `break-signature` | **passed** | `invalid` | 35 | 0 | 2 | 1 |

A run with an injected fault passes when the verifier **rejects** the credential.
`Expected fail` counts checks that failed because the fault was correctly detected.

## Fault detection

| Format | Fault | Detected by |
| --- | --- | --- |
| `ldp_vc` | `break-signature` | Verifier accepts the issued credential on its own; Presentation and credential proofs verify |
| `ldp_vc` | `break-signature` | Verifier accepts the issued credential on its own; Presentation and credential proofs verify |

## Findings

- **User consent was obtained** — `warn`, 2 run(s). The reference issuer grants immediately so the grant can be exercised unattended. The interop surface under test is the request parameters, the redirect and the PKCE binding; a real deployment shows a login and a consent screen here, and that part is not tested.

## Conformance checks exercised

40 distinct assertions across this run set.

| Check | Specification clause |
| --- | --- |
| Authorization code cannot be redeemed twice | RFC 6749 §4.1.2 |
| Authorization endpoint redirects with an authorization code | OpenID4VCI §3.4, RFC 6749 §4.1.2 |
| Authorization response echoes the state parameter | RFC 6749 §4.1.2, §10.12 |
| Authorization server advertises the pre-authorized code grant | OpenID4VCI §3.5, RFC 8414 |
| Credential carries a credential subject | W3C VC Data Model §4.4 |
| Credential has not been revoked | OpenID4VP §7 / credential format specification |
| Credential is within its validity window | OpenID4VP §7 / credential format specification |
| Credential issuer is a resolvable identifier | W3C VC Data Model §4.5 |
| Credential offer URI fits in a scannable QR code | ISO/IEC 18004 (QR capacity) / OpenID4VP §5.10 |
| Credential uses the W3C data model it was issued under (1.1) | W3C VC Data Model 1.1 §4.6 / 2.0 §4.8 |
| Every @context entry resolves to a JSON-LD context | W3C VC Data Model §4.1, JSON-LD 1.1 §3.1 |
| Holder echoed the verifier nonce | OpenID4VP §7 / credential format specification |
| Issued credential is in the requested format | OpenID4VCI §7.3 |
| Issuer advertises the requested credential format | OpenID4VCI §11.2.3 |
| Issuer publishes resolvable key material at its identifier | did:web method / RFC 7517 |
| Issuer supplied a nonce for the holder proof | OpenID4VCI §7.2 (c_nonce) / §8 (Nonce Endpoint) |
| Metadata advertises a credential endpoint | OpenID4VCI §11.2.3 |
| Metadata uses the draft-13+ credential_configurations_supported shape | OpenID4VCI §11.2.3 |
| Offer advertises a grant the wallet can complete | OpenID4VCI §4.1.1 |
| Offer carries a pre-authorized code | OpenID4VCI §4.1.1 |
| Offer carries the authorization code grant | OpenID4VCI §4.1.1 |
| Offer names the credential issuer | OpenID4VCI §4.1.1 |
| Offer uses credential_configuration_ids | OpenID4VCI §4.1.1 |
| OpenID4VP request URI (QR payload) fits in a scannable QR code | ISO/IEC 18004 (QR capacity) / OpenID4VP §5.10 |
| Presentation and credential proofs verify | OpenID4VP §7 / credential format specification |
| Presentation carries a holder proof | OpenID4VP §7 / credential format specification |
| Presentation satisfies the presentation definition | OpenID4VP §7 / credential format specification |
| Proof JWT carries exactly one key identifier | OpenID4VCI §7.2.1 |
| Proof verification method identifies a single key | W3C VC Data Integrity §2.2 |
| Response carries a credential in the shape draft-13 defines | OpenID4VCI draft 11-13 §7.3 |
| Response carries a presentation submission | OpenID4VP 1.0 §8.1 / OpenID4VP draft 21 §6.1 |
| Response omits the format, as draft-13 requires | OpenID4VCI draft 12 §7.3 vs draft 13 §7.3 |
| This run can be attributed to specific participant builds | Playground provenance |
| Token response uses the Bearer token type | OpenID4VCI §6.2 / RFC 6749 §5.1 |
| User consent was obtained | OpenID4VCI §3.4 |
| Verification succeeded | An untampered credential must verify. |
| Verifier accepts the issued credential on its own | W3C VC Data Model |
| Verifier correctly rejected the tampered credential (break-signature) | A tampered credential must be rejected. |
| Verifier requested a supported response mode | OpenID4VP §6.2 |
| assertionMethod entries reference a verification method | DID Core §5.3.2 |

## Reproducing

```bash
npm run dev            # in one terminal
npm run matrix         # in another
```

Each run is written to `runs/<id>.json` with its full exchange log, so any row above can
be re-read in full without re-running it.
