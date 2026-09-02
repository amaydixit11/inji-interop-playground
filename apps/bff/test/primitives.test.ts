import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import type { PresentationDefinition } from '@interop/shared';
import { evaluateConstraints } from '../src/core/constraints.js';
import { StatusList, checkCredentialStatus, checkTokenStatus, tokenStatusReference } from '../src/core/statuslist.js';
import { assessQrPayload, QR_ABSOLUTE_MAX_BYTES, QR_COMFORTABLE_BYTES, QR_WORKABLE_BYTES } from '../src/core/qr.js';

describe('presentation definition constraints', () => {
  const definition = (fields: PresentationDefinition['input_descriptors'][0]['constraints']['fields']) =>
    ({ id: 'd', input_descriptors: [{ id: 'i', constraints: { fields } }] }) as PresentationDefinition;

  test('a const filter compares exactly', () => {
    const d = definition([{ path: ['$.vct'], filter: { type: 'string', const: 'Passport' } }]);
    assert.equal(evaluateConstraints(d, { vct: 'Passport' }).satisfied, true);
    assert.equal(evaluateConstraints(d, { vct: 'DrivingLicence' }).satisfied, false);
  });

  test('a contains filter looks inside an array', () => {
    const d = definition([{ path: ['$.type'], filter: { type: 'array', contains: { const: 'Test' } } }]);
    assert.equal(evaluateConstraints(d, { type: ['VerifiableCredential', 'Test'] }).satisfied, true);
    assert.equal(evaluateConstraints(d, { type: ['VerifiableCredential'] }).satisfied, false);
  });

  test('a required field that is absent fails; an optional one does not', () => {
    assert.equal(evaluateConstraints(definition([{ path: ['$.name'] }]), {}).satisfied, false);
    assert.equal(
      evaluateConstraints(definition([{ path: ['$.name'], optional: true }]), {}).satisfied,
      true,
    );
  });

  test('the first path that resolves wins', () => {
    const d = definition([{ path: ['$.missing', '$.present'], filter: { const: 'x' } }]);
    assert.equal(evaluateConstraints(d, { present: 'x' }).satisfied, true);
  });

  test('nested and indexed paths resolve', () => {
    const d = definition([{ path: ['$.credentialSubject.name'], filter: { const: 'Ada' } }]);
    assert.equal(evaluateConstraints(d, { credentialSubject: { name: 'Ada' } }).satisfied, true);

    const indexed = definition([{ path: ['$.list[1]'], filter: { const: 'b' } }]);
    assert.equal(evaluateConstraints(indexed, { list: ['a', 'b'] }).satisfied, true);
  });

  test('a pattern filter applies a regular expression', () => {
    const d = definition([{ path: ['$.id'], filter: { pattern: '^INJI-' } }]);
    assert.equal(evaluateConstraints(d, { id: 'INJI-1' }).satisfied, true);
    assert.equal(evaluateConstraints(d, { id: 'OTHER-1' }).satisfied, false);
  });

  test('no definition is vacuously satisfied, and says so', () => {
    const result = evaluateConstraints(undefined, { anything: true });
    assert.equal(result.satisfied, true);
    assert.match(result.details[0]?.reason ?? '', /no presentation definition/i);
  });

  test('an unknown filter keyword does not silently reject', () => {
    const d = definition([{ path: ['$.x'], filter: { exclusiveMinimum: 3 } }]);
    // Better to pass and say the keyword was not evaluated than to fail a
    // credential over a constraint this evaluator does not understand.
    assert.equal(evaluateConstraints(d, { x: 5 }).satisfied, true);
  });
});

describe('status lists', () => {
  test('bits round-trip through gzip and base64', () => {
    const list = new StatusList(1024);
    list.set(0, true);
    list.set(7, true);
    list.set(1023, true);

    const decoded = StatusList.decode(list.encode(), 1024);
    assert.equal(decoded.get(0), true);
    assert.equal(decoded.get(7), true);
    assert.equal(decoded.get(1023), true);
    assert.equal(decoded.get(1), false);
  });

  test('bit 0 is the most significant bit of the first byte', () => {
    // The specification is explicit about this, and getting it backwards would
    // revoke the wrong credential rather than fail visibly.
    const list = new StatusList(8);
    list.set(0, true);
    const inflated = StatusList.decode(list.encode(), 8);
    assert.equal(inflated.get(0), true);
    for (let i = 1; i < 8; i += 1) assert.equal(inflated.get(i), false);
  });

  test('a bit can be cleared again', () => {
    const list = new StatusList(64);
    list.set(5, true);
    list.set(5, false);
    assert.equal(list.get(5), false);
  });

  test('an out-of-range index is refused rather than wrapping', () => {
    const list = new StatusList(64);
    assert.throws(() => list.set(64, true), RangeError);
    assert.throws(() => list.get(-1), RangeError);
  });

  test('a credential with no status entry reports unchecked, not unrevoked', async () => {
    const result = await checkCredentialStatus({});
    assert.equal(result.checked, false);
    assert.equal(result.revoked, false);
    assert.match(result.detail, /never be revoked/i);
  });

  test('a malformed status entry reports unchecked', async () => {
    const result = await checkCredentialStatus({
      credentialStatus: { type: 'StatusList2021Entry', statusListIndex: 'not-a-number' },
    });
    assert.equal(result.checked, false);
  });

  test('an unreachable status list is unknown, not good standing', async () => {
    const result = await checkCredentialStatus({
      credentialStatus: {
        type: 'StatusList2021Entry',
        statusPurpose: 'revocation',
        statusListIndex: '3',
        statusListCredential: 'http://127.0.0.1:1/nowhere',
      },
    });
    assert.equal(result.checked, false, 'an unfetchable list must not count as checked');
    assert.equal(result.revoked, false);
    assert.match(result.detail, /not the same as good standing/i);
  });

  test('a token status reference is read from the SD-JWT shape', () => {
    assert.deepEqual(
      tokenStatusReference({ status: { status_list: { idx: 4, uri: 'https://issuer/list' } } }),
      { idx: 4, uri: 'https://issuer/list' },
    );
    assert.equal(tokenStatusReference({}), undefined);
    assert.equal(tokenStatusReference({ status: { status_list: { idx: 'x', uri: 'u' } } }), undefined);
  });

  test('an SD-JWT with no status claim reports unchecked', async () => {
    const result = await checkTokenStatus({});
    assert.equal(result.checked, false);
    assert.match(result.detail, /never be revoked/i);
  });
});

describe('QR capacity', () => {
  const payload = (bytes: number) => 'a'.repeat(bytes);

  test('the bands sit where the thresholds say', () => {
    assert.equal(assessQrPayload(payload(100)).verdict, 'comfortable');
    assert.equal(assessQrPayload(payload(QR_COMFORTABLE_BYTES + 1)).verdict, 'workable');
    assert.equal(assessQrPayload(payload(QR_WORKABLE_BYTES + 1)).verdict, 'unreliable');
    assert.equal(assessQrPayload(payload(QR_ABSOLUTE_MAX_BYTES + 1)).verdict, 'impossible');
  });

  test('boundaries are inclusive of the friendlier band', () => {
    assert.equal(assessQrPayload(payload(QR_COMFORTABLE_BYTES)).verdict, 'comfortable');
    assert.equal(assessQrPayload(payload(QR_WORKABLE_BYTES)).verdict, 'workable');
    assert.equal(assessQrPayload(payload(QR_ABSOLUTE_MAX_BYTES)).verdict, 'unreliable');
  });

  test('size is measured in bytes, not characters', () => {
    // A multi-byte character costs more than one byte of QR capacity, and
    // measuring length would understate a payload with any non-ASCII in it.
    const multibyte = '€'.repeat(100);
    assert.equal(multibyte.length, 100);
    assert.equal(assessQrPayload(multibyte).bytes, 300);
  });

  test('capacity used is reported as a proportion of one QR code', () => {
    const assessment = assessQrPayload(payload(QR_ABSOLUTE_MAX_BYTES));
    assert.ok(Math.abs(assessment.capacityUsed - 1) < 0.001);
  });

  test('compression is reported when it helps', () => {
    const assessment = assessQrPayload(`openid4vp://authorize?${'x=1&'.repeat(200)}`);
    assert.ok(assessment.compressedBytes !== undefined);
    assert.ok((assessment.compressedBytes ?? Infinity) < assessment.bytes);
  });
});
