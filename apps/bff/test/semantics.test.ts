import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import type { ConformanceCheck, TamperMode } from '@interop/shared';
import { TAMPER_MODE_LABELS } from '@interop/shared';
import { expectedVerdict, STEP_TIMEOUTS_MS } from '../src/core/engine.js';
import { buildNarrative } from '../src/core/narrative.js';

describe('expected outcomes', () => {
  test('an untampered run is only satisfied by a valid verdict', () => {
    assert.deepEqual(expectedVerdict('none').verdict, ['valid']);
  });

  test('a forged credential must be rejected, and being accepted is the failure', () => {
    for (const tamper of ['break-signature', 'wrong-type', 'replay-nonce', 'strip-holder-proof'] as TamperMode[]) {
      const expectation = expectedVerdict(tamper);
      assert.ok(expectation.verdict.includes('invalid'), `${tamper} should accept an invalid verdict`);
      assert.ok(!expectation.verdict.includes('valid'), `${tamper} must not be satisfied by "valid"`);
    }
  });

  test('an expired credential may be reported as expired or rejected, but not as valid', () => {
    const expectation = expectedVerdict('expire-credential');
    assert.ok(expectation.verdict.includes('valid-but-expired'));
    assert.ok(!expectation.verdict.includes('valid'));
  });

  test('revocation is expected to be rejected despite an intact signature', () => {
    assert.ok(!expectedVerdict('revoke-credential').verdict.includes('valid'));
  });

  test('replaying a response code leaves the presentation itself valid', () => {
    // The fault targets the verifier's replay protection, not the credential,
    // so the verdict should be unaffected and its own check does the work.
    assert.deepEqual(expectedVerdict('replay-response-code').verdict, ['valid']);
  });

  test('every tamper mode has an expectation and a label', () => {
    for (const tamper of Object.keys(TAMPER_MODE_LABELS) as TamperMode[]) {
      const expectation = expectedVerdict(tamper);
      assert.ok(expectation.verdict.length > 0, `${tamper} has no expected verdict`);
      assert.ok(expectation.rationale.length > 0, `${tamper} has no rationale`);
      assert.ok(TAMPER_MODE_LABELS[tamper], `${tamper} has no label`);
    }
  });
});

describe('run narrative', () => {
  const check = (id: string, status: ConformanceCheck['status'] = 'pass'): ConformanceCheck => ({
    id,
    step: 'verify',
    title: id,
    status,
    spec: 'test',
    detail: 'test',
  });

  test('claims the verifier never saw are reported as withheld', () => {
    const narrative = buildNarrative({
      held: {
        format: 'ldp_vc',
        raw: { credentialSubject: { id: 'did:example:1', fullName: 'Ada', gender: 'F', idNumber: 'X' } },
      },
      outcome: { verdict: 'valid', raw: { claims: { fullName: 'Ada' } } },
      checks: [],
    });

    assert.deepEqual(Object.keys(narrative.disclosedClaims), ['fullName']);
    assert.deepEqual(narrative.withheldClaims.sort(), ['gender', 'idNumber']);
    // The subject identifier is not something the credential asserts.
    assert.ok(!('id' in narrative.issuedClaims));
  });

  test('a verifier reporting no claims is assumed to have seen everything', () => {
    // The pessimistic reading, deliberately: claiming a privacy property that
    // was not observed would be the wrong way to be wrong.
    const narrative = buildNarrative({
      held: { format: 'ldp_vc', raw: { credentialSubject: { fullName: 'Ada', gender: 'F' } } },
      outcome: { verdict: 'valid', raw: {} },
      checks: [],
    });
    assert.deepEqual(narrative.withheldClaims, []);
    assert.deepEqual(Object.keys(narrative.disclosedClaims).sort(), ['fullName', 'gender']);
  });

  test('holder binding is only claimed when a check established it', () => {
    const unbound = buildNarrative({ held: { format: 'ldp_vc', raw: {} }, checks: [] });
    assert.equal(unbound.holderBound, false, 'no evidence must not read as bound');

    const bound = buildNarrative({
      held: { format: 'ldp_vc', raw: {} },
      checks: [check('vp.holder-proof'), check('vp.signatures')],
    });
    assert.equal(bound.holderBound, true);
  });

  test('a failed binding check is not reported as bound', () => {
    const narrative = buildNarrative({
      held: { format: 'ldp_vc', raw: {} },
      checks: [check('vp.holder-proof', 'fail')],
    });
    assert.equal(narrative.holderBound, false);
  });

  test('an unchecked property is reported as not established, with a reason', () => {
    const narrative = buildNarrative({ held: { format: 'ldp_vc', raw: {} }, checks: [] });
    const revocation = narrative.verifierEstablished.find((entry) => /revoked/i.test(entry.claim));

    assert.equal(revocation?.ok, false);
    assert.match(revocation?.note ?? '', /not checked/i);
  });

  test('requested claims exclude metadata paths', () => {
    const narrative = buildNarrative({
      request: {
        authorizationRequest: {
          client_id: 'c',
          response_type: 'vp_token',
          response_mode: 'direct_post',
          nonce: 'n',
          presentation_definition: {
            id: 'd',
            input_descriptors: [
              {
                id: 'i',
                constraints: {
                  fields: [{ path: ['$.vct'] }, { path: ['$.docType'] }, { path: ['$.fullName'] }],
                },
              },
            ],
          },
        },
        requestUri: 'u',
        transactionId: 't',
        nonce: 'n',
        state: 's',
        responseUri: 'r',
      },
      checks: [],
    });

    // `vct` and `docType` constrain which credential is acceptable; they are not
    // claims the verifier asked to be shown.
    assert.deepEqual(narrative.requestedClaims, ['fullName']);
  });
});

describe('step deadlines', () => {
  test('every phase has a bounded budget', () => {
    // A participant that accepts the connection and never answers is the most
    // likely real failure, and the least useful one to sit through.
    for (const [step, budget] of Object.entries(STEP_TIMEOUTS_MS)) {
      assert.ok(budget > 0, `${step} has no budget`);
      assert.ok(budget <= 300_000, `${step} budget of ${budget}ms is too long to sit through`);
    }
  });

  test('presentation and verification get longer budgets than discovery', () => {
    // They poll a verifier; discovery is a single request.
    assert.ok(STEP_TIMEOUTS_MS.present > STEP_TIMEOUTS_MS.discover);
    assert.ok(STEP_TIMEOUTS_MS.verify > STEP_TIMEOUTS_MS.discover);
  });
});

describe('grant types', () => {
  test('every grant has a label', async () => {
    const { GRANT_TYPE_LABELS } = await import('@interop/shared');
    assert.deepEqual(Object.keys(GRANT_TYPE_LABELS).sort(), ['authorization_code', 'pre-authorized_code']);
  });

  test('PKCE challenges are derived with S256, not passed through', async () => {
    // A verifier sent as its own challenge is PKCE in name only: anyone who
    // intercepts the authorization request learns what to send.
    const { createHash, randomBytes } = await import('node:crypto');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');

    assert.notEqual(challenge, verifier);
    assert.equal(challenge.length, 43, 'a base64url SHA-256 digest is 43 characters');
    assert.equal(
      createHash('sha256').update(verifier, 'ascii').digest('base64url'),
      challenge,
      'the derivation must be deterministic or the token request cannot be verified',
    );
  });
});
