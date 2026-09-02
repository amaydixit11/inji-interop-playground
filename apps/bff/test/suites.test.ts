import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import * as vc from '@digitalbazaar/vc';
import type { ProofType } from '@interop/shared';
import { getIssuerKey } from '../src/core/keys.js';
import { buildDocumentLoader, PLAYGROUND_CONTEXT_PATH } from '../src/core/jsonld.js';
import { createIssuanceSuite, SUITE_CONTEXTS, verificationSuites } from '../src/core/suites.js';

const PUBLIC_URL = 'http://issuer.test';
const issuerKey = await getIssuerKey(PUBLIC_URL);
const documentLoader = buildDocumentLoader({
  publicUrl: PUBLIC_URL,
  statics: {
    [issuerKey.did]: issuerKey.didDocument,
    [issuerKey.kid]: issuerKey.verificationMethod,
    [issuerKey.suiteKid2018]: issuerKey.verificationMethod2018,
    [issuerKey.rsaKid]: issuerKey.rsaKey.verificationMethod(),
  },
});

const SUITES: ProofType[] = ['Ed25519Signature2020', 'Ed25519Signature2018', 'RsaSignature2018'];

function credential(proofType: ProofType): Record<string, unknown> {
  const suiteContext = SUITE_CONTEXTS[proofType];
  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      new URL(PLAYGROUND_CONTEXT_PATH, PUBLIC_URL).toString(),
      ...(suiteContext ? [suiteContext] : []),
    ],
    id: 'urn:uuid:suite-test',
    type: ['VerifiableCredential', 'InteropTestCredential'],
    issuer: issuerKey.did,
    issuanceDate: new Date().toISOString(),
    credentialSubject: { fullName: 'Ada Lovelace' },
  };
}

async function issue(proofType: ProofType) {
  return vc.issue({
    credential: credential(proofType),
    suite: createIssuanceSuite(proofType, issuerKey),
    documentLoader,
  });
}

/**
 * Mirrors the corruption the playground injects.
 *
 * A middle character, deliberately: in base64url the final character often
 * carries unused low-order bits, so altering it can decode to the very same
 * bytes. The tests below exist because that mistake once made a tamper test
 * pass while testing nothing.
 */
function corrupt(value: string): string {
  const index = Math.floor(value.length / 2);
  const current = value[index] as string;
  return value.slice(0, index) + (current === 'A' ? 'B' : 'A') + value.slice(index + 1);
}

describe('Data Integrity suites', () => {
  for (const proofType of SUITES) {
    test(`${proofType} signs and verifies`, async () => {
      const signed = await issue(proofType);
      assert.equal((signed.proof as Record<string, unknown>).type, proofType);

      const result = await vc.verifyCredential({
        credential: signed,
        suite: verificationSuites(),
        documentLoader,
      });
      assert.equal(result.verified, true, JSON.stringify(result.error?.errors?.map((e) => e.message)));
    });

    test(`${proofType} fails once its signature is altered`, async () => {
      const signed = await issue(proofType);
      const proof = signed.proof as Record<string, unknown>;

      // Where the signature lives depends on the suite: 2020 uses a multibase
      // proofValue, the 2018 suites a detached JWS. Corrupting the wrong field
      // would leave the proof intact and prove nothing.
      if (typeof proof.jws === 'string') {
        const [header, , signature] = proof.jws.split('.');
        proof.jws = `${header}..${corrupt(String(signature))}`;
      } else {
        proof.proofValue = corrupt(String(proof.proofValue));
      }

      const result = await vc.verifyCredential({
        credential: signed,
        suite: verificationSuites(),
        documentLoader,
      });
      assert.equal(result.verified, false, `${proofType} accepted a corrupted signature`);
    });

    test(`${proofType} fails once a claim is altered`, async () => {
      const signed = await issue(proofType);
      (signed.credentialSubject as Record<string, unknown>).fullName = 'Grace Hopper';

      const result = await vc.verifyCredential({
        credential: signed,
        suite: verificationSuites(),
        documentLoader,
      });
      assert.equal(result.verified, false, `${proofType} accepted an altered claim`);
    });
  }

  test('a verifier offering every suite accepts each of them', async () => {
    for (const proofType of SUITES) {
      const signed = await issue(proofType);
      const result = await vc.verifyCredential({
        credential: signed,
        suite: verificationSuites(),
        documentLoader,
      });
      assert.equal(result.verified, true, `${proofType} was rejected by the combined suite set`);
    }
  });

  test('only the 2020 suite needs an extra context', () => {
    // credentials/v1 already defines the 2018 suites as protected terms, so
    // adding their contexts is an error rather than a redundancy.
    assert.ok(SUITE_CONTEXTS.Ed25519Signature2020);
    assert.equal(SUITE_CONTEXTS.Ed25519Signature2018, undefined);
    assert.equal(SUITE_CONTEXTS.RsaSignature2018, undefined);
  });
});

describe('signature corruption', () => {
  test('altering the last base64url character can be a no-op', () => {
    // The trap this codebase hit: 64 bytes encode to 86 base64url characters,
    // and the last carries only 4 significant bits. Changing it can decode to
    // identical bytes, so a tamper test touching it may test nothing at all.
    const bytes = Buffer.alloc(64, 7);
    const encoded = bytes.toString('base64url');

    const lastAltered = `${encoded.slice(0, -1)}${encoded.at(-1) === 'A' ? 'B' : 'A'}`;
    const middleAltered = corrupt(encoded);

    assert.ok(
      Buffer.from(middleAltered, 'base64url').equals(bytes) === false,
      'altering a middle character must change the decoded bytes',
    );
    // Not asserted as always-equal — it depends on the trailing bits — but the
    // decoded length must never grow, and equality here is the hazard.
    assert.equal(Buffer.from(lastAltered, 'base64url').length, bytes.length);
  });
});
