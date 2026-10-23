/**
 * JSON-LD contexts the playground signs with that no installed package carries.
 *
 * Vendored so issuing and verifying never depends on reaching w3id.org: when
 * they were fetched live, a cold start on a slow or offline network failed the
 * very first run with "Dereferencing a URL did not result in a valid JSON-LD
 * object". Copied verbatim from the URLs below on 2026-10-23.
 */

export const JWS_2020_V1_URL = 'https://w3id.org/security/suites/jws-2020/v1';
export const JWS_2020_V1 = {
  "@context": {
    "privateKeyJwk": {
      "@id": "https://w3id.org/security#privateKeyJwk",
      "@type": "@json"
    },
    "JsonWebKey2020": {
      "@id": "https://w3id.org/security#JsonWebKey2020",
      "@context": {
        "@protected": true,
        "id": "@id",
        "type": "@type",
        "publicKeyJwk": {
          "@id": "https://w3id.org/security#publicKeyJwk",
          "@type": "@json"
        }
      }
    },
    "JsonWebSignature2020": {
      "@id": "https://w3id.org/security#JsonWebSignature2020",
      "@context": {
        "@protected": true,
        "id": "@id",
        "type": "@type",
        "challenge": "https://w3id.org/security#challenge",
        "created": {
          "@id": "http://purl.org/dc/terms/created",
          "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
        },
        "domain": "https://w3id.org/security#domain",
        "expires": {
          "@id": "https://w3id.org/security#expiration",
          "@type": "http://www.w3.org/2001/XMLSchema#dateTime"
        },
        "jws": "https://w3id.org/security#jws",
        "nonce": "https://w3id.org/security#nonce",
        "proofPurpose": {
          "@id": "https://w3id.org/security#proofPurpose",
          "@type": "@vocab",
          "@context": {
            "@protected": true,
            "id": "@id",
            "type": "@type",
            "assertionMethod": {
              "@id": "https://w3id.org/security#assertionMethod",
              "@type": "@id",
              "@container": "@set"
            },
            "authentication": {
              "@id": "https://w3id.org/security#authenticationMethod",
              "@type": "@id",
              "@container": "@set"
            },
            "capabilityInvocation": {
              "@id": "https://w3id.org/security#capabilityInvocationMethod",
              "@type": "@id",
              "@container": "@set"
            },
            "capabilityDelegation": {
              "@id": "https://w3id.org/security#capabilityDelegationMethod",
              "@type": "@id",
              "@container": "@set"
            },
            "keyAgreement": {
              "@id": "https://w3id.org/security#keyAgreementMethod",
              "@type": "@id",
              "@container": "@set"
            }
          }
        },
        "verificationMethod": {
          "@id": "https://w3id.org/security#verificationMethod",
          "@type": "@id"
        }
      }
    }
  }
};

export const STATUS_LIST_2021_V1_URL = 'https://w3id.org/vc/status-list/2021/v1';
export const STATUS_LIST_2021_V1 = {
  "@context": {
    "@protected": true,
    "StatusList2021Credential": {
      "@id": "https://w3id.org/vc/status-list#StatusList2021Credential",
      "@context": {
        "@protected": true,
        "id": "@id",
        "type": "@type",
        "description": "http://schema.org/description",
        "name": "http://schema.org/name"
      }
    },
    "StatusList2021": {
      "@id": "https://w3id.org/vc/status-list#StatusList2021",
      "@context": {
        "@protected": true,
        "id": "@id",
        "type": "@type",
        "statusPurpose": "https://w3id.org/vc/status-list#statusPurpose",
        "encodedList": "https://w3id.org/vc/status-list#encodedList"
      }
    },
    "StatusList2021Entry": {
      "@id": "https://w3id.org/vc/status-list#StatusList2021Entry",
      "@context": {
        "@protected": true,
        "id": "@id",
        "type": "@type",
        "statusPurpose": "https://w3id.org/vc/status-list#statusPurpose",
        "statusListIndex": "https://w3id.org/vc/status-list#statusListIndex",
        "statusListCredential": {
          "@id": "https://w3id.org/vc/status-list#statusListCredential",
          "@type": "@id"
        }
      }
    }
  }
};
