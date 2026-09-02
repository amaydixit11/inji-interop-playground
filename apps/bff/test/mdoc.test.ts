import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { exportJWK, generateKeyPair, type KeyLike } from 'jose';
import { issueMdoc, presentMdoc, verifyMdocPresentation, MDL_DOCTYPE } from '../src/core/mdoc.js';

const issuer = await generateKeyPair('ES256', { extractable: true });
const device = await generateKeyPair('ES256', { extractable: true });
const deviceKeyJwk = await exportJWK(device.publicKey);
const resolveIssuerKey = async (): Promise<KeyLike> => issuer.publicKey as KeyLike;

const CLAIMS = { family_name: 'Lovelace', given_name: 'Ada', birth_date: '1815-12-10' };
const REQUEST = {
  clientId: 'https://verifier.example/response',
  responseUri: 'https://verifier.example/response',
  nonce: 'nonce-abc',
};

async function roundTrip(
  issueOverrides: Parameters<typeof issueMdoc>[0] extends infer T ? Partial<T> : never = {},
  presentOverrides: Record<string, unknown> = {},
) {
  const issued = await issueMdoc({
    claims: CLAIMS,
    signingKey: issuer.privateKey as KeyLike,
    kid: 'did:web:issuer.example#mdoc',
    deviceKeyJwk,
    ...issueOverrides,
  } as Parameters<typeof issueMdoc>[0]);

  const presented = await presentMdoc({
    credential: issued.credential,
    deviceKey: device.privateKey as KeyLike,
    ...REQUEST,
    ...presentOverrides,
  });

  const result = await verifyMdocPresentation({ vpToken: presented.vpToken, ...REQUEST, resolveIssuerKey });
  return { issued, presented, result };
}

const failed = (result: Awaited<ReturnType<typeof roundTrip>>['result']) =>
  result.checks.filter((check) => !check.ok).map((check) => check.id);

describe('mdoc happy path', () => {
  test('every check passes and all claims are recovered', async () => {
    const { result } = await roundTrip();
    assert.deepEqual(failed(result), []);
    assert.deepEqual(result.claims, CLAIMS);
    assert.equal(result.docType, MDL_DOCTYPE);
  });

  test('the credential is base64url CBOR, not JSON', async () => {
    const { issued } = await roundTrip();
    assert.ok(/^[A-Za-z0-9_-]+$/.test(issued.credential));
    const first = Buffer.from(issued.credential.slice(0, 8), 'base64url')[0] as number;
    // CBOR major type 5 is a map, which every IssuerSigned is.
    assert.ok(first >= 0xa0 && first <= 0xbf, 'IssuerSigned should be a CBOR map');
  });
});

describe('mdoc selective disclosure', () => {
  test('withholds elements not asked for, and still verifies', async () => {
    const { result } = await roundTrip({}, { disclose: ['given_name'] });
    assert.deepEqual(failed(result), []);
    assert.deepEqual(Object.keys(result.claims), ['given_name']);
  });

  test('withholding does not disturb the issuer signature', async () => {
    const { result } = await roundTrip({}, { disclose: [] });
    // Nothing disclosed at all: issuer authentication must still hold, because
    // the MSO covers digests rather than the elements themselves.
    assert.ok(!failed(result).includes('mdoc.issuer-auth'));
    assert.deepEqual(result.claims, {});
  });
});

describe('mdoc negative paths', () => {
  test('a corrupted issuer signature is caught', async () => {
    const { result } = await roundTrip({ corruptSignature: true });
    assert.ok(failed(result).includes('mdoc.issuer-auth'));
  });

  test('a digest that does not match its element is caught', async () => {
    const { result } = await roundTrip({ corruptDigest: true });
    assert.ok(failed(result).includes('mdoc.value-digests'));
    // The mismatched element must not reach the caller as a verified claim.
    assert.ok(Object.keys(result.claims).length < Object.keys(CLAIMS).length);
  });

  test('an expired document is reported, and separately from authenticity', async () => {
    const { result } = await roundTrip({ validUntil: new Date(Date.now() - 864e5) });
    const validity = result.checks.find((check) => check.id === 'mdoc.validity');
    assert.equal(validity?.ok, false);
    assert.equal(validity?.expiryRelated, true, 'expiry must be distinguishable from a bad signature');
    assert.ok(!failed(result).includes('mdoc.issuer-auth'), 'an expired document is still authentic');
  });

  test('a missing device signature is caught', async () => {
    const { result } = await roundTrip({}, { omitDeviceAuth: true });
    assert.ok(failed(result).includes('mdoc.device-auth-present'));
  });

  test('a device signature over another exchange is caught', async () => {
    const { result } = await roundTrip({}, { replayNonce: 'a-different-nonce' });
    assert.ok(failed(result).includes('mdoc.device-auth'));
  });

  test('a response captured for one verifier fails against another', async () => {
    const issued = await issueMdoc({
      claims: CLAIMS, signingKey: issuer.privateKey as KeyLike,
      kid: 'k', deviceKeyJwk,
    });
    const presented = await presentMdoc({
      credential: issued.credential, deviceKey: device.privateKey as KeyLike, ...REQUEST,
    });

    // Same token, different relying party: the session transcript changes, so
    // the device signature must no longer verify.
    const result = await verifyMdocPresentation({
      vpToken: presented.vpToken,
      clientId: 'https://someone-else.example/response',
      responseUri: 'https://someone-else.example/response',
      nonce: REQUEST.nonce,
      resolveIssuerKey,
    });
    assert.ok(failed(result).includes('mdoc.device-auth'));
  });

  test('an unresolvable issuer key fails rather than passing silently', async () => {
    const issued = await issueMdoc({
      claims: CLAIMS, signingKey: issuer.privateKey as KeyLike, kid: 'k', deviceKeyJwk,
    });
    const presented = await presentMdoc({
      credential: issued.credential, deviceKey: device.privateKey as KeyLike, ...REQUEST,
    });
    const result = await verifyMdocPresentation({
      vpToken: presented.vpToken, ...REQUEST,
      resolveIssuerKey: async () => {
        throw new Error('cannot resolve');
      },
    });
    assert.ok(failed(result).includes('mdoc.issuer-auth'));
  });

  test('a non-CBOR token is rejected', async () => {
    const result = await verifyMdocPresentation({
      vpToken: 'not-cbor-at-all', ...REQUEST, resolveIssuerKey,
    });
    assert.ok(result.checks.some((check) => !check.ok));
  });
});
