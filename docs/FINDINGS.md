# Interoperability findings

Observations from building and running the playground. Each entry says how it was established, so
the confidence attached to it is visible.

**Status of the Inji adapters:** the Inji Certify and Inji Verify adapters were written against the
current `mosip/inji-certify` and `mosip/inji-verify` sources — controllers, DTOs and constants — and
are exercised by the playground's conformance checks. They have **not yet been run against a live
Certify or verify-service instance**. Findings below marked *source-derived* are read from the code
and still need confirming against a running deployment before being filed upstream. Findings marked
*observed* were produced by actually executing a run.

---

## 1. verify-service returns authorization request parameters in camelCase

**Source-derived.** `mosip/inji-verify`, `verify-service`,
`dto/authorizationrequest/AuthorizationRequestResponseDto.java`.

`POST /vp-request` responds with:

```json
{
  "authorizationDetails": {
    "clientId": "...",
    "responseType": "vp_token",
    "responseMode": "direct_post",
    "responseUri": "...",
    "presentationDefinition": { }
  }
}
```

OpenID4VP §5 names these `client_id`, `response_type`, `response_mode`, `response_uri` and
`presentation_definition`. A wallet handed this envelope verbatim will not find the parameters the
specification tells it to read.

This is defensible as an internal API contract between verify-service and its own SDK, and the SDK
does perform the translation. It becomes a problem for anyone integrating a third-party wallet
against verify-service directly, because the boundary between "our API" and "the protocol" is not
documented at that point. The playground's adapter performs the translation and raises a `warn`
noting it.

**Suggested action:** document explicitly that `/vp-request` is a verifier-facing convenience API
rather than an OpenID4VP surface, or emit the specified parameter names.

---

## 2. Specification revision drift across the stack

**Source-derived.** Certify's release notes describe a move from OpenID4VCI draft 13 to OpenID4VCI
1.0; the problem statement this work responds to still specifies draft 13 for issuance and
draft 21–23 for presentation.

The two revisions differ in ways that break a naive client:

| Concern | Draft 13 | 1.0 |
| --- | --- | --- |
| Credential in response | `credential` | `credentials[]` array |
| Nonce for holder proof | `c_nonce` on the token response | dedicated nonce endpoint |
| Offer configuration ids | `credential_configuration_ids` | unchanged |
| Query language | Presentation Exchange | DCQL (OpenID4VP 1.0) |

The playground's reference wallet accepts either shape on each of these, and the reference issuer
emits both `credential` and `credentials[]`. That tolerance is what lets a single client drive
implementations sitting on different revisions — but it also means a stricter wallet would fail
where this one succeeds, so tolerance is recorded as a check rather than applied silently.

**Suggested action:** publish, per Inji module and release, which revision it implements. A run in
this playground records the revisions each participant declares, which is the input such a matrix
needs.

---

## 3. JSON-LD credentials must define every claim term, or canonicalisation drops it

**Observed.** Encountered while building the reference issuer.

Signing a credential whose `credentialSubject` contains a term not defined in its `@context` fails
under JSON-LD safe mode:

```
Dropping property that did not expand into an absolute IRI or keyword. { property: 'name' }
```

Without safe mode the property is *silently dropped before canonicalisation*, meaning the issuer
signs over less data than the credential appears to carry, and a verifier reading the JSON sees
claims the signature does not cover. That is a security-relevant failure mode, not a formatting one.

Any issuer emitting `ldp_vc` with custom claims needs a published context defining them. The
playground serves one at `/contexts/interop/v1`.

**Suggested action:** worth confirming whether Certify's `ldp_vc` templates define every claim term
they emit, and whether its signing path runs with safe mode enabled.

---

## 4. Corrupting the last character of a base64url signature may not corrupt the signature

**Observed.** Found by a negative test that passed when it should have failed.

An Ed25519 signature is 64 bytes, which encodes to 86 base64url characters. The final character
carries only 4 significant bits; the remaining 2 are unused padding. Changing it can therefore decode
to *exactly the same 64 bytes*, leaving the signature valid.

The playground's first tamper implementation did this, and the `break-signature` test on SD-JWT
reported the credential as valid — a test that appeared to run and verified nothing. Fault injection
now alters a character in the middle of the encoding.

This is worth flagging because the same trap applies to any negative test suite in this ecosystem
that corrupts an encoded signature by touching its last character.

---

## 5. `@digitalbazaar/ed25519-multikey` emits a 64-byte JWK `d`

**Observed.** `toJwk({ secretKey: true })` returns the 64-byte libsodium private key
(seed ‖ public key) as the JWK `d` parameter. RFC 8037 §2 defines `d` for OKP keys as the 32-byte
seed alone, and Node's `crypto` rejects the longer value with `ERR_CRYPTO_INVALID_JWK`.

Worked around by truncating to the first 32 bytes. Relevant to anyone bridging Data Integrity key
material into a JOSE library, which is required by any issuer supporting both `ldp_vc` and SD-JWT
from one key.

---

## 6. A verifier that checks only signatures accepts the wrong credential

**Observed.** An early version of the playground's own reference verifier verified issuer
signatures, disclosure digests and key binding — and accepted a credential of an entirely unrelated
type, because nothing evaluated the presentation definition it had itself sent.

A valid signature proves someone authentic signed something. It does not prove the holder satisfies
what was asked for. The two failures also mean different things to a relying party: a bad signature
means the credential is forged, an unsatisfied constraint means it is genuine but not what was
needed.

The playground now evaluates Presentation Exchange constraints as a distinct check. Worth confirming
that Inji Verify enforces the `input_descriptors` of the definition supplied at `/vp-request`, rather
than reporting only credential-level verification status.

---

## 7. Request size limits are a real constraint on cross-device flows

**Observed while building.** An OpenID4VP authorization request passed *by value* carries the full
`presentation_definition` in the URI. Beyond roughly 2.9KB it cannot be encoded as a QR code at all,
and well before that it becomes unreliable for a phone camera.

Passing the request by reference (`request_uri`) keeps the QR small. The playground emits both and
uses the by-reference form for QR display, reporting the payload size when encoding fails.

---

## Filing these upstream

Items 1, 2, 3 and 6 are candidates for issues against `mosip/inji-verify` and `mosip/inji-certify`,
once confirmed against a live deployment. Item 5 belongs with `@digitalbazaar/ed25519-multikey`.
Items 4 and 7 are notes for anyone building test tooling in this space rather than defects in a
particular implementation.
