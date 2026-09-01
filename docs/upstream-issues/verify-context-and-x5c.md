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

## 2. SD-JWT VC verification requires an `x5c` chain

An SD-JWT VC whose issuer key is identified by `kid` (a `did:web` verification method):

```
{"errorCode":"ERR_SIGNATURE_VERIFICATION_FAILED",
 "errorMessage":"Exception during Verification: getX509CertChain(...) must not be null"}
```

The issuer key appears resolvable only from an embedded certificate chain. IETF SD-JWT VC also defines
resolution from `iss` via `/.well-known/jwt-vc-issuer`, and DID-based resolution is in common use —
including elsewhere in this stack, where Inji Certify advertises `did:jwk` binding.

**Impact.** An issuer that identifies its key by DID, as MOSIP's own documentation encourages,
produces SD-JWT credentials this verifier cannot check.

**Confidence.** The error is unambiguous about the missing chain, but this was not confirmed by
issuing *with* a chain — that would be the obvious next step if the diagnosis is disputed.

**Suggested fix.** Support `iss`-based JWKS resolution per SD-JWT VC §3.5, or document that `x5c` is
required.
