**Repository:** `mosip/inji-certify` · **Version:** `injistack/inji-certify-with-plugins:0.14.0`

# Pre-authorized code flow cannot complete with the shipped docker-compose configuration

Following `docker-compose/docker-compose-injistack` as documented, `POST /v1/certify/pre-authorized-data`
through to `POST /v1/certify/issuance/credential` cannot be completed. Three separate issues block it,
each only visible once the previous is worked around.

## 1. `credentialOfferCache` is missing from `mosip.certify.cache.names`

```
POST /v1/certify/pre-authorized-data
{"errorCode":"unknown_error","errorMessage":"credentialOfferCache not available"}
```

`config/certify-default.properties` sets:

```properties
mosip.certify.cache.names=userinfo,vcissuance,certificatedatacache,credentialConfig,renderTemplate,jwks,preAuthCodeCache,asMetadataCache
```

`credentialOfferCache` is absent, and with `spring.cache.type=simple` a cache not listed in
`spring.cache.cache-names` does not exist. Every call to `/pre-authorized-data` fails.

**Suggested fix:** add `credentialOfferCache` to that list.

## 2. Pre-authorized tokens are signed locally but validated against a remote eSignet

After fixing (1), every credential request returns `401`, then `{"error":"invalid_token"}` once the
JWKS URL is corrected. Three properties cannot all be right at once:

| Property | Resolves to | Role |
| --- | --- | --- |
| `mosip.certify.oauth.issuer` | `https://esignet-mock.collab.mosip.net` | the `iss` Certify **mints** |
| `mosip.certify.authn.issuer-uri` | `…/v1/esignet` | the `iss` Certify **expects** |
| `mosip.certify.authn.jwk-set-uri` | remote eSignet JWKS | the keys it validates against |

Certify signs the pre-authorized access token with its own key, then validates it against a remote
authorization server under a different issuer string. Correct for the authorization-code flow;
impossible for the pre-authorized-code flow Certify implements itself.

Lines 221–224 of the same file carry the fix, commented out:

```properties
#mosip.certify.authorization.url=${mosip.certify.domain.url}
#mosip.certify.authn.issuer-uri=${mosip.certify.authorization.url}
#mosip.certify.authn.jwk-set-uri=${mosip.certify.authorization.url}${server.servlet.path}/.well-known/jwks.json
```

**Suggested fix:** ship a profile that enables that block, or document that the pre-authorized-code
flow requires it.

## 3. `plugin-mode=DataProvider` cannot be combined with the pre-authorized code flow

With (1) and (2) fixed:

```
{"error":"ERROR_FETCHING_IDENTITY_DATA"}

io.mosip.certify.util.CSVReader : No identifier found.
DataProviderExchangeException: No record found in csv
```

The `csvdp-farmer` profile sets `plugin-mode=DataProvider`, which resolves the subject by looking the
token's `sub` up in a CSV. The pre-authorized code flow puts the **claims JSON** in `sub`:

```json
"sub": "{\"fullName\":\"Ada Lovelace\",\"dateOfBirth\":\"1815-12-10\",...}"
```

No configuration reconciles this. The CSV lookup column is `id`, and claim validation independently
rejects `id` because it is not among the advertised `credentialSubject` keys, so the identifier can
never be supplied.

**Suggested fix:** document that the pre-authorized code flow requires `plugin-mode=VCIssuance`, and
reject the combination at startup rather than at the first credential request.

## 4. Most `.well-known` documents are not served at the credential issuer identifier

With Certify configured as its own authorization server, `credential_issuer` is `http://localhost:8091`:

| Document | At the issuer identifier | Under `/v1/certify` |
| --- | --- | --- |
| `openid-credential-issuer` | 200 | 200 |
| `oauth-authorization-server` | **404** | 200 |
| `jwks.json` | **404** | 200 |

`certify-nginx.conf` proxies only `openid-credential-issuer` and `did.json` to the origin. RFC 8414
and RFC 7517 place their documents at the issuer identifier, so conformant discovery finds neither
the token endpoint nor the issuer's keys — even though both exist one path segment away.

**Impact:** a verifier resolving the issuer's key from the credential issuer identifier gets nothing,
so it cannot verify a credential from an issuer it was not separately configured with.

**Suggested fix:** add `oauth-authorization-server` and `jwks.json` to the nginx locations.

## 4b. `/.well-known/did.json` returns HTTP 200 with an error body

```
GET http://localhost:8091/.well-known/did.json   → HTTP 200

{"response":null,"errors":[{"errorCode":"unsupported_in_current_plugin_mode"}]}
```

An error returned as `200` is treated as the document by any client that checks the status code, and
by caching layers. It should be a `4xx` or `501`.

Separately: no DID document is available in `VCIssuance` plugin mode at all. Combined with issue 6
below — credentials in that mode are issued by `did:example:123456789` — the issuer publishes no
resolvable identity and its credentials name an unresolvable one.

## 6. The mock issuance plugin emits a structurally unverifiable credential

A credential issued in `VCIssuance` mode:

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

Placeholder values are expected of a plugin named "mock". Three of these are structural defects that
would be defects in any credential:

1. **`https://schema.org/` is not a JSON-LD context.** Independently confirmed: it returns
   `text/html` even when requested with `Accept: application/ld+json`. A JSON-LD processor cannot
   canonicalise the credential, so its proof cannot be verified by anyone. The context document is at
   `https://schema.org/docs/jsonldcontext.jsonld`.
2. **`verificationMethod` points at a JWKS endpoint**, which is a *set* of keys. Data Integrity
   expects an identifier for one key; a verifier cannot tell which one signed.
3. **The credential does not match the advertised configuration.** Metadata advertises
   `FarmerCredential` signed with `EdDSA`; the credential is a `MockVerifiableCredential` signed with
   `RsaSignature2018`.

## 5. Key aliases do not survive a container restart

```
io.mosip.kernel.core.keymanager.exception.NoSuchSecurityProviderException:
KER-KMA-004 --> No such alias: d83b1bcf-c3f2-417f-81e5-9b641d6be9c7
```

Recreating the `certify` container against an existing database leaves aliases in the database that
are not in the PKCS12 keystore, and startup fails. Every configuration change requires `down -v`,
discarding all issued credentials.

## Reproducing

All five reproduce from a compose file with the upstream configuration vendored unchanged:
https://github.com/…/inji-interop-playground (`docker-compose.inji.yml`, with each workaround applied
in a commented environment variable).
