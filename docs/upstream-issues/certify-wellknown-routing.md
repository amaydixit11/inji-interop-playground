**Repository:** `mosip/inji-certify`
**Reproduced on:** local `0.14.0` **and** the public `injicertify-mock.collab.mosip.net`

# Most `.well-known` documents are not served at the credential issuer identifier

With Certify's `credential_issuer` set to an origin, only two of the four documents a wallet or
verifier needs are reachable there.

Local `0.14.0`, `credential_issuer = http://localhost:8091`:

| Document | At the issuer identifier | Under `/v1/certify` |
| --- | --- | --- |
| `openid-credential-issuer` | 200 | 200 |
| `oauth-authorization-server` | **404** | 200 |
| `jwks.json` | **404** | 200 |
| `did.json` | 200, but see the note below | — |

The same on Collab, `credential_issuer = https://injicertify-mock.collab.mosip.net` — a deployment
configured by MOSIP rather than by us:

| Document | At the issuer identifier |
| --- | --- |
| `oauth-authorization-server` | **404** |
| `jwks.json` | **404** |

So this is how Certify is deployed, not a local misconfiguration.

## Why it matters

RFC 8414 places authorization server metadata at the issuer identifier, and RFC 7517 does the same
for a JWKS. A wallet performing conformant discovery finds neither the token endpoint nor the issuer's
keys — so a verifier cannot resolve the key for a credential from an issuer it was not separately
configured with.

The documents exist one path segment away, which makes this a routing gap rather than a missing
capability, and correspondingly cheap to fix.

## Suggested fix

`certify-nginx.conf` proxies `/.well-known/openid-credential-issuer` and `/.well-known/did.json` to
the origin. Add `oauth-authorization-server` and `jwks.json` alongside them.

## Note on `did.json`

At the issuer identifier it returns **HTTP 200 with an error body** when the plugin mode does not
support a DID document:

```json
{"response":null,"errors":[{"errorCode":"unsupported_in_current_plugin_mode"}]}
```

An error returned as `200` is treated as the document by any client that checks the status code, and
by caching layers. It should be a `4xx` or `501`.

Separately, no DID document is available in `VCIssuance` plugin mode at all. Combined with credentials
in that mode being issued by `did:example:123456789`, the issuer publishes no resolvable identity and
its credentials name an unresolvable one. Collab, which runs a different plugin mode, publishes a
well-formed document — so this part is mode-specific.
