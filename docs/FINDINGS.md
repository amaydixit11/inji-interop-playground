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

## Ranked summary

Ordered by what it costs an integrator to hit the defect, not by the order we found it. **Blast
radius** is who is affected; **fix cost** is our estimate of the change needed upstream, and a
one-line estimate is a claim we are prepared to be wrong about.

| # | Finding | Component | Severity | Blast radius | Fix cost |
| --- | --- | --- | --- | --- | --- |
| [1](#1-credentialoffercache-is-missing-from-the-shipped-cache-list) | `credentialOfferCache` absent from the shipped cache list | Certify 0.14.0 | **Blocker** | Every pre-authorized-code issuance, for everyone using the published compose file | One property |
| [2](#2-pre-authorized-tokens-are-signed-locally-but-validated-against-a-remote-esignet) | Pre-authorized tokens signed locally, validated against remote eSignet | Certify 0.14.0 | **Blocker** | Same — the token is minted and then rejected by the issuer that minted it | Three properties |
| [3](#3-dataprovider-plugin-mode-and-the-pre-authorized-code-flow-cannot-be-used-together) | `DataProvider` plugin mode is incompatible with the pre-authorized code flow | Certify 0.14.0 | **Blocker** | Anyone following the DataProvider quickstart; the two documented paths exclude each other | Docs, or plugin work |
| [5](#5-key-aliases-do-not-survive-a-container-restart) | Key aliases do not survive a container restart | Certify 0.14.0 | **Blocker** | Any deployment that restarts — i.e. all of them; needs `down -v` to recover | Keymanager init |
| [10](#10-inji-verify-ships-a-database-schema-that-does-not-match-its-own-image) | Ships a DB schema that does not match its own image (`response_code` missing) | inji-verify 0.18.2 | **Blocker** | Every fresh deploy from `docker-compose/db-init`; fails at first presentation | Ship the real DDL |
| [8](#8-inji-verify-requires-an-x509-chain-to-verify-an-sd-jwt-vc--confirmed) | SD-JWT VC issuer keys resolved only from `x5c` | inji-verify 0.18.2 | **High** | Every SD-JWT issuer that identifies itself by DID — including Certify's own `did:web` | Resolver branch |
| [8b](#8b-inji-verify-does-not-check-revocation-for-sd-jwt-vc) | No revocation check for SD-JWT VC; an empty status list is indistinguishable from a clean one | inji-verify 0.18.2 | **High** | A revoked credential verifies as valid — silently, with no warning to the relying party | Status list client |
| [31](#31-inji-verify-accepts-an-sd-jwt-presentation-with-no-holder-proof) | SD-JWT accepted with no holder proof, although the credential is key-bound | inji-verify 0.18.2 | **High** | Every SD-JWT relying party: a copied credential can be presented by anyone | Reject missing KB-JWT when `cnf` present |
| [32](#32-inji-verify-does-not-check-the-nonce-in-the-sd-jwt-key-binding-jwt) | KB-JWT nonce not checked, so presentations can be replayed | inji-verify 0.18.2 | **High** | Every SD-JWT relying party | Compare nonce and aud |
| [33](#33-inji-verify-does-not-apply-the-presentation-definitions-constraints) | Presentation definition constraints not applied: wrong credential type accepted | inji-verify 0.18.2 | **Medium** | Relying parties that trust `allChecksSuccessful` | Evaluate constraints, or say they were skipped |
| [34](#34-a-used-up-online-sharing-qr-ends-on-a-raw-http-401) | A used-up online-sharing QR ends on a raw HTTP 401 via `/v1/mimoto/null` | Inji Web / Mimoto (Collab) | **Low** | Relying parties re-scanning a one-use credential: no result, no reason | Redirect with the error |
| [4](#4-none-of-the-well-known-documents-except-one-are-served-at-the-credential-issuer-identifier) | `.well-known` documents not served at the credential issuer identifier | Certify 0.14.0 | **High** | Any spec-conformant wallet doing discovery; reproduced on MOSIP's own Collab ([16](#16-confirmed-on-mosips-own-public-sandbox)) | Routing |
| [6](#6-inji-verify-cannot-resolve-a-didweb-that-carries-a-port) | `did:web` with a port is not percent-decoded | inji-verify 0.18.2 | **High** | Every non-443 issuer — so every local, CI and staging deployment | One line |
| [7](#7-inji-verify-cannot-load-issuer-hosted-json-ld-contexts) | Cannot load issuer-hosted JSON-LD contexts | inji-verify 0.18.2 | **High** | Any credential type not already in the bundled context set | Context loader |
| [13](#13-inji-web-cannot-be-paired-with-an-arbitrary-issuer) | Inji Web cannot be pointed at an arbitrary issuer | Inji Web / Mimoto | **High** | Anyone testing their own issuer against the reference wallet — the core interop use case | Config surface |
| [19](#19-the-current-sdk-and-the-released-verify-service-are-on-opposite-sides-of-a-version-boundary) | Current SDK calls `/v2/vp-session-request`, which 0.18.2 404s | SDK / verify-service | **High** | Every integrator following current docs; the predecessor SDK is deprecated | Release coordination |
| [18](#18-mosips-own-verification-sdk-cannot-reach-verify-service-from-another-origin) | verify-service sends no CORS headers | inji-verify 0.18.2 | **Medium** | Every browser-hosted verifier, including MOSIP's own SDK | Filter config |
| [9](#9-the-mock-issuance-plugin-emits-a-structurally-unverifiable-credential) | Mock issuance plugin emits a structurally unverifiable credential | Certify 0.14.0 | **Medium** | Evaluators, who reasonably read the mock plugin's output as representative | Plugin fix |
| [15](#15-an-openid4vp-request-passed-by-value-is-five-times-too-big-for-a-qr-code) | OpenID4VP request by value is 1,169 bytes vs 217 by reference | Inji Verify | **Medium** | Cross-device flows on low-end cameras; degrades rather than fails | Default to `request_uri` |
| [17](#17-collabs-did-document-authorises-the-did-itself-not-a-key) | Collab's DID document authorises the DID, not a key | Collab deployment | **Medium** | Verifiers that check `assertionMethod` properly will reject Collab-issued VCs | DID doc |
| [4b](#4b-the-did-document-endpoint-returns-http-200-with-an-error-body) | DID document endpoint returns HTTP 200 with an error body | Certify 0.14.0 | **Medium** | Clients that trust the status code — the failure is invisible until parse time | Status code |
| [11](#11-verify-service-returns-camelcase-in-its-api-envelope--but-the-request-object-is-correct) | camelCase in the API envelope around a conformant request object | inji-verify 0.18.2 | **Low** | Integration friction only; the protocol-level object is correct | Docs |
| [14](#14-no-inji-service-will-tell-you-which-build-it-is) | No Inji service reports its own build | all | **Low** | Bug reports cannot state a version — which is why this list pins image tags | Actuator info |
| [29](#29-a-bad-credential-configuration-is-rejected-with-http-200) | A bad credential configuration is rejected with HTTP 200 and a raw JPA error | Certify 0.14.0 | **Medium** | Anyone registering credential types over the API; a client keying on status reads a rejection as success | Validation + status |
| [26](#26-oauthiar-answers-a-json-body-with-403-forbidden) | `/oauth/iar` answers a JSON body with 403 instead of 415 — as its own OpenAPI document invites | Certify 0.14.0 | **Medium** | Every generated client; 403 sends the developer to debug auth instead of the content type | Status + spec |
| [28](#28-iar-post-is-not-a-registered-openid4vp-response-mode) | `iar-post` is not a registered OpenID4VP response mode | Certify 0.14.0 | **Medium** | A spec-conformant wallet cannot answer Certify's interaction demand | Use `direct_post` |
| [27](#27-an-iar-rejection-returns-the-java-controller-signature) | An IAR rejection returns the Java controller signature instead of the bad parameter | Certify 0.14.0 | **Low** | Developer time only, but it never names the missing parameter | Map the violation |

[Finding 30](#30-registering-a-credential-type-over-the-api-works-end-to-end) is a positive result,
and the one most relevant to this project's purpose: a credential type registered over Certify's API
*is* immediately issuable.

Findings [20–25](#findings-against-our-own-code) are against our own code, kept because they are the
ones only a real counterparty could have surfaced.

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

## 4. None of the `.well-known` documents except one are served at the credential issuer identifier

**Observed.** With Certify configured as its own authorization server, `credential_issuer` is
`http://localhost:8091`, and:

| Document | At the issuer identifier | Under the service context path |
| --- | --- | --- |
| `openid-credential-issuer` | 200 | 200 |
| `oauth-authorization-server` | **404** | 200 |
| `jwks.json` | **404** | 200 |
| `did.json` | 200, but see finding 4b | — |

`certify-nginx.conf` proxies `/.well-known/openid-credential-issuer` and `/.well-known/did.json` to
the origin, and nothing else. RFC 8414 and RFC 7517 both place their documents at the issuer
identifier, so a wallet or verifier doing conformant discovery finds neither the token endpoint nor
the issuer's keys.

The keys *exist* — one is published at
`http://localhost:8091/v1/certify/.well-known/jwks.json` — which makes this a routing gap rather
than a missing capability, and correspondingly cheap to fix.

**Impact.** A verifier resolving the issuer's key from the credential issuer identifier gets nothing,
so it cannot verify a credential from an issuer it has not been separately configured with.

**Suggested fix:** add `oauth-authorization-server` and `jwks.json` to the nginx locations alongside
the two already there.

The playground reports these as `vci.as.metadata-at-issuer`, `vci.issuer.key-material` and
`vci.issuer.key-material-location`.

---

## 4b. The DID document endpoint returns HTTP 200 with an error body

**Observed.**

```
GET http://localhost:8091/.well-known/did.json   → HTTP 200

{"responseTime":"...","response":null,
 "errors":[{"errorCode":"unsupported_in_current_plugin_mode",
            "errorMessage":"unsupported_in_current_plugin_mode"}]}
```

Two problems, one inside the other.

**The status code is wrong.** An error returned as `200` is worse than an honest `4xx`: a client that
checks the status — which is most clients, and all caching layers — treats the error envelope as the
document. A DID resolver would hand that object to its parser and fail somewhere further away from
the cause.

**And the DID document is unavailable at all in `VCIssuance` plugin mode.** Combined with finding 9,
where credentials in that mode are issued by `did:example:123456789`, the result is that the issuer
publishes no resolvable identity and its credentials name an unresolvable one. Nothing in that chain
can be verified by a third party.

**Suggested fix:** return `501` or `404` when the plugin mode does not support a DID document, and
consider whether `VCIssuance` mode should be able to publish one — the credentials it issues need an
issuer somebody can resolve.

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

## 8. Inji Verify requires an X.509 chain to verify an SD-JWT VC — confirmed

**Observed, and settled by a controlled comparison.** This was previously a diagnosis; it is now a
result.

The same credential, from the same issuer, differing only in how it names its signing key:

| Issuer key reference | `POST /v2/vc-verification` | Full presentation |
| --- | --- | --- |
| `kid` (a `did:web` verification method) | `ERR_SIGNATURE_VERIFICATION_FAILED` — `getX509CertChain(...) must not be null` | rejected |
| `x5c` (certificate chain embedded) | **valid** | **verifies end to end** |

So the requirement is real and it is specifically the chain: nothing else about the credential
changed. Inji Verify cannot resolve an SD-JWT issuer key from a DID.

IETF SD-JWT VC §3.5 also defines resolution from the `iss` value via `/.well-known/jwt-vc-issuer`,
and DID-based resolution is in common use — including elsewhere in this stack, where Certify
advertises `did:jwk` binding. An issuer that identifies its key by DID, as MOSIP's own documentation
encourages, produces SD-JWT credentials this verifier cannot check.

**The corollary is worth stating as loudly as the defect: with `x5c`, an SD-JWT VC verifies through
Inji Verify completely** — signature, holder proof and validity period all reported valid. This is
the one fully green path against a real Inji service, and it was invisible until the comparison was
run.

**Suggested fix:** support `iss`-based JWKS resolution per SD-JWT VC §3.5, or document that `x5c` is
required. The playground exposes this as a run dimension (`issuerKeyReference`), so the difference can
be reproduced in two runs.

---

## 8b. Inji Verify does not check revocation for SD-JWT VC

**Observed.** On every SD-JWT run, `statusCheck` comes back as an empty array while the service log
says:

```
i.m.v.vcverifier.CredentialsVerifier : Error occurred while checking credential status of
format VC_SD_JWT: Credential status checking not supported for this credential format.
Returning empty status list
```

An empty status list is indistinguishable, in the response, from a list that was checked and found
clean. A caller reading `allChecksSuccessful` gets `true` for a credential whose revocation was never
examined — so **a revoked SD-JWT VC is accepted**.

The credentials the playground issues carry an IETF Token Status List reference
(`status.status_list`), which is the mechanism SD-JWT VC specifies, so there is something there to
check.

**Suggested fix:** implement Token Status List checking for SD-JWT, or distinguish "not checked" from
"checked and clean" in the response so a caller can tell the difference. The second is the smaller
change and prevents the silent-acceptance case on its own.

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

## 11. verify-service returns camelCase in its API envelope — but the request object is correct

**Observed**, and this one is narrower than it first appeared.

`POST /vp-request` responds with `clientId`, `responseType`, `responseMode`, `responseUri` and
`presentationDefinition`. OpenID4VP §5 names these `client_id`, `response_type`, `response_mode`,
`response_uri` and `presentation_definition`.

An earlier draft of this document treated that as an interoperability defect. Fetching the request
object the way a wallet actually would shows otherwise:

```
GET /v1/verify/vp-request/{requestId}   Accept: application/oauth-authz-req+jwt
```

returns **a signed JWT** whose payload carries `client_id`, `response_uri`, `nonce` and
`response_type` under their specified names. So a wallet handed a `request_uri` — the normal
cross-device path — gets a conformant, signed request object and works.

The camelCase envelope is therefore a verifier-facing convenience API, not a protocol surface, and
the only people affected are those wiring a wallet against `/vp-request` directly instead of
following the `request_uri`. Worth a line in the documentation; not a defect.

Recorded here rather than deleted because being wrong about a finding is itself worth showing: the
correction came from testing the path a wallet takes rather than the one that was easiest to call.

---

## 12. Direct credential verification is what made findings 7 and 8 tractable

**Observed.** The playground submits each issued credential to `POST /v2/vc-verification` before any
presentation exists. Both Inji Verify failures reproduce there:

| Format | Issuer key | Result from `/v2/vc-verification` |
| --- | --- | --- |
| `ldp_vc` | `did:web` | `LOADING_REMOTE_CONTEXT_FAILED` (finding 7) |
| `vc+sd-jwt` | `kid` | `getX509CertChain(...) must not be null` (finding 8) |
| `vc+sd-jwt` | `x5c` | **valid** |

Two things follow. First, both are properties of the **credential** as this verifier reads it, not of
the OpenID4VP exchange — which, as finding 11 shows, is itself conformant. Anyone investigating
should look at credential handling in the vcverifier library, not at the presentation flow.

Second, it is what caught our own bug (finding 18). The third row should have been green end to end
and was being reported as `UNKNOWN`; having the same credential answered by two different endpoints
is what exposed the adapter misreading one of them. An interoperability tool has no external signal
when it misreads a counterparty, so a second, independent path to the same answer is worth its cost.

## 13. Inji Web cannot be paired with an arbitrary issuer

**Observed**, against Mimoto 0.21.0 and Inji Web 0.16.0 running from `docker-compose.inji.yml`. This
is the finding with the most direct bearing on what a "pick any issuer, any wallet, any verifier"
playground can actually do.

Mimoto's credential download is `POST /wallets/{walletId}/credentials`, and its request body is:

```java
public class VerifiableCredentialRequestDTO {
    @NotBlank String issuer;                     // an issuer_id from mimoto-issuers-config.json
    @NotBlank String credentialConfigurationId;
    @NotBlank String code;                       // an OAuth authorization code
    @NotBlank String grantType;
    @NotBlank String redirectUri;
    @NotBlank String codeVerifier;               // PKCE
}
```

Three consequences follow, and none has a configuration workaround:

1. **There is no credential offer.** Searching the whole of `mimoto/src/main/java` for
   `credential_offer`, `credentialOffer` or `openid-credential-offer` returns nothing. The wallet
   cannot be handed an offer at all — it is told which *pre-registered issuer* to fetch from.
2. **The issuer must be registered in advance.** `issuer` is an id looked up in
   `mimoto-issuers-config.json`, which also carries that issuer's `client_id`, `redirect_uri` and
   `authorization_audience`. An issuer not in that file cannot be used.
3. **Only the authorization code grant is supported.** `code` and `codeVerifier` are mandatory, so an
   interactive user login is unavoidable and the pre-authorized code grant — the one that makes
   unattended issuance possible — is not available.

Confirmed against the running service. `GET /v1/mimoto/issuers` returns the registry and nothing
else is on offer:

```
issuer_id=Farmer   protocol=OpenId4VCI  client_id=wallet-demo
issuer_id=MockMdl  protocol=OpenId4VCI  client_id=wallet-demo
```

Two issuers, both with a pre-registered `client_id`. Every wallet route
(`POST /v1/mimoto/wallets` and below) returns `401` without a session, and no path accepting a
credential offer exists to try.

So Inji Web is a wallet *for a curated set of issuers*, not a general OpenID4VCI wallet. It cannot
be the holder in a run against the reference issuer, an external issuer, or any Certify deployment
not already listed in its configuration.

This is a reasonable product decision for a government wallet, where the set of trusted issuers is
deliberately closed. It is worth stating plainly because the surrounding documentation describes
Inji Web as an OpenID4VCI wallet without qualification, and anyone planning cross-ecosystem testing
will otherwise plan around a capability that is not there.

The playground therefore declares the constraint on the participant itself and surfaces it before a
run rather than failing partway through. **No Mimoto adapter was built**: one could only ever
exercise the pre-registered path, behind an interactive login, which is the case the playground is
least useful for.

A second obstacle sits in front of even the pre-registered path: `certs/oidckeystore.p12` is, in the
upstream README's words, "to be obtained during onboarding of mimoto to esignet". Standing Mimoto up
locally therefore requires onboarding it as an OIDC client to an eSignet deployment. The playground
generates a self-signed keystore so the service boots and its API can be inspected — which is how
the registry above was read — but that key is registered with no authorization server, so a
credential download would stop at the token exchange regardless.

Scope: this is a finding about Mimoto and Inji Web. The Inji Wallet mobile app was not inspected and
may well consume credential offers directly; nothing here should be read as a claim about it.

---

## 14. No Inji service will tell you which build it is

**Observed.** The problem statement asks for a run history filterable by *module version*, which
turns out to be the hardest of the three filters to implement, because the versions are not
available.

| Service | Version endpoint | Result |
| --- | --- | --- |
| Mimoto | `/v1/mimoto/actuator/info` | build name, artifact and **git commit** |
| Inji Certify | `/v1/certify/actuator/info` | HTTP **200** carrying `{"errors":[{"errorCode":"unknown_error"}]}` |
| Inji Verify | `/actuator/info`, `/v1/verify/actuator/info` | **404** |

Mimoto — the one module that cannot participate in a run (finding 13) — is the only one that reports
its build. Certify's actuator is reachable but returns the same 200-with-error-envelope pattern as
finding 4b. verify-service exposes no actuator at all.

**Impact.** A regression cannot be attributed to a release. "This passed last month and fails now" is
unanswerable without someone remembering which container tags were running, which is exactly the
information a run history exists to preserve.

The playground records a version per participant with its **source** — discovered, declared by the
operator, or unknown — so a labelled run is never mistaken for a measured one, and the history and
dashboard filter on it. An operator-supplied label is treated as a first-class alternative rather
than a fallback, because otherwise the regression-tracking use case simply does not work.

**Suggested fix:** enable the Spring Boot actuator `info` endpoint with build information on Certify
and verify-service, as Mimoto already does. It is a configuration change, not a feature.

---

## 15. An OpenID4VP request passed by value is five times too big for a QR code

**Observed.** The problem statement names "QR size limits" as a gap to surface. Measured on a live
verify-service request:

| Form | Size | Verdict |
| --- | --- | --- |
| By value (`presentation_definition` inline) | **1,169 bytes** | 40% of a single QR code's absolute capacity — encodable, and at a module density most phone cameras will not resolve reliably |
| By reference (`request_uri`) | **217 bytes** | scans reliably at modest sizes |

The thresholds here are about *scanning*, not encoding. A QR code holds 2,953 bytes at the lowest
error correction, but the module size at that density is beyond what a phone camera resolves from a
laptop screen at arm's length — so a specification-legal request can be unusable in the cross-device
flow it exists for.

verify-service **does** publish a signed request object at `GET /vp-request/{requestId}`
(finding 11), so the small form is available; a caller only has to use it. The playground now
measures every QR payload as it is recorded, displays the by-reference form, and keeps the by-value
form alongside for comparison.

For completeness it also reports what `@mosip/pixelpass` compression would save — 8–28% on these
payloads. Reported rather than applied: compressing changes what a scanning wallet has to
understand, so it belongs in the report as a remedy, not silently in the payload.

**Not a defect in Inji Verify.** It is a trap for anyone integrating against it, and the reason the
by-value form exists at all is that it is the easier one to build.

---

## 16. Confirmed on MOSIP's own public sandbox

**Observed.** Everything above was found against a local Docker deployment, which leaves open the
question of whether it was self-inflicted. It was not. Auditing the metadata of
`https://injicertify-mock.collab.mosip.net` — MOSIP's own hosted Collab Certify, which nobody here
configured — reproduces finding 4 exactly:

| Document | At the issuer identifier | Under `/v1/certify` |
| --- | --- | --- |
| `openid-credential-issuer` | 200 | 200 |
| `oauth-authorization-server` | **404** | 200 |
| `jwks.json` | **404** | 200 |
| `did.json` | 200, well-formed | — |

So the routing gap is how Certify is deployed, not how it was deployed *here*.

Two differences from the local instance, both worth recording:

- **Collab publishes a proper DID document**, with an `Ed25519VerificationKey2020` carrying a key.
  The local instance publishes none, because `VCIssuance` plugin mode does not support it
  (finding 4b). So key material *is* resolvable on Collab, and finding 4's impact there is limited to
  the token endpoint.
- **Collab advertises `MockVerifiableCredential_VCDM2.0`** — a W3C VC Data Model 2.0 configuration —
  alongside the 1.1 one, and exposes a `nonce_endpoint`. Both are OpenID4VCI 1.0 era features and
  ahead of the local 0.14.0 image.

Issuance could not be exercised: Collab delegates authorization to eSignet
(`grant_types_supported: ["authorization_code"]`) and its `/pre-authorized-data` returns an error
envelope, so nothing can be issued without a person logging in. The playground therefore supports
stopping a run after discovery, so a metadata audit is reported as a completed partial run rather
than as a failure to issue.

---

## 17. Collab's DID document authorises the DID itself, not a key

**Observed.** `https://injicertify-mock.collab.mosip.net/.well-known/did.json`:

```json
{
  "id": "did:web:injicertify-mock.collab.mosip.net",
  "verificationMethod": [
    { "id": "did:web:injicertify-mock.collab.mosip.net#sLECdoF_na9Cdz3LCIXi8n_qdzmaFCy0wr5vIJ7CIJQ",
      "type": "Ed25519VerificationKey2020", "publicKeyMultibase": "..." }
  ],
  "assertionMethod": ["did:web:injicertify-mock.collab.mosip.net"]
}
```

`assertionMethod` names the **DID**, not the verification method id. DID Core §5.3.2 requires each
entry to be an embedded verification method or a reference to one — which means an id carrying the
fragment, here `#sLECdoF_…`.

**Why it matters.** A Data Integrity verifier establishes that the key which made a proof is
authorised for the `assertionMethod` purpose. Dereferencing this entry returns the DID document
rather than a key, so there is nothing to compare the proof's `verificationMethod` against. Whether
that fails open or closed depends on the implementation — which is the worst kind of ambiguity to
leave inside a trust decision.

The playground checks this (`vci.issuer.assertion-method`) and it passes against a correctly formed
document, so the check is not simply strict.

**Suggested fix:** `"assertionMethod": ["did:web:injicertify-mock.collab.mosip.net#sLECdoF_…"]`.

---

## 18. MOSIP's own verification SDK cannot reach verify-service from another origin

**Observed.** `@injistack/react-inji-verify-sdk` is a React component library, explicitly intended to
be embedded in a relying party's own page. Mounted in this playground and pointed at verify-service:

```
OPTIONS http://localhost:8010/v1/verify/v2/vp-session-request → 403
TypeError: Failed to fetch
```

verify-service sends no `Access-Control-*` headers at all and answers the preflight with `403`. A
browser therefore cannot call it from any page except one served from its own origin — which is the
one situation where you would not need a component library.

Every integrator embedding this SDK has to put a same-origin proxy in front of verify-service. The
playground now ships one (`/proxy/verify`, fixed to the configured target rather than taking a URL,
because an open forwarder reachable from a browser is a liability). It works, and it should not be
necessary.

**Suggested fix:** configurable CORS on verify-service, or documentation stating plainly that the SDK
requires a proxy and why.

---

## 19. The current SDK and the released verify-service are on opposite sides of a version boundary

**Observed**, and the more consequential half of finding 18.

`@mosip/react-inji-verify-sdk` — the package the problem statement names — is **deprecated**, with a
community advisory directing users to `@injistack/react-inji-verify-sdk`. Following that advice
breaks against the current release:

| SDK | Endpoint it calls | On verify-service 0.18.2 |
| --- | --- | --- |
| `@mosip/…@0.16.0` (deprecated) | `/vp-request`, `/vc-verification` | both exist |
| `@injistack/…@1.0.0-dev.2` (current) | `/v2/vp-session-request` | **404** |

With CORS worked around by the proxy, the SDK's request reaches verify-service and comes back
`404 Not Found`. Confirmed independently: `/v2/vp-session-request`, `/v2/vp-request` and
`/v2/vp-session-results` are all absent from 0.18.2, while the v1 paths the deprecated SDK uses are
present.

In fairness, `1.0.0-dev.2` is a prerelease and is presumably built against an unreleased
verify-service. The problem is the combination a reader is steered into: the named package is
deprecated, the replacement is a prerelease requiring an API the current release does not expose, and
nothing states which pairs of versions actually work together — which is finding 14 again, from the
other direction.

**Suggested fix:** a compatibility statement in the SDK README naming the verify-service versions
each release targets. The playground keeps the current SDK and shows the 404, so the boundary is
visible rather than mysterious.

---

## 26. `/oauth/iar` answers a JSON body with 403 Forbidden

**Observed.** `injistack/inji-certify-with-plugins:0.14.0`, `POST /v1/certify/oauth/iar`.

The issuance authorization endpoint reads `application/x-www-form-urlencoded` only. Send the same
parameters as JSON and it answers:

```
403 {"timestamp":...,"status":403,"error":"Forbidden","path":"/v1/certify/oauth/iar"}
```

403 sends a developer to look at authentication, credentials and scopes. The actual problem is the
media type, which is what `415 Unsupported Media Type` exists to say. Sending no `Content-Type` at
all produces the same 403.

What makes this more than pedantry is that **Certify's own OpenAPI document invites the mistake.**
`GET /v1/certify/v3/api-docs` declares the parameter as:

```json
{ "name": "iarRequest", "in": "query", "required": true,
  "schema": { "$ref": "#/components/schemas/IarRequest" } }
```

An object schema `in: query` — so a generated client sends either JSON or a query string, and both
get 403. The endpoint in fact binds from form fields, and with the correct content type it accepts
the parameters from the query string *or* the body.

**Fix:** answer 415 for an unsupported media type, and describe the parameter as a
`requestBody` with `application/x-www-form-urlencoded` content.

---

## 27. An IAR rejection returns the Java controller signature

**Observed.** Same endpoint, omitting `code_challenge`:

```
400 {"error":"invalid_request","error_description":"Validation failed for argument [0] in public
org.springframework.http.ResponseEntity<io.mosip.certify.core.dto.IarResponse>
io.mosip.certify.controller.OAuthController.handleIarRequest(io.mosip.certify.core.dto.IarRequest)
throws io.mosip.certify.core.exception.CertifyException: [Error in object 'iarRequest': codes
[ValidIar.iarRequest,ValidIar]; arg…"
```

An OAuth `error_description` is read by the client developer. This one names the internal DTO, the
controller class, the method signature, the exception type and the bean-validation codes — and never
says that `code_challenge` is the missing parameter.

The same endpoint gets this right elsewhere: `code_challenge_method=plain` is refused with
`code_challenge_method must be S256`, which is exactly what a rejection should read like. So one
path is hand-written and the other is a raw `MethodArgumentNotValidException` reaching the wire.

**Fix:** map the constraint violation to the parameter name.

---

## 28. `iar-post` is not a registered OpenID4VP response mode

**Observed.** The `require_interaction` response embeds an OpenID4VP request:

```json
{ "status": "require_interaction", "type": "openid4vp_presentation",
  "auth_session": "iar_session_…",
  "openid4vp_request": { "response_uri": "…/oauth/iar", "response_type": "vp_token",
    "nonce": "…", "client_id": "certify-verifier-client", "response_mode": "iar-post",
    "presentation_definition": { "id": "MOSIPVerifiableCredential", … } } }
```

`response_mode` is `iar-post`. OpenID4VP registers `direct_post` and `direct_post.jwt`; `iar-post`
is neither. A wallet implementing the specification will not recognise it, and the sensible thing
for that wallet to do — refuse an unknown response mode rather than guess — means it cannot complete
the exchange. Reported as a warning rather than a failure because the flow is a draft-era extension
and the intent is legible.

Also worth recording: the presentation definition demands `RsaSignature2018`, which is why the
playground implements that suite by hand (see [`suites.ts`](../apps/bff/src/core/suites.ts)) —
`@digitalbazaar` ships no implementation of it.

---

## 29. A bad credential configuration is rejected with HTTP 200

**Observed.** `POST /v1/certify/credential-configurations`, omitting `credentialConfigKeyId`:

```
200 {"responseTime":"…","response":null,
     "errors":[{"errorCode":"unknown_error","errorMessage":"Could not commit JPA transaction"}]}
```

Three defects in one response:

- **HTTP 200 for a rejection.** A successful create answers `201`. So a client that branches on the
  status code reads this as success and then fails on `response: null`. This is finding
  [4b](#4b-the-did-document-endpoint-returns-http-200-with-an-error-body) again, in a different
  controller.
- **A persistence error on the wire.** `Could not commit JPA transaction` says the request reached
  the database with no validation in front of it, and names no field. Validation does exist on this
  endpoint — omitting the context or credential type yields the perfectly good
  `Fields context, credentialType, and signatureCryptoSuite are mandatory for the ldp_vc format` —
  so this path is simply not covered by it.
- **`credentialConfigKeyId` is not documented as required.** The published
  `CredentialConfigurationDTO` lists `required: [credentialFormat, metaDataDisplay, scope]`. Omitting
  a field the schema says is optional should not produce a database error.

One more inconsistency, recorded but not asserted: `DELETE` answers with a bare string,
`Deleted configuration with id: PlaygroundProbeCredential`, while every other operation on the same
resource returns the JSON envelope.

**Fix:** validate `credentialConfigKeyId` alongside the other mandatory fields, and return 400.

---

## 30. Registering a credential type over the API works, end to end

**Observed.** The positive finding of this group, and the one most relevant to the playground's
purpose. A credential configuration round-trips cleanly, and — the part that actually matters —
a type registered through the API is **advertised to wallets immediately**:

| Step | Result |
| --- | --- |
| `POST /credential-configurations` | `201 {"id":"PlaygroundProbeCredential","status":"active"}` |
| Appears in `credential_configurations_supported` | **yes**, with no restart |
| `GET /credential-configurations/{id}` | 200, matching what was written |
| `PUT /credential-configurations/{id}` | 200, and the change reads back |
| `DELETE /credential-configurations/{id}` | 200, and a subsequent read is a genuine 404 |

So "issue any credential type" is achievable against Certify without editing properties files and
restarting the container — which is what findings 1–5 otherwise force you to do. It is worth stating
plainly, because a report listing only the rejection-path defects would leave the impression that
this API does not work. It does.

The playground exercises this as the `certify-admin` scenario. The probe writes, so it is **opt-in**
(`auditAdminApi: on`) and registers its configuration under a reserved key it deletes again — a
conformance test that leaves a half-registered credential type behind has broken the deployment it
was measuring.

---

## 31. Inji Verify accepts an SD-JWT presentation with no holder proof

**Observed** (2026-10-23, run `1f91d437-74b4-4c07-9070-9f02b9d21c75`, `inji-verify-service:0.18.2`).
The credential carries a `cnf` key, so the issuer bound it to a holder. The presentation was sent with
every disclosure and **no key binding JWT** after the final `~`. verify-service answered:

```json
{ "allChecksSuccessful": true, "credentialResults": [{ "allChecksSuccessful": true,
  "schemaAndSignatureCheck": { "valid": true, "error": null }, "expiryCheck": { "valid": true } }] }
```

Anyone who has seen the credential once (a screenshot of a QR, a log line, a verifier that kept a
copy) can present it as their own. SD-JWT VC requires key binding whenever the credential has `cnf`.

**Suggested fix:** when the credential has `cnf`, reject a presentation without a KB-JWT.

---

## 32. Inji Verify does not check the nonce in the SD-JWT key binding JWT

**Observed** (2026-10-23, run `efe4378d-8c57-4467-92e0-a85e64e9e9c4`). The KB-JWT is present and
correctly signed by the holder key, but its `nonce` is `stale-nonce-from-an-earlier-exchange`, not the
nonce verify-service issued in its authorization request. Result: `allChecksSuccessful: true`.

The nonce is what stops a captured presentation being replayed to the same verifier later. Without
the check, the key binding proves the holder signed *something* once, not that they are present now.

**Suggested fix:** compare the KB-JWT `nonce` (and `aud`) with the values from the authorization
request that this response answers.

---

## 33. Inji Verify does not apply the presentation definition's constraints

**Observed** (2026-10-23, run `7425c6f0-2322-4272-abd1-3e42a87bf404`). The request asked for
`vct` equal to the playground's credential type. The wallet presented a validly signed credential
whose `vct` ends in `#unrelated`. Result: `allChecksSuccessful: true`, with the unrelated `vct` in
the returned claims.

A relying party that trusts `allChecksSuccessful` will accept any credential the issuer signed, not
the one it asked for. Checking the claims itself is possible, but nothing in the response says the
constraints were skipped.

**Suggested fix:** evaluate `presentation_definition` (or DCQL) constraints against the presented
credential, or report in the response that they were not evaluated.

---

## 34. A used-up online-sharing QR ends on a raw HTTP 401

**Observed** (2026-10-23, Collab: Inji Web and Inji Verify). The credential PDF Inji Web saves says it
can be verified once. Uploading it to Inji Verify a second time does refuse it, but not visibly:
Inji Verify sends the browser to Inji Web, and Mimoto then redirects to

```
https://injiweb.collab.mosip.net/v1/mimoto/null?error=resource_not_found&error_description=The+requested+resource+expired.
```

The `null` is where the return address should be. The browser lands on Chrome's own "HTTP ERROR 401"
page; Inji Verify never regains control, so the verifier sees neither a result nor the reason.

**Suggested fix:** redirect back to the verifier's `redirect_uri` with the error, as OAuth does for
every other authorization failure, so Inji Verify can show "this credential has already been used".

---

## What works, and is worth saying so

A findings list that only records defects gives a misleading impression of a project. Three things
were tested specifically because they might have been wrong, and were not:

- **The OpenID4VP request object is conformant.** Signed, and using the specified parameter names —
  see finding 11, which began as a defect and ended as a documentation note.
- **`/vp-session-results` requires its cookie.** Requesting a result without the session cookie is
  refused with `401`. That httpOnly cookie is the only thing between a presentation result and
  anyone who can reach the endpoint, so it was worth checking rather than assuming; both result APIs
  now run through the playground and report the same set of sub-checks.
- **With `x5c`, an SD-JWT VC verifies through Inji Verify end to end** — signature, holder proof and
  validity period all valid. See finding 8.

---

## Findings against our own code

Included because they are the ones only a real counterparty could have surfaced, and because a
report that lists only other people's defects is not a credible one.

### 20. The reference wallet sent two key identifiers in a proof

Certify rejected our proof with `invalid_proof: Error encountered during proof jwt parsing`. Our
wallet was setting both `jwk` and `kid` in the `openid4vci-proof+jwt` header. OpenID4VCI §7.2.1
requires **exactly one**. Our own issuer accepted it, so the bug was invisible until a second
implementation saw it.

### 21. Preferring a DID reference over a raw key broke SD-JWT holder binding

Once fixed, our wallet chose `kid` whenever the issuer advertised any DID method. An SD-JWT issuer
needs a raw key to place in `cnf`, so credentials went out unbound and Inji Verify correctly
rejected them with `ERR_INVALID_CNF: Missing 'cnf' in SD-JWT payload`. The wallet now prefers a bare
`jwk`, falling back to `did:jwk`.

### 22. Corrupting the last base64url character may not corrupt anything

An Ed25519 signature is 64 bytes, or 86 base64url characters, of which the last carries 4
significant bits and 2 unused. Changing it can decode to the same bytes, leaving the signature
valid. Our first fault-injection implementation did exactly this, and the `break-signature` test
passed while testing nothing. Any negative-path suite that corrupts an encoded signature by touching
its last character has the same problem.

### 23. A verifier that checks only signatures accepts the wrong credential

An early version of our reference verifier checked issuer signatures, disclosure digests and key
binding — and accepted a credential of an unrelated type, because nothing evaluated the presentation
definition it had itself sent. A valid signature proves someone authentic signed something; it does
not prove the holder satisfies what was asked. The same gap is worth checking for in any verifier.

### 24. Reading a result from the wrong field name looks exactly like the other party being broken

Our Inji Verify adapter derived its verdict from `verificationStatus`, which the v2 result does not
carry. Every successful verification was therefore read as `UNKNOWN` and counted as a failure — and
the reports said so.

It was caught only because the x5c comparison produced a result that *should* have been green, which
prompted a look at the raw payload: `allChecksSuccessful: true`, with signature, holder proof and
expiry all valid. The verifier had been working; the adapter was misreading it.

Worth recording because it is the failure mode an interoperability tool is most prone to and least
able to notice. Every other finding here rests on an adapter reading a counterparty's response
correctly, and there is no external signal when one does not. The mitigation now in place is direct
credential verification, which cross-checks the same credential through a second endpoint — that is
how the discrepancy surfaced.

### 25. `@digitalbazaar/ed25519-multikey` emits a 64-byte JWK `d`

`toJwk({secretKey: true})` returns the 64-byte libsodium private key (seed ‖ public key) as JWK `d`.
RFC 8037 §2 defines `d` as the 32-byte seed alone, and Node rejects the longer value with
`ERR_CRYPTO_INVALID_JWK`. Relevant to anyone bridging Data Integrity key material into a JOSE
library, which any issuer supporting both `ldp_vc` and SD-JWT from one key has to do.

---

## Filing upstream

| # | Repository | Severity |
| --- | --- | --- |
| 1, 2, 3 | `mosip/inji-certify` | blocker — pre-authorized code flow unusable as shipped |
| 4 | `mosip/inji-certify` | conformance — RFC 8414 and RFC 7517 discovery both fail at the issuer identifier |
| 4b | `mosip/inji-certify` | HTTP 200 on error; no resolvable DID document in VCIssuance mode |
| 5 | `mosip/inji-certify` | operational — restart loses key aliases |
| 6 | `mosip/inji-verify` | blocker for any ported deployment; small fix |
| 7, 8 | `mosip/inji-verify` | interoperability limits worth documenting if intended |
| 9 | `mosip/inji-certify` | the mock emits a credential no conformant verifier can check |
| 10 | `mosip/inji-verify` | blocker — shipped schema does not match shipped image |
| 11 | `mosip/inji-verify` | documentation only — the request object itself is conformant |
| 12 | `mosip/inji-verify` | triage note for findings 7 and 8 |
| 13 | `mosip/mimoto` | documentation — Inji Web is not a general OpenID4VCI wallet |
| 14 | `mosip/inji-certify`, `mosip/inji-verify` | no build version is discoverable; blocks regression attribution |
| 15 | integrator guidance | by-value OpenID4VP requests do not scan; use `request_uri` |
| 16 | `mosip/inji-certify` | finding 4 confirmed on the public Collab deployment |
| 17 | `mosip/inji-certify` | Collab DID document authorises the DID, not a key |
| 18 | `mosip/inji-verify` | no CORS, so the official SDK needs a proxy |
| 19 | `inji-verify` SDK | current SDK prerelease requires a v2 API the release does not expose |
| 25 | `@digitalbazaar/ed25519-multikey` | spec deviation |

Findings 20–24 are ours and are already fixed in this repository.
