**Repository:** `mosip/inji-verify` · **Version:** `injistack/inji-verify-service:0.18.2`

# `did:web` resolution does not percent-decode the port, so no non-default-port issuer can be verified

## What happens

Verifying a credential whose issuer is `did:web:host.docker.internal%3A8787:issuer`:

```
POST /v1/verify/v2/vc-verification

{"errorCode":"ERR_SIGNATURE_VERIFICATION_FAILED",
 "errorMessage":"Exception during Verification: … PublicKeyResolutionFailedException:
                 Network request failed with error response -
                 Invalid URL host: \"host.docker.internal%3A8787\""}
```

## Why it is wrong

The did:web method specifies that a port is percent-encoded as `%3A` inside the DID, and that a
resolver decodes it when building the HTTPS URL:

> If the domain contains a port, the colon MUST be percent-encoded.

The encoded form is being passed straight into the URL host, which is not a valid host.

## Impact

No `did:web` issuer on a non-default port can be verified. That is every development, test, CI and
tunnelled deployment — precisely the environments where interoperability gets exercised. A production
issuer on port 443 is unaffected, which is likely why it has not surfaced.

## Suggested fix

Percent-decode the host segment when constructing the resolution URL. For
`did:web:example.com%3A8443:issuer` the target is
`https://example.com:8443/issuer/did.json`.

## Reproducing

Any credential issued by a `did:web` DID with a port. The credential does not need to be unusual in
any other way — the failure is in resolution, before any signature check.
