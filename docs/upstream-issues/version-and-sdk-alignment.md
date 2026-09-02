**Repositories:** `mosip/inji-certify`, `mosip/inji-verify`, `inji-verify` SDK
**Versions:** Certify `0.14.0`, verify-service `0.18.2`, SDK `@injistack/…@1.0.0-dev.2`

# Nothing states which versions of these components work together, and two of them do not

Three observations that are really one problem: it is not possible to establish, from the software or
its documentation, which combination of Inji components is expected to interoperate.

## 1. No service will report its own build

| Service | Version endpoint | Result |
| --- | --- | --- |
| Mimoto | `/v1/mimoto/actuator/info` | build name, artifact and git commit |
| Inji Certify | `/v1/certify/actuator/info` | HTTP **200** carrying `{"errors":[{"errorCode":"unknown_error"}]}` |
| Inji Verify | `/actuator/info`, `/v1/verify/actuator/info` | **404** |

Mimoto is the only one that answers. Certify's actuator is reachable but returns an error envelope
under a success status — the same pattern as the DID document endpoint. verify-service exposes no
actuator at all.

**Impact.** A regression cannot be attributed to a release. "This worked last month and fails now" is
unanswerable without someone remembering which container tags were running, which is exactly what a
version endpoint exists to record.

**Suggested fix.** Enable the Spring Boot actuator `info` endpoint with build information on Certify
and verify-service, as Mimoto already does. Configuration, not a feature.

## 2. The recommended SDK is deprecated, and its replacement needs an API the release does not expose

`@mosip/react-inji-verify-sdk` is deprecated, with a community advisory directing users to
`@injistack/react-inji-verify-sdk`. Following that advice breaks against the current release:

| SDK | Endpoint it calls | On verify-service 0.18.2 |
| --- | --- | --- |
| `@mosip/…@0.16.0` (deprecated) | `/vp-request`, `/vc-verification` | both exist |
| `@injistack/…@1.0.0-dev.2` (current) | `/v2/vp-session-request` | **404** |

Confirmed independently: `/v2/vp-session-request`, `/v2/vp-request` and `/v2/vp-session-results` are
all absent from 0.18.2, while the v1 paths the deprecated SDK uses are present. With CORS worked
around by a proxy, the SDK's request reaches verify-service and returns `404 Not Found`.

In fairness `1.0.0-dev.2` is a prerelease, presumably built against an unreleased verify-service. The
problem is the combination a reader is steered into: the documented package is deprecated, its
replacement is a prerelease requiring a newer API, and nothing says which pairs work.

**Suggested fix.** A compatibility table in the SDK README naming the verify-service versions each
release targets — and, ideally, a non-prerelease under the new scope.

## 3. `assertionMethod` in the Collab DID document authorises the DID, not a key

`https://injicertify-mock.collab.mosip.net/.well-known/did.json`:

```json
{
  "id": "did:web:injicertify-mock.collab.mosip.net",
  "verificationMethod": [
    { "id": "did:web:injicertify-mock.collab.mosip.net#sLECdoF_na9Cdz3LCIXi8n_qdzmaFCy0wr5vIJ7CIJQ",
      "type": "Ed25519VerificationKey2020", "publicKeyMultibase": "…" }
  ],
  "assertionMethod": ["did:web:injicertify-mock.collab.mosip.net"]
}
```

DID Core §5.3.2 requires each `assertionMethod` entry to be an embedded verification method or a
reference to one — an id carrying the fragment, here `#sLECdoF_…`. This entry is the bare DID, so
dereferencing it returns the document rather than a key.

**Impact.** A Data Integrity verifier establishes that the key which made a proof is authorised for
the `assertionMethod` purpose. There is nothing here to compare the proof's `verificationMethod`
against, so the check fails open or closed depending on the implementation — ambiguity inside a trust
decision.

**Suggested fix.** `"assertionMethod": ["did:web:injicertify-mock.collab.mosip.net#sLECdoF_…"]`.
