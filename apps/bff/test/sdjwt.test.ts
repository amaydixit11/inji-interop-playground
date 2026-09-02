import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { exportJWK, generateKeyPair, type KeyLike } from 'jose';
import {
  issueSdJwt,
  makeDisclosure,
  parseSdJwt,
  presentSdJwt,
  verifyDisclosureDigests,
  verifyKeyBindingHash,
} from '../src/core/sdjwt.js';

const issuer = await generateKeyPair('EdDSA', { extractable: true });
const holder = await generateKeyPair('ES256', { extractable: true });
const holderJwk = await exportJWK(holder.publicKey);

const CLAIMS = { fullName: 'Ada Lovelace', dateOfBirth: '1815-12-10', nationality: 'GB' };

async function issue() {
  return issueSdJwt({
    typ: 'vc+sd-jwt',
    issuer: 'did:web:issuer.example',
    vct: 'TestCredential',
    signingKey: issuer.privateKey as KeyLike,
    alg: 'EdDSA',
    kid: 'did:web:issuer.example#key-1',
    selectiveClaims: CLAIMS,
    holderJwk,
  });
}

describe('SD-JWT issuance', () => {
  test('every selective claim gets its own disclosure', async () => {
    const issued = await issue();
    assert.deepEqual(
      issued.disclosures.map((d) => d.name).sort(),
      Object.keys(CLAIMS).sort(),
    );
  });

  test('the payload commits to each disclosure by digest, not by value', async () => {
    const issued = await issue();
    const sd = issued.payload._sd as string[];

    assert.equal(sd.length, issued.disclosures.length);
    for (const disclosure of issued.disclosures) {
      assert.ok(sd.includes(disclosure.digest), `_sd is missing the digest for ${disclosure.name}`);
    }
    // The point of the scheme: the signed payload carries digests, not claims.
    for (const name of Object.keys(CLAIMS)) {
      assert.ok(!(name in issued.payload), `payload carries the claim name ${name}`);
    }

    // Short values like "GB" occur incidentally inside base64url digests, so
    // only distinctive ones are meaningful evidence of a leak.
    const serialised = JSON.stringify(issued.payload);
    for (const value of Object.values(CLAIMS).filter((v) => v.length >= 8)) {
      assert.ok(!serialised.includes(value), `payload leaked the value ${value}`);
    }
  });

  test('digests are ordered independently of claim order', async () => {
    const forward = await issueSdJwt({
      typ: 'vc+sd-jwt', issuer: 'i', vct: 'v', signingKey: issuer.privateKey as KeyLike,
      alg: 'EdDSA', kid: 'k', selectiveClaims: { a: '1', b: '2' },
    });
    const sd = forward.payload._sd as string[];
    assert.deepEqual([...sd].sort(), sd, '_sd should be sorted so it cannot leak claim order');
  });

  test('the same claim salts differently on each issuance', () => {
    const first = makeDisclosure('fullName', 'Ada');
    const second = makeDisclosure('fullName', 'Ada');
    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.digest, second.digest, 'identical claims must not produce a linkable digest');
  });
});

describe('SD-JWT presentation', () => {
  test('withholds every claim not asked for', async () => {
    const issued = await issue();
    const presented = await presentSdJwt({ combined: issued.combined, disclose: ['fullName'] });
    const parsed = parseSdJwt(presented);

    assert.deepEqual(parsed.disclosures.map((d) => d.name), ['fullName']);
    assert.ok(!('dateOfBirth' in parsed.resolved));
    assert.equal(parsed.resolved.fullName, 'Ada Lovelace');
  });

  test('withheld claims remain committed to, so tampering is still detectable', async () => {
    const issued = await issue();
    const presented = await presentSdJwt({ combined: issued.combined, disclose: ['fullName'] });
    const parsed = parseSdJwt(presented);

    // The issuer's _sd still lists all three digests even though one is shown.
    assert.equal((parsed.payload._sd as string[]).length, 3);
    assert.ok(verifyDisclosureDigests(parsed).ok);
  });

  test('a disclosure the issuer never made is rejected', async () => {
    const issued = await issue();
    const forged = makeDisclosure('salary', '999999');
    const tampered = `${issued.issuerJwt}~${forged.encoded}~`;

    const result = verifyDisclosureDigests(parseSdJwt(tampered));
    assert.equal(result.ok, false);
    assert.deepEqual(result.unmatched, ['salary']);
  });

  test('key binding hash covers exactly the disclosures presented', async () => {
    const issued = await issue();
    const presented = await presentSdJwt({
      combined: issued.combined,
      disclose: ['fullName'],
      keyBinding: { audience: 'https://verifier.example', nonce: 'n1', signingKey: holder.privateKey as KeyLike, alg: 'ES256' },
    });

    assert.ok(verifyKeyBindingHash(presented).ok);

    // Splicing an extra disclosure in must invalidate the binding, because the
    // hash was taken over the set that was actually presented.
    const parsed = parseSdJwt(presented);
    const extra = issued.disclosures.find((d) => d.name === 'nationality');
    const spliced = `${parsed.issuerJwt}~${parsed.disclosures[0]?.encoded}~${extra?.encoded}~${parsed.keyBindingJwt}`;
    assert.equal(verifyKeyBindingHash(spliced).ok, false);
  });

  test('a corrupted sd_hash is detected', async () => {
    const issued = await issue();
    const presented = await presentSdJwt({
      combined: issued.combined,
      keyBinding: {
        audience: 'https://verifier.example', nonce: 'n1',
        signingKey: holder.privateKey as KeyLike, alg: 'ES256', corruptSdHash: true,
      },
    });
    assert.equal(verifyKeyBindingHash(presented).ok, false);
  });

  test('no key binding leaves nothing to check', async () => {
    const issued = await issue();
    const presented = await presentSdJwt({ combined: issued.combined });
    assert.equal(parseSdJwt(presented).keyBindingJwt, undefined);
    assert.equal(verifyKeyBindingHash(presented).ok, false);
  });
});

describe('SD-JWT parsing', () => {
  test('a trailing tilde means no key binding, not an empty one', async () => {
    const issued = await issue();
    assert.ok(issued.combined.endsWith('~'));
    assert.equal(parseSdJwt(issued.combined).keyBindingJwt, undefined);
  });

  test('an empty token is rejected rather than silently parsed', () => {
    assert.throws(() => parseSdJwt(''));
  });
});
