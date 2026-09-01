import type { CheckStatus, ConformanceCheck, RunNarrative } from '@interop/shared';
import type { HeldCredential, PresentationRequest, VerificationOutcome } from '../adapters/types.js';
import { parseSdJwt } from './sdjwt.js';

/**
 * Turns a completed run into something a non-specialist can read.
 *
 * The audience here is somebody who wants to know whether the thing worked and
 * what was shared — not which clause of OpenID4VP was satisfied. Everything is
 * derived from what actually happened rather than from the configuration, so a
 * wallet that ignored the request and over-shared shows up as over-sharing.
 */
export function buildNarrative(input: {
  held?: HeldCredential;
  request?: PresentationRequest;
  outcome?: VerificationOutcome;
  checks: ConformanceCheck[];
}): RunNarrative {
  const issuedClaims = extractIssuedClaims(input.held);
  const requestedClaims = extractRequestedClaims(input.request);
  const disclosedClaims = extractDisclosedClaims(input.outcome, issuedClaims);

  const disclosedNames = new Set(Object.keys(disclosedClaims));
  const withheldClaims = Object.keys(issuedClaims).filter((name) => !disclosedNames.has(name));

  return {
    issuedClaims,
    requestedClaims,
    disclosedClaims,
    withheldClaims,
    holderBound: passed(input.checks, ['sdjwt.kb-signature', 'mdoc.device-auth', 'vp.holder-proof', 'vp.signatures']),
    boundToRequest: passed(input.checks, ['sdjwt.kb-nonce', 'vp.nonce', 'mdoc.device-auth']),
    verdict: input.outcome?.verdict,
    verifierEstablished: summariseChecks(input.checks),
  };
}

/**
 * Maps the technical checks onto the four things a reader actually wants to
 * know, and says plainly when one of them was never established.
 */
function summariseChecks(checks: ConformanceCheck[]): RunNarrative['verifierEstablished'] {
  const find = (ids: string[]) => checks.find((check) => ids.some((id) => check.id.endsWith(id)));

  const rows: Array<{ claim: string; ids: string[]; absent: string }> = [
    {
      claim: 'The credential really was signed by the issuer it names',
      ids: ['signatures', 'issuer-signature', 'issuer-auth', 'direct.credential'],
      absent: 'No signature check ran, so nothing establishes who issued this.',
    },
    {
      claim: 'It has not expired',
      ids: ['validity-window', 'validity'],
      absent: 'The validity period was never checked.',
    },
    {
      claim: 'The issuer has not revoked it',
      ids: ['vc.status'],
      absent: 'Revocation was not checked, so a withdrawn credential would still be accepted.',
    },
    {
      claim: 'It is the kind of credential that was asked for',
      ids: ['constraints'],
      absent: 'Nothing checked that this credential matches what the verifier requested.',
    },
    {
      claim: 'The person presenting it is the one it was issued to',
      ids: ['kb-signature', 'device-auth', 'holder-proof'],
      absent: 'Holder binding was not established — possession of the credential was treated as enough.',
    },
  ];

  return rows.map((row) => {
    const check = find(row.ids);
    if (!check) return { claim: row.claim, ok: false, note: row.absent };
    return {
      claim: row.claim,
      ok: check.status === 'pass',
      note: check.status === 'pass' ? undefined : check.detail,
    };
  });
}

function passed(checks: ConformanceCheck[], ids: string[]): boolean {
  const relevant = checks.filter((check) => ids.some((id) => check.id.endsWith(id)));
  return relevant.length > 0 && relevant.every((check) => check.status === 'pass');
}

function extractIssuedClaims(held?: HeldCredential): Record<string, unknown> {
  if (!held?.raw) return {};

  if (typeof held.raw === 'string' && held.raw.includes('~')) {
    try {
      const parsed = parseSdJwt(held.raw);
      return Object.fromEntries(parsed.disclosures.map((disclosure) => [disclosure.name, disclosure.value]));
    } catch {
      return {};
    }
  }

  if (typeof held.raw === 'object' && held.raw !== null) {
    const subject = (held.raw as Record<string, unknown>).credentialSubject;
    if (subject && typeof subject === 'object') {
      // `id` is the subject identifier, not something the credential asserts.
      const { id: _id, ...rest } = subject as Record<string, unknown>;
      return rest;
    }
  }

  // mdoc is held as opaque base64 CBOR; what it carries is only recoverable
  // from the verifier's own reading of it.
  return held.decoded ?? {};
}

function extractRequestedClaims(request?: PresentationRequest): string[] {
  const descriptors = request?.authorizationRequest.presentation_definition?.input_descriptors ?? [];
  const names = new Set<string>();

  for (const descriptor of descriptors) {
    for (const field of descriptor.constraints?.fields ?? []) {
      for (const path of field.path) {
        const match = /^\$\.([A-Za-z_][\w]*)$/.exec(path);
        const name = match?.[1];
        // Paths into metadata constrain the credential rather than requesting
        // a claim, so they are not things the verifier asked to see.
        if (name && !['vct', 'iss', 'type', 'exp', 'iat', 'cnf', 'docType'].includes(name)) names.add(name);
      }
    }
  }
  return [...names];
}

function extractDisclosedClaims(
  outcome: VerificationOutcome | undefined,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const fromResult = outcome?.credentialResults?.find((result) => result.claims)?.claims;
  if (fromResult && Object.keys(fromResult).length > 0) return fromResult;

  const raw = outcome?.raw as { claims?: Record<string, unknown> } | undefined;
  if (raw?.claims && Object.keys(raw.claims).length > 0) return raw.claims;

  // Nothing reported: assume everything issued was seen, which is the
  // pessimistic reading and the right default for a privacy claim.
  return fallback;
}

export type { CheckStatus };
