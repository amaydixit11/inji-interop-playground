# Interoperability report

Generated 2026-09-01T15:28:27.168Z by `scripts/run-matrix.mjs`.

Every row is a real end-to-end `issue → hold → present → verify` cycle with all protocol
exchanges captured.

## Configuration

| | |
| --- | --- |
| Issuer | Inji Certify (`inji-certify`, inji) |
| Wallet | Reference Wallet (headless) (`reference-wallet`, mock) |
| Verifier | Reference Verifier (OpenID4VP) (`reference-verifier`, mock) |
| Runs | 1 |
| Passed | 0 |
| Failed | 1 |
| Traceability | full |

## Matrix

| Format | Suite | Revision | Fault injected | Result | Verdict | Pass | Fail | Expected fail | Warn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ldp_vc` | `Ed25519Signature2020` | `draft-13` | `none` | **failed** | `invalid` | 16 | 11 | 0 | 2 |

A run with an injected fault passes when the verifier **rejects** the credential.
`Expected fail` counts checks that failed because the fault was correctly detected.

## Findings

- **Authorization server metadata is served at the issuer identifier** — `fail`, 1 run(s). The issuer identifier is http://localhost:8091 but /.well-known/oauth-authorization-server there returns 404. It is served under the service context path instead (http://localhost:8091/v1/certify), which a wallet following RFC 8414 will not find.
- **Requested claims map onto the claims the issuer advertises** — `warn`, 1 run(s). Sent as requested: fullName, dateOfBirth, gender. Filled with sample values because the run did not supply them: phone. Dropped because the issuer does not advertise them and rejects unknown claims: nationality, idNumber.
- **Verifier accepts the issued credential on its own** — `fail`, 1 run(s). Rejected before any presentation was involved: "credentialSubject" property is required..
- **Every @context entry resolves to a JSON-LD context** — `fail`, 1 run(s). Could not use: https://schema.org/ (https://schema.org/ returned text/html, not a JSON-LD context). A credential whose context does not dereference cannot be canonicalised, so its proof cannot be verified by anyone.
- **Credential issuer is a resolvable identifier** — `fail`, 1 run(s). The issuer is "did:example:123456789", a placeholder from the did:example method. No verifier can resolve it to a key, so the credential cannot be verified outside the system that made it.
- **Proof verification method identifies a single key** — `fail`, 1 run(s). verificationMethod is "http://localhost:8090/v1/certify/.well-known/jwks.json", which is a JWKS endpoint rather than a single key. A verifier cannot tell which key in the set produced the proof.
- **Credential carries a credential subject** — `fail`, 1 run(s). credentialSubject is null or absent, so the credential asserts nothing about anyone. Type is VerifiableCredential, MockVerifiableCredential.
- **Holder can sign a presentation containing this credential** — `fail`, 1 run(s). Dereferencing a URL did not result in a valid JSON-LD object. Possible causes are an inaccessible URL perhaps due to a same-origin policy (ensure the server uses CORS if you are using client-side JavaScript), too many redirects, a non-JSON response, or more than one HTTP Link Header was provided for a remote context. URL: "https://schema.org/". The presentation is being sent unsigned so the verifier's handling can still be observed.
- **Presentation carries a holder proof** — `fail`, 1 run(s). No proof on the presentation: the verifier cannot tell who assembled it, only who issued the credential inside it.
- **Presentation and credential proofs verify** — `fail`, 1 run(s). Verification failed.
- **Presentation satisfies the presentation definition** — `fail`, 1 run(s). $.type: Array [VerifiableCredential, MockVerifiableCredential] does not contain "InteropTestCredential".
- **Credential has not been revoked** — `warn`, 1 run(s). The credential carries no credentialStatus, so it can never be revoked once issued.
- **Verification succeeded** — `fail`, 1 run(s). Verifier reported "invalid" but this run expected one of: valid. 

## Conformance checks exercised

29 distinct assertions across this run set.

| Check | Specification clause |
| --- | --- |
| Advertised token endpoint can redeem this issuer's pre-authorized codes | OpenID4VCI §3.5 / RFC 8414 |
| Authorization server advertises the pre-authorized code grant | OpenID4VCI §3.5, RFC 8414 |
| Authorization server metadata is served at the issuer identifier | RFC 8414 §3, OpenID4VCI §11.2.1 |
| Credential carries a credential subject | W3C VC Data Model §4.4 |
| Credential has not been revoked | OpenID4VP §7 / credential format specification |
| Credential is within its validity window | OpenID4VP §7 / credential format specification |
| Credential issuer is a resolvable identifier | W3C VC Data Model §4.5 |
| Every @context entry resolves to a JSON-LD context | W3C VC Data Model §4.1, JSON-LD 1.1 §3.1 |
| Holder can sign a presentation containing this credential | W3C VC Data Integrity / JSON-LD 1.1 |
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
| Requested claims map onto the claims the issuer advertises | OpenID4VCI §11.2.3 |
| Response carries a credential in the shape draft-13 defines | OpenID4VCI draft 11-13 §7.3 |
| Response omits the format, as draft-13 requires | OpenID4VCI draft 12 §7.3 vs draft 13 §7.3 |
| Token response uses the Bearer token type | OpenID4VCI §6.2 / RFC 6749 §5.1 |
| Verification succeeded | An untampered credential must verify. |
| Verifier accepts the issued credential on its own | W3C VC Data Model |
| Verifier requested a supported response mode | OpenID4VP §6.2 |

## Reproducing

```bash
npm run dev            # in one terminal
npm run matrix         # in another
```

Each run is written to `runs/<id>.json` with its full exchange log, so any row above can
be re-read in full without re-running it.
