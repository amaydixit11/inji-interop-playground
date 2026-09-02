import type {
  CredentialFormat,
  DcqlClaimQuery,
  DcqlCredentialQuery,
  DcqlQuery,
} from '@interop/shared';
import { CREDENTIAL_TYPE, VCT } from './credentials.js';
import { MDL_DOCTYPE, MDL_NAMESPACE } from './mdoc.js';

/**
 * DCQL query construction and evaluation.
 *
 * Kept separate from the Presentation Exchange evaluator rather than folded
 * into it, because the two disagree in ways an abstraction would paper over:
 * DCQL addresses claims by path segments instead of JSONPath, states type
 * constraints per format instead of through generic filters, and returns a
 * `vp_token` keyed by query id instead of a single value. Sharing code would
 * mean testing a normalisation rather than either language.
 */

/** The query a verifier sends for a given format. */
export function buildDcqlQuery(format: CredentialFormat): DcqlQuery {
  const id = 'interop-test-credential';

  if (format === 'mso_mdoc') {
    return {
      credentials: [
        {
          id,
          format: 'mso_mdoc',
          // A single doctype, not a set: mdoc documents have exactly one.
          meta: { doctype_value: MDL_DOCTYPE },
          claims: [
            { path: [MDL_NAMESPACE, 'given_name'] },
            { path: [MDL_NAMESPACE, 'birth_date'] },
          ],
        },
      ],
    };
  }

  if (format === 'vc+sd-jwt' || format === 'dc+sd-jwt') {
    return {
      credentials: [
        {
          id,
          format,
          meta: { vct_values: [VCT] },
          claims: [{ path: ['fullName'] }, { path: ['dateOfBirth'] }],
        },
      ],
    };
  }

  return {
    credentials: [
      {
        id,
        format: 'ldp_vc',
        // Sets of acceptable type arrays; a credential matches if its `type`
        // contains every member of any one set.
        meta: { type_values: [['VerifiableCredential', CREDENTIAL_TYPE]] },
        claims: [
          { path: ['credentialSubject', 'fullName'] },
          { path: ['credentialSubject', 'dateOfBirth'] },
        ],
      },
    ],
  };
}



/** Claim names a wallet should disclose to satisfy a query. */
export function requestedClaimNames(query: DcqlQuery): string[] {
  const names = new Set<string>();

  for (const credential of query.credentials) {
    for (const claim of credential.claims ?? []) {
      // The last string segment is the claim itself; earlier ones are the
      // container — `credentialSubject`, or an mdoc namespace.
      const leaf = [...claim.path].reverse().find((segment) => typeof segment === 'string');
      if (typeof leaf === 'string') names.add(leaf);
    }
  }
  return [...names];
}

export interface DcqlResult {
  satisfied: boolean;
  details: Array<{ query: string; satisfied: boolean; reason: string }>;
}

/**
 * Evaluates a DCQL query against one credential.
 *
 * `presented` is the credential as the verifier reads it, and `docType` is
 * supplied separately for mdoc, where the type lives in the signed MSO rather
 * than in the claim set.
 */
export function evaluateDcql(
  query: DcqlQuery | undefined,
  presented: Record<string, unknown>,
  context: { format: CredentialFormat; docType?: string; vct?: string; types?: string[] },
): DcqlResult {
  if (!query) {
    return { satisfied: true, details: [{ query: '-', satisfied: true, reason: 'No DCQL query to evaluate.' }] };
  }

  const details: DcqlResult['details'] = [];

  for (const credential of query.credentials) {
    const formatMatches = formatEquivalent(credential.format, context.format);
    if (!formatMatches) {
      details.push({
        query: credential.id,
        satisfied: false,
        reason: `Query asks for format "${credential.format}" but the presentation is ${context.format}.`,
      });
      continue;
    }

    const meta = checkMeta(credential, context);
    details.push({ query: `${credential.id} (type)`, satisfied: meta.ok, reason: meta.reason });

    for (const claim of credential.claims ?? []) {
      const outcome = checkClaim(claim, presented, context);
      details.push({ query: `${credential.id} ${claim.path.join('.')}`, satisfied: outcome.ok, reason: outcome.reason });
    }
  }

  return { satisfied: details.every((detail) => detail.satisfied), details };
}

/**
 * Whether a query's format identifier covers the presented one.
 *
 * `vc+sd-jwt` and `dc+sd-jwt` are the same credential under two media types —
 * the draft name and the registered one — so a query for either is satisfied by
 * either. Treating them as distinct would fail a run over the spelling.
 */
function formatEquivalent(queried: string, presented: CredentialFormat): boolean {
  if (queried === presented) return true;
  const sdJwt = ['vc+sd-jwt', 'dc+sd-jwt'];
  return sdJwt.includes(queried) && sdJwt.includes(presented);
}

function checkMeta(
  credential: DcqlCredentialQuery,
  context: { docType?: string; vct?: string; types?: string[] },
): { ok: boolean; reason: string } {
  const meta = credential.meta;
  if (!meta) return { ok: true, reason: 'Query places no constraint on the credential type.' };

  if (meta.doctype_value !== undefined) {
    const ok = context.docType === meta.doctype_value;
    return {
      ok,
      reason: ok
        ? `docType is ${meta.doctype_value}.`
        : `Query requires docType "${meta.doctype_value}" but the document is "${String(context.docType)}".`,
    };
  }

  if (meta.vct_values) {
    const ok = context.vct !== undefined && meta.vct_values.includes(context.vct);
    return {
      ok,
      reason: ok
        ? `vct is ${context.vct}.`
        : `Query accepts vct ${meta.vct_values.join(', ')} but the credential is "${String(context.vct)}".`,
    };
  }

  if (meta.type_values) {
    const types = context.types ?? [];
    // Any one set may match, and a set matches when every member is present.
    const matching = meta.type_values.find((set) => set.every((type) => types.includes(type)));
    return {
      ok: Boolean(matching),
      reason: matching
        ? `Credential type includes ${matching.join(', ')}.`
        : `Query accepts ${meta.type_values.map((set) => `[${set.join(', ')}]`).join(' or ')} but the credential type is [${types.join(', ')}].`,
    };
  }

  return { ok: true, reason: 'Query places no constraint this evaluator recognises.' };
}

function checkClaim(
  claim: DcqlClaimQuery,
  presented: Record<string, unknown>,
  context: { format: CredentialFormat },
): { ok: boolean; reason: string } {
  const value = resolve(presented, claim.path, context.format);

  if (value === undefined) {
    return { ok: false, reason: `No value at ${claim.path.join('.')} in the presentation.` };
  }
  if (claim.values && !claim.values.includes(value)) {
    return {
      ok: false,
      reason: `Value "${String(value)}" is not among the accepted values ${claim.values.map(String).join(', ')}.`,
    };
  }
  return { ok: true, reason: `Present${claim.values ? ' and among the accepted values' : ''}.` };
}

/**
 * Walks a DCQL path.
 *
 * The verifier hands this evaluator a flattened claim set — SD-JWT disclosures
 * and mdoc data elements arrive as plain names, without the container the query
 * addresses them through — so a path is tried in full first and then by its
 * leaf. `null` is DCQL's "every element of this array".
 */
function resolve(
  root: Record<string, unknown>,
  path: Array<string | number | null>,
  format: CredentialFormat,
): unknown {
  let current: unknown = root;

  for (const segment of path) {
    if (current === null || current === undefined) break;

    if (segment === null) {
      current = Array.isArray(current) ? current[0] : undefined;
      continue;
    }
    if (typeof segment === 'number') {
      current = Array.isArray(current) ? current[segment] : undefined;
      continue;
    }
    current = typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined;
  }

  if (current !== undefined) return current;

  // Fall back to the leaf name. Not laxness: for SD-JWT and mdoc the verifier
  // genuinely holds a flat claim set, and insisting on the container would
  // reject a correct presentation over a shape the format does not have.
  if (format !== 'ldp_vc') {
    const leaf = [...path].reverse().find((segment) => typeof segment === 'string');
    if (typeof leaf === 'string') return root[leaf];
  }
  return undefined;
}
