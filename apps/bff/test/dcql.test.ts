import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import type { CredentialFormat, DcqlQuery } from '@interop/shared';
import { buildDcqlQuery, evaluateDcql, requestedClaimNames } from '../src/core/dcql.js';
import { CREDENTIAL_TYPE, VCT } from '../src/core/credentials.js';
import { MDL_DOCTYPE } from '../src/core/mdoc.js';

describe('DCQL query construction', () => {
  test('each format gets the type constraint its own shape defines', () => {
    // The point of DCQL over Presentation Exchange: no generic filter, so a
    // query written for one format is not even syntactically valid for another.
    assert.deepEqual(buildDcqlQuery('ldp_vc').credentials[0]?.meta, {
      type_values: [['VerifiableCredential', CREDENTIAL_TYPE]],
    });
    assert.deepEqual(buildDcqlQuery('vc+sd-jwt').credentials[0]?.meta, { vct_values: [VCT] });
    assert.deepEqual(buildDcqlQuery('mso_mdoc').credentials[0]?.meta, { doctype_value: MDL_DOCTYPE });
  });

  test('claim paths are segment arrays, not JSONPath strings', () => {
    const query = buildDcqlQuery('ldp_vc');
    assert.deepEqual(query.credentials[0]?.claims?.[0]?.path, ['credentialSubject', 'fullName']);
  });

  test('mdoc claim paths are namespaced', () => {
    const path = buildDcqlQuery('mso_mdoc').credentials[0]?.claims?.[0]?.path ?? [];
    assert.equal(path[0], 'org.iso.18013.5.1');
  });

  test('the requested claim names are the leaves of each path', () => {
    for (const format of ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'] as CredentialFormat[]) {
      const names = requestedClaimNames(buildDcqlQuery(format));
      assert.ok(names.length > 0, `${format} produced no claim names`);
      assert.ok(!names.some((name) => name.includes('.')), 'a namespace leaked into a claim name');
    }
  });
});

describe('DCQL evaluation', () => {
  const ldp = buildDcqlQuery('ldp_vc');

  test('a matching credential satisfies the query', () => {
    const result = evaluateDcql(
      ldp,
      { credentialSubject: { fullName: 'Ada', dateOfBirth: '1815-12-10' } },
      { format: 'ldp_vc', types: ['VerifiableCredential', CREDENTIAL_TYPE] },
    );
    assert.equal(result.satisfied, true, JSON.stringify(result.details));
  });

  test('a type outside every accepted set fails', () => {
    const result = evaluateDcql(
      ldp,
      { credentialSubject: { fullName: 'Ada', dateOfBirth: 'x' } },
      { format: 'ldp_vc', types: ['VerifiableCredential', 'Unrelated'] },
    );
    assert.equal(result.satisfied, false);
    assert.ok(result.details.some((d) => !d.satisfied && /type/i.test(d.query)));
  });

  test('a type set matches only when every member is present', () => {
    // A partial match must not satisfy: the set is a conjunction.
    const result = evaluateDcql(
      ldp,
      { credentialSubject: { fullName: 'Ada', dateOfBirth: 'x' } },
      { format: 'ldp_vc', types: ['VerifiableCredential'] },
    );
    assert.equal(result.satisfied, false);
  });

  test('a missing claim fails', () => {
    const result = evaluateDcql(
      ldp,
      { credentialSubject: { fullName: 'Ada' } },
      { format: 'ldp_vc', types: ['VerifiableCredential', CREDENTIAL_TYPE] },
    );
    assert.equal(result.satisfied, false);
    assert.ok(result.details.some((d) => !d.satisfied && d.query.includes('dateOfBirth')));
  });

  test('a value constraint is enforced', () => {
    const query: DcqlQuery = {
      credentials: [{ id: 'c', format: 'ldp_vc', claims: [{ path: ['credentialSubject', 'nationality'], values: ['GB'] }] }],
    };
    assert.equal(
      evaluateDcql(query, { credentialSubject: { nationality: 'GB' } }, { format: 'ldp_vc' }).satisfied,
      true,
    );
    assert.equal(
      evaluateDcql(query, { credentialSubject: { nationality: 'FR' } }, { format: 'ldp_vc' }).satisfied,
      false,
    );
  });

  test('a query for the wrong format fails rather than being ignored', () => {
    const result = evaluateDcql(buildDcqlQuery('mso_mdoc'), {}, { format: 'ldp_vc' });
    assert.equal(result.satisfied, false);
    assert.ok(result.details.some((d) => /format/i.test(d.reason)));
  });

  test('the two SD-JWT media types are treated as one format', () => {
    // `vc+sd-jwt` and `dc+sd-jwt` are the same credential under a draft and a
    // registered name; failing over the spelling would be a false negative.
    const result = evaluateDcql(
      buildDcqlQuery('vc+sd-jwt'),
      { fullName: 'Ada', dateOfBirth: 'x' },
      { format: 'dc+sd-jwt', vct: VCT },
    );
    assert.equal(result.satisfied, true, JSON.stringify(result.details));
  });

  test('SD-JWT and mdoc claims resolve from a flat claim set', () => {
    // The verifier holds disclosures and data elements by plain name, without
    // the container the query addresses them through.
    assert.equal(
      evaluateDcql(buildDcqlQuery('vc+sd-jwt'), { fullName: 'Ada', dateOfBirth: 'x' }, { format: 'vc+sd-jwt', vct: VCT }).satisfied,
      true,
    );
    assert.equal(
      evaluateDcql(
        buildDcqlQuery('mso_mdoc'),
        { given_name: 'Ada', birth_date: 'x' },
        { format: 'mso_mdoc', docType: MDL_DOCTYPE },
      ).satisfied,
      true,
    );
  });

  test('an ldp_vc claim must be at its stated path, not merely present', () => {
    // JSON-LD credentials do have the container, so the flat fallback must not
    // apply — otherwise a claim outside credentialSubject would satisfy a query
    // that asked for one inside it.
    const result = evaluateDcql(
      ldp,
      { fullName: 'Ada', dateOfBirth: 'x' },
      { format: 'ldp_vc', types: ['VerifiableCredential', CREDENTIAL_TYPE] },
    );
    assert.equal(result.satisfied, false);
  });

  test('no query is vacuously satisfied, and says so', () => {
    const result = evaluateDcql(undefined, {}, { format: 'ldp_vc' });
    assert.equal(result.satisfied, true);
    assert.match(result.details[0]?.reason ?? '', /no dcql query/i);
  });
});
