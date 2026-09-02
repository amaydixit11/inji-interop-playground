**Repository:** `mosip/inji-verify` · **Version:** `injistack/inji-verify-service:0.18.2`

# Two limits on which credentials can be verified: remote JSON-LD contexts, and SD-JWT issuer keys

Both reproduce through `POST /v1/verify/v2/vc-verification` with no presentation involved, so they are
properties of credential handling rather than of the OpenID4VP exchange.

## 1. An issuer-hosted JSON-LD context cannot be loaded

A credential whose `@context` includes one served by the issuer:

```
foundation.identity.jsonld.JsonLDException:
There was a problem encountered loading a remote context [code=LOADING_REMOTE_CONTEXT_FAILED]
```

Isolated with a controlled comparison: the same credential with the custom context removed produces a
*different* error, so this is context loading specifically. The context is reachable from inside the
container — `wget` retrieves it, and `https://www.w3.org/2018/credentials/v1` and
`https://w3id.org/security/suites/ed25519-2020/v1` both resolve — so it is not a network restriction.

**Impact.** A credential with custom claims *must* define them in a context of its own: JSON-LD safe
mode refuses to canonicalise a document with undefined terms, and without safe mode those terms are
silently dropped before signing. So this affects essentially every credential that carries
issuer-specific claims.

**Suggested fix.** Allow remote context resolution with caching and an explicit trust policy, or
document the set of contexts that can be verified so integrators know the boundary.

## 2. SD-JWT VC issuer keys are resolvable only from an `x5c` chain

Confirmed by a controlled comparison: the same credential, from the same issuer, differing only in
how it names its signing key.

| Issuer key reference | `POST /v2/vc-verification` | Full presentation |
| --- | --- | --- |
| `kid` (a `did:web` verification method) | `ERR_SIGNATURE_VERIFICATION_FAILED` — `getX509CertChain(...) must not be null` | rejected |
| `x5c` (chain embedded in the credential) | **valid** | **verifies end to end** |

Nothing else about the credential changed, so the requirement is real and it is specifically the
chain. IETF SD-JWT VC §3.5 also defines resolution from the `iss` value via
`/.well-known/jwt-vc-issuer`, and DID-based resolution is in common use — including elsewhere in this
stack, where Inji Certify advertises `did:jwk` binding.

**Impact.** An issuer that identifies its key by DID, as MOSIP's own documentation encourages,
produces SD-JWT credentials this verifier cannot check.

Worth stating the other half as plainly: with `x5c`, an SD-JWT VC verifies through Inji Verify
completely — signature, holder proof and validity period all reported valid.

**Suggested fix.** Support `iss`-based JWKS resolution per SD-JWT VC §3.5, or document that `x5c` is
required.

## 3. Revocation is not checked for SD-JWT VC, and the response does not say so

On every SD-JWT verification, `statusCheck` comes back as an empty array while the service log reads:

```
i.m.v.vcverifier.CredentialsVerifier : Error occurred while checking credential status of
format VC_SD_JWT: Credential status checking not supported for this credential format.
Returning empty status list
```

An empty status list is indistinguishable, in the response, from a list that was checked and found
clean. A caller reading `allChecksSuccessful` gets `true` for a credential whose revocation was never
examined — so **a revoked SD-JWT VC is accepted**.

The credentials tested carry an IETF Token Status List reference (`status.status_list`), which is the
mechanism SD-JWT VC specifies, so there was something to check.

**Suggested fix.** Implement Token Status List checking for SD-JWT, or distinguish "not checked" from
"checked and clean" in the response. The second is much the smaller change and prevents the silent
acceptance on its own.

## 4. No CORS headers, so the official SDK cannot reach verify-service from another origin

`@injistack/react-inji-verify-sdk` is a React component library, intended to be embedded in a relying
party's own page. Pointed at verify-service from such a page:

```
OPTIONS /v1/verify/v2/vp-session-request → 403
TypeError: Failed to fetch
```

No `Access-Control-*` headers are sent and the preflight is refused, so a browser cannot call
verify-service from anywhere except a page served from its own origin — which is the one situation
where a component library is unnecessary.

Every integrator embedding the SDK therefore has to put a same-origin proxy in front of
verify-service.

**Suggested fix.** Configurable CORS, or documentation stating plainly that the SDK requires a proxy
and why.
