# Interoperability findings

Findings from building the playground and running it against a live Inji stack —
`injistack/inji-certify-with-plugins:0.14.0` and `injistack/inji-verify-service:0.18.2`,
brought up from `docker-compose.inji.yml` with configuration vendored from the upstream repositories.

Every entry says how it was established:

- **Observed** — reproduced by running the software. The error text is quoted verbatim.
- **Source-derived** — read from the shipped configuration or source, and consistent with observed
  behaviour, but not isolated by a dedicated experiment.

Findings 1–5 are blockers: with the configuration those projects publish, **Inji Certify cannot
complete a single pre-authorized-code issuance**, and each fix uncovered the next failure. They are
listed in the order they had to be solved.

---

## 1. `credentialOfferCache` is missing from the shipped cache list

**Observed.** `mosip/inji-certify`, `docker-compose/docker-compose-injistack/config/certify-default.properties`.

```
POST /v1/certify/pre-authorized-data
{"errorCode":"unknown_error","errorMessage":"credentialOfferCache not available"}
```

`mosip.certify.cache.names` lists:

```
userinfo,vcissuance,certificatedatacache,credentialConfig,renderTemplate,jwks,preAuthCodeCache,asMetadataCache
```

The 0.14.0 service also requires `credentialOfferCache`. With `spring.cache.type=simple`, a cache
absent from `spring.cache.cache-names` does not exist, so **every** call to `/pre-authorized-data`
fails and the pre-authorized code flow cannot be started at all.

**Fix:** add `credentialOfferCache` to `mosip.certify.cache.names`.

---

## 2. Pre-authorized tokens are signed locally but validated against a remote eSignet

**Observed.** Same file, lines 63–66 and 225–227.

After fixing (1), every credential request returned `401` with an empty body, then
`{"error":"invalid_token"}` once the JWKS URL was corrected. The cause is a pair of properties that
cannot both be right:

| Property | Value | Effect |
| --- | --- | --- |
| `mosip.certify.oauth.issuer` | `${mosip.certify.authorization.url}` → `https://esignet-mock.collab.mosip.net` | the `iss` Certify **mints** |
| `mosip.certify.authn.issuer-uri` | `${mosip.certify.authorization.url}/v1/esignet` | the `iss` Certify **expects** |
| `mosip.certify.authn.jwk-set-uri` | `https://esignet-mock.collab.mosip.net/.../jwks.json` | remote key set |

Certify signs the pre-authorized access token with its **own** key, then validates it against a
**remote** eSignet's JWKS under a **different** issuer string. The two can never agree.

This is right for the authorization-code flow, where eSignet really is the authorization server. It
is unusable for the pre-authorized-code flow, which Certify implements itself.

Lines 221–224 of the same file carry exactly the required fix, commented out:

```properties
#mosip.certify.authorization.url=${mosip.certify.domain.url}
#mosip.certify.authn.issuer-uri=${mosip.certify.authorization.url}
#mosip.certify.authn.jwk-set-uri=${mosip.certify.authorization.url}${server.servlet.path}/.well-known/jwks.json
```

**Fix:** ship a profile that enables that block, or document that the pre-authorized-code flow
requires it. As published, the two features are mutually exclusive.

---

## 3. `DataProvider` plugin mode and the pre-authorized code flow cannot be used together

**Observed.** With (1) and (2) fixed, every credential request returned:

```
{"error":"ERROR_FETCHING_IDENTITY_DATA"}
```

and in the service log:

```
io.mosip.certify.util.CSVReader : No identifier found.
DataProviderExchangeException: No record found in csv
```

The `csvdp-farmer` profile sets `mosip.certify.plugin-mode=DataProvider`, which resolves the subject
by looking the token's `sub` up in a CSV. The pre-authorized code flow puts the **claims JSON** in
`sub`, not an identifier:

```json
"sub": "{\"fullName\":\"Ada Lovelace\",\"dateOfBirth\":\"1815-12-10\",...}"
```

There is no configuration that reconciles this. The CSV lookup column is `id`, and claim validation
independently rejects `id` because it is not among the advertised `credentialSubject` keys
(`fullName`, `dateOfBirth`, `gender`, `phone`) — so the identifier can never be supplied.

**Fix:** the pre-authorized code flow requires `plugin-mode=VCIssuance`. Worth stating in the
documentation, and worth rejecting the combination at startup rather than at the first credential
request.

---

## 4. Authorization server metadata is not served at the credential issuer identifier

**Observed.** With Certify configured as its own authorization server, `credential_issuer` is
`http://localhost:8091`, but:

```
GET http://localhost:8091/.well-known/oauth-authorization-server   → 404
GET http://localhost:8091/v1/certify/.well-known/oauth-authorization-server → 200
```

The shipped `certify-nginx.conf` proxies `/.well-known/openid-credential-issuer` and
`/.well-known/did.json` to the origin, but not `/.well-known/oauth-authorization-server`. RFC 8414
places that document at the issuer identifier, so a wallet doing conformant discovery does not find
it. The playground reports this as `vci.as.metadata-at-issuer`.

**Fix:** add the third location to the nginx configuration.

---

## 5. Key aliases do not survive a container restart

**Observed.** Recreating the `certify` container against an existing database:

```
io.mosip.kernel.core.keymanager.exception.NoSuchSecurityProviderException:
KER-KMA-004 --> No such alias: d83b1bcf-c3f2-417f-81e5-9b641d6be9c7
```

Key aliases recorded in the database are not found in the PKCS12 keystore afterwards, and the
application fails during startup. Every configuration change therefore needs `down -v`, discarding
all issued credentials. Noted in `docker-compose.inji.yml`.

---

## 6. Inji Verify cannot resolve a `did:web` that carries a port

**Observed.** `POST /v1/verify/v2/vc-verification` with a credential issued by
`did:web:host.docker.internal%3A8787:issuer`:

```
PublicKeyResolutionFailedException: Network request failed with error response -
Invalid URL host: "host.docker.internal%3A8787"
```

The did:web method specifies that a port is percent-encoded as `%3A` in the DID, and that a resolver
decodes it when constructing the HTTPS URL. Inji Verify passes the encoded form into the URL host,
which is invalid.

Consequence: **no did:web issuer on a non-default port can be verified.** That covers essentially
every development, test and CI deployment, which is exactly where interoperability gets exercised.

**Fix:** percent-decode the host segment during did:web resolution. This is the smallest and highest
-value fix in this list.

---

## 7. Inji Verify cannot load issuer-hosted JSON-LD contexts

**Observed.** A credential whose `@context` includes a context served by the issuer:

```
foundation.identity.jsonld.JsonLDException:
There was a problem encountered loading a remote context [code=LOADING_REMOTE_CONTEXT_FAILED]
```

Isolated with a controlled comparison: the same credential with the custom context **removed**
produces a *different* error (finding 6), so this is context loading specifically, not a knock-on
effect. The context is reachable from inside the container — `wget` retrieves it, and both
`https://www.w3.org/2018/credentials/v1` and `https://w3id.org/security/suites/ed25519-2020/v1`
resolve normally — so this is not a network restriction.

Consequence: any credential carrying a context the verifier does not already bundle fails. Since a
credential with custom claims **must** define them in its own context (see finding 9), this affects
most real credentials.

**Fix:** allow remote context resolution, with caching and an explicit trust policy, or document the
set of contexts that can be verified.

---

## 8. Inji Verify requires an X.509 chain to verify an SD-JWT VC

**Observed.** An SD-JWT VC whose issuer key is identified by `kid` (a `did:web` verification method):

```
{"errorCode":"ERR_SIGNATURE_VERIFICATION_FAILED",
 "errorMessage":"Exception during Verification: getX509CertChain(...) must not be null"}
```

The issuer key appears to be resolvable only from an `x5c` header. IETF SD-JWT VC also defines
resolution from the `iss` value via `/.well-known/jwt-vc-issuer`, and DID-based resolution is in
common use — including elsewhere in the Inji stack, where Certify advertises `did:jwk` binding.

An issuer that identifies its key by DID, as MOSIP's own documentation encourages, produces
credentials this verifier cannot check.

**Diagnosis confidence:** the error is unambiguous about the missing chain. Confirming that an
`x5c`-bearing SD-JWT verifies would require issuing with a certificate chain, which the playground
does not yet do.

---

## 9. The mock issuance plugin emits a structurally unverifiable credential

**Observed.** A credential issued by Certify 0.14.0 in `VCIssuance` mode:

```json
{
  "@context": ["https://www.w3.org/2018/credentials/v1", "https://schema.org/"],
  "type": ["VerifiableCredential", "MockVerifiableCredential"],
  "issuer": "did:example:123456789",
  "credentialSubject": null,
  "proof": {
    "type": "RsaSignature2018",
    "verificationMethod": "http://localhost:8090/v1/certify/.well-known/jwks.json"
  }
}
```

Placeholder values are expected of a plugin named "mock". Three of these are not placeholders but
structural defects, and they would be defects in any credential:

1. **`https://schema.org/` is not a JSON-LD context.** Independently confirmed: it returns
   `text/html` even when requested with `Accept: application/ld+json`. A JSON-LD processor cannot
   canonicalise the credential, so the proof cannot be verified by anyone. The context document is
   at `https://schema.org/docs/jsonldcontext.jsonld`.
2. **`verificationMethod` points at a JWKS endpoint**, which is a *set* of keys. A verifier has no
   way to know which one produced the proof. Data Integrity expects an identifier for one key.
3. **The issued credential does not match the advertised configuration.** Metadata advertises
   `FarmerCredential` signed with `EdDSA`; the credential is a `MockVerifiableCredential` signed with
   `RsaSignature2018`. A wallet that trusted the metadata would be wrong on both counts.

The playground reports these as `vc.context.dereferenceable`, `vc.proof.verification-method`,
`vc.issuer.resolvable` and `vc.subject.populated`.

---

## 10. inji-verify ships a database schema that does not match its own image

**Observed.** With `docker-compose/db-init/init.sql` from `mosip/inji-verify`, every
`direct_post` submission to the 0.18.2 service returned HTTP 500:

```
org.postgresql.util.PSQLException: ERROR: column v1_0.response_code does not exist
```

The authoritative DDL in `db_scripts/inji_verify/ddl/verify-vp_submission.sql` includes
`response_code`, `response_code_expiry_at` and `response_code_used`; the compose folder's `init.sql`
predates them. Anyone following the docker-compose README gets a verifier that accepts a
presentation and then fails to record it.

**Fix:** generate `db-init/init.sql` from `db_scripts/`, or delete it and point at the DDL.

---

## 11. verify-service returns authorization request parameters in camelCase

**Source-derived**, and visible in every run.
`dto/authorizationrequest/AuthorizationRequestResponseDto.java`.

`POST /vp-request` responds with `clientId`, `responseType`, `responseMode`, `responseUri` and
`presentationDefinition`. OpenID4VP §5 names these `client_id`, `response_type`, `response_mode`,
`response_uri` and `presentation_definition`. A wallet handed this envelope verbatim finds none of
the parameters the specification tells it to read.

Defensible as an internal API between verify-service and its own SDK — which does translate — but
the boundary between "our API" and "the protocol" is undocumented at that point. The playground
translates and raises a warning.

---

## Findings against our own code

Included because they are the ones only a real counterparty could have surfaced, and because a
report that lists only other people's defects is not a credible one.

### 12. The reference wallet sent two key identifiers in a proof

Certify rejected our proof with `invalid_proof: Error encountered during proof jwt parsing`. Our
wallet was setting both `jwk` and `kid` in the `openid4vci-proof+jwt` header. OpenID4VCI §7.2.1
requires **exactly one**. Our own issuer accepted it, so the bug was invisible until a second
implementation saw it.

### 13. Preferring a DID reference over a raw key broke SD-JWT holder binding

Once fixed, our wallet chose `kid` whenever the issuer advertised any DID method. An SD-JWT issuer
needs a raw key to place in `cnf`, so credentials went out unbound and Inji Verify correctly
rejected them with `ERR_INVALID_CNF: Missing 'cnf' in SD-JWT payload`. The wallet now prefers a bare
`jwk`, falling back to `did:jwk`.

### 14. Corrupting the last base64url character may not corrupt anything

An Ed25519 signature is 64 bytes, or 86 base64url characters, of which the last carries 4
significant bits and 2 unused. Changing it can decode to the same bytes, leaving the signature
valid. Our first fault-injection implementation did exactly this, and the `break-signature` test
passed while testing nothing. Any negative-path suite that corrupts an encoded signature by touching
its last character has the same problem.

### 15. A verifier that checks only signatures accepts the wrong credential

An early version of our reference verifier checked issuer signatures, disclosure digests and key
binding — and accepted a credential of an unrelated type, because nothing evaluated the presentation
definition it had itself sent. A valid signature proves someone authentic signed something; it does
not prove the holder satisfies what was asked. The same gap is worth checking for in any verifier.

### 16. `@digitalbazaar/ed25519-multikey` emits a 64-byte JWK `d`

`toJwk({secretKey: true})` returns the 64-byte libsodium private key (seed ‖ public key) as JWK `d`.
RFC 8037 §2 defines `d` as the 32-byte seed alone, and Node rejects the longer value with
`ERR_CRYPTO_INVALID_JWK`. Relevant to anyone bridging Data Integrity key material into a JOSE
library, which any issuer supporting both `ldp_vc` and SD-JWT from one key has to do.

---

## Filing upstream

| # | Repository | Severity |
| --- | --- | --- |
| 1, 2, 3 | `mosip/inji-certify` | blocker — pre-authorized code flow unusable as shipped |
| 4 | `mosip/inji-certify` | conformance — RFC 8414 discovery fails |
| 5 | `mosip/inji-certify` | operational — restart loses key aliases |
| 6 | `mosip/inji-verify` | blocker for any ported deployment; small fix |
| 7, 8 | `mosip/inji-verify` | interoperability limits worth documenting if intended |
| 9 | `mosip/inji-certify` | the mock emits a credential no conformant verifier can check |
| 10 | `mosip/inji-verify` | blocker — shipped schema does not match shipped image |
| 11 | `mosip/inji-verify` | documentation |
| 16 | `@digitalbazaar/ed25519-multikey` | spec deviation |

Findings 12–15 are ours and are already fixed in this repository.
