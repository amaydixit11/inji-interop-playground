import type { PresentationDefinition } from '@interop/shared';

/**
 * Evaluates the Presentation Exchange constraints in a presentation definition
 * against a credential.
 *
 * A verifier that checks only signatures will happily accept a perfectly valid
 * credential of entirely the wrong kind — it proves someone signed something,
 * not that the holder satisfies what was asked. This is the check that closes
 * that gap.
 *
 * Only the subset of JSONPath that presentation definitions realistically use
 * is supported: a dotted path from the root, optionally through arrays.
 */
export interface ConstraintResult {
  satisfied: boolean;
  /** One entry per field evaluated, for reporting. */
  details: Array<{ path: string; satisfied: boolean; reason: string }>;
}

export function evaluateConstraints(
  definition: PresentationDefinition | undefined,
  credential: Record<string, unknown>,
): ConstraintResult {
  if (!definition) {
    return { satisfied: true, details: [{ path: '-', satisfied: true, reason: 'No presentation definition to evaluate.' }] };
  }

  const details: ConstraintResult['details'] = [];

  for (const descriptor of definition.input_descriptors ?? []) {
    for (const field of descriptor.constraints?.fields ?? []) {
      // Per Presentation Exchange, the first path that resolves wins.
      let resolved: unknown;
      let matchedPath: string | undefined;
      for (const path of field.path) {
        const value = resolvePath(credential, path);
        if (value !== undefined) {
          resolved = value;
          matchedPath = path;
          break;
        }
      }

      const displayPath = matchedPath ?? field.path.join(' | ');

      if (resolved === undefined) {
        if (field.optional) {
          details.push({ path: displayPath, satisfied: true, reason: 'Optional field absent.' });
        } else {
          details.push({ path: displayPath, satisfied: false, reason: 'Required field is not present in the credential.' });
        }
        continue;
      }

      if (!field.filter) {
        details.push({ path: displayPath, satisfied: true, reason: 'Field present; no filter constrained its value.' });
        continue;
      }

      const outcome = applyFilter(resolved, field.filter);
      details.push({ path: displayPath, satisfied: outcome.ok, reason: outcome.reason });
    }
  }

  return { satisfied: details.every((detail) => detail.satisfied), details };
}

/** Supports `$`, `$.a.b`, and `$.a[0].b`. */
function resolvePath(root: unknown, path: string): unknown {
  if (path === '$') return root;
  if (!path.startsWith('$')) return undefined;

  const segments = path
    .slice(1)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/** The JSON Schema keywords presentation definitions actually use. */
function applyFilter(value: unknown, filter: Record<string, unknown>): { ok: boolean; reason: string } {
  if ('const' in filter) {
    const ok = value === filter.const;
    return {
      ok,
      reason: ok ? `Value equals "${String(filter.const)}".` : `Expected "${String(filter.const)}" but found "${String(value)}".`,
    };
  }

  if ('contains' in filter && Array.isArray(value)) {
    const contains = filter.contains as Record<string, unknown>;
    const target = contains?.const;
    const ok = value.includes(target);
    return {
      ok,
      reason: ok
        ? `Array contains "${String(target)}".`
        : `Array [${value.map(String).join(', ')}] does not contain "${String(target)}".`,
    };
  }

  if ('enum' in filter && Array.isArray(filter.enum)) {
    const ok = filter.enum.includes(value);
    return {
      ok,
      reason: ok ? `Value is one of the permitted values.` : `"${String(value)}" is not in [${filter.enum.map(String).join(', ')}].`,
    };
  }

  if ('pattern' in filter && typeof filter.pattern === 'string') {
    const ok = typeof value === 'string' && new RegExp(filter.pattern).test(value);
    return { ok, reason: ok ? 'Value matches the required pattern.' : `"${String(value)}" does not match /${filter.pattern}/.` };
  }

  if ('type' in filter) {
    const expected = filter.type;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    const ok = expected === actual || (expected === 'number' && actual === 'number');
    return { ok, reason: ok ? `Value is of type ${actual}.` : `Expected type ${String(expected)} but found ${actual}.` };
  }

  return { ok: true, reason: 'Filter uses keywords this evaluator does not constrain on; treated as satisfied.' };
}
