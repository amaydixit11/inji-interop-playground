import * as vc from '@digitalbazaar/vc';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import type { PresentationDefinition } from '@interop/shared';
import { evaluateConstraints } from './constraints.js';
import type { DocumentLoader } from './jsonld.js';
import { resolveVerificationKey } from './resolver.js';
import { parseSdJwt, verifyDisclosureDigests, verifyKeyBindingHash } from './sdjwt.js';

/** One named assertion made while verifying a presentation. */
export interface PresentationCheck {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  /** A failure that only affects freshness, not authenticity. */
  expiryRelated?: boolean;
}

export interface PresentationVerification {
  verdict: 'valid' | 'invalid' | 'valid-but-expired';
  checks: PresentationCheck[];
  /** Claims recovered from the presentation, for display. */
  claims: Record<string, unknown>;
  /** Decoded presentation, for the inspector. */
  decoded: unknown;
}

export interface VerifyPresentationOptions {
  vpToken: string;
  /** Nonce the verifier issued; must be echoed back by the holder. */
  nonce: string;
  /** The verifier's client identifier, expected as the KB-JWT audience. */
  audience: string;
  /** What the verifier asked for; the presentation must actually satisfy it. */
  presentationDefinition?: PresentationDefinition;
  documentLoader: DocumentLoader;
}

/**
 * Verifies a `vp_token` without being told which format it is.
 *
 * Format is sniffed rather than taken on trust because a real interoperability
 * failure often looks exactly like this: the verifier asked for one format and
 * the wallet sent another. Detecting that and saying so is more useful than
 * failing to parse.
 */
export async function verifyPresentation(
  options: VerifyPresentationOptions,
): Promise<PresentationVerification> {
  const token = options.vpToken.trim();
  const looksLikeJson = token.startsWith('{') || token.startsWith('[');
  if (looksLikeJson) return verifyJsonLdPresentation(token, options);

  const base64Json = tryDecodeBase64Json(token);
  if (base64Json) return verifyJsonLdPresentation(JSON.stringify(base64Json), options);

  if (token.includes('~')) return verifySdJwtPresentation(token, options);

  return {
    verdict: 'invalid',
    checks: [
      {
        id: 'vp.format',
        title: 'vp_token is in a recognised format',
        ok: false,
        detail: 'The token is neither JSON-LD, base64-encoded JSON, nor a tilde-separated SD-JWT.',
      },
    ],
    claims: {},
    decoded: token,
  };
}

function tryDecodeBase64Json(token: string): unknown {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(token) || token.length < 8) return undefined;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    return decoded.trimStart().startsWith('{') ? JSON.parse(decoded) : undefined;
  } catch {
    return undefined;
  }
}

async function verifyJsonLdPresentation(
  raw: string,
  options: VerifyPresentationOptions,
): Promise<PresentationVerification> {
  const checks: PresentationCheck[] = [];
  let presentation: Record<string, unknown>;

  try {
    presentation = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    return {
      verdict: 'invalid',
      checks: [{ id: 'vp.parse', title: 'vp_token parses as JSON', ok: false, detail: String(error) }],
      claims: {},
      decoded: raw,
    };
  }

  const hasProof = Boolean(presentation.proof);
  checks.push({
    id: 'vp.holder-proof',
    title: 'Presentation carries a holder proof',
    ok: hasProof,
    detail: hasProof
      ? 'A proof is present on the presentation, binding it to the holder.'
      : 'No proof on the presentation: the verifier cannot tell who assembled it, only who issued the credential inside it.',
  });

  const result = await vc.verify({
    presentation,
    suite: new Ed25519Signature2020(),
    documentLoader: options.documentLoader,
    challenge: options.nonce,
    unsignedPresentation: !hasProof,
  });

  const errors = collectErrors(result);
  checks.push({
    id: 'vp.signatures',
    title: 'Presentation and credential proofs verify',
    ok: result.verified,
    detail: result.verified ? 'All Data Integrity proofs verified.' : errors.join('; ') || 'Verification failed.',
  });

  // The library checks the challenge against the presentation proof; when the
  // presentation is unsigned there is nothing binding it to our nonce at all.
  if (hasProof) {
    const proof = (Array.isArray(presentation.proof) ? presentation.proof[0] : presentation.proof) as Record<string, unknown>;
    const echoed = proof?.challenge === options.nonce;
    checks.push({
      id: 'vp.nonce',
      title: 'Holder echoed the verifier nonce',
      ok: echoed,
      detail: echoed
        ? 'The proof challenge matches the nonce issued for this request.'
        : `Expected challenge "${options.nonce}" but the proof carried "${String(proof?.challenge)}".`,
    });
  }

  const credentials = toArray(presentation.verifiableCredential);
  const claims: Record<string, unknown> = {};
  let expired = false;

  for (const credential of credentials) {
    if (!credential || typeof credential !== 'object') continue;
    const record = credential as Record<string, unknown>;
    Object.assign(claims, (record.credentialSubject as Record<string, unknown>) ?? {});
    const expiry = record.expirationDate ?? record.validUntil;
    if (typeof expiry === 'string' && new Date(expiry).getTime() < Date.now()) expired = true;
  }

  checks.push({
    id: 'vc.validity-window',
    title: 'Credential is within its validity window',
    ok: !expired,
    detail: expired ? 'The credential expiration date is in the past.' : 'The credential has not expired.',
    expiryRelated: true,
  });

  checks.push(constraintCheck(options.presentationDefinition, credentials[0] as Record<string, unknown>));

  return { verdict: decideVerdict(checks), checks, claims, decoded: presentation };
}

async function verifySdJwtPresentation(
  token: string,
  options: VerifyPresentationOptions,
): Promise<PresentationVerification> {
  const checks: PresentationCheck[] = [];
  let parsed: ReturnType<typeof parseSdJwt>;

  try {
    parsed = parseSdJwt(token);
  } catch (error) {
    return {
      verdict: 'invalid',
      checks: [{ id: 'sdjwt.parse', title: 'SD-JWT parses', ok: false, detail: String(error) }],
      claims: {},
      decoded: token,
    };
  }

  // Issuer signature.
  const kid = (parsed.header.kid as string | undefined) ?? (parsed.payload.iss as string | undefined);
  if (!kid) {
    checks.push({ id: 'sdjwt.kid', title: 'Issuer key is identified', ok: false, detail: 'Neither `kid` nor `iss` is present.' });
  } else {
    try {
      const { key } = await resolveVerificationKey(kid, options.documentLoader, parsed.header.alg as string);
      await jwtVerify(parsed.issuerJwt, key);
      checks.push({
        id: 'sdjwt.issuer-signature',
        title: 'Issuer signature verifies',
        ok: true,
        detail: `Signature verified against ${kid}.`,
      });
    } catch (error) {
      checks.push({
        id: 'sdjwt.issuer-signature',
        title: 'Issuer signature verifies',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Every disclosure must be committed to by the issuer.
  const digests = verifyDisclosureDigests(parsed);
  checks.push({
    id: 'sdjwt.disclosure-digests',
    title: 'Disclosures match the issuer-signed digests',
    ok: digests.ok,
    detail: digests.ok
      ? `All ${parsed.disclosures.length} disclosure(s) are committed to in _sd.`
      : `Disclosures not committed to by the issuer: ${digests.unmatched.join(', ')}.`,
  });

  // Key binding.
  if (parsed.keyBindingJwt) {
    const hash = verifyKeyBindingHash(token);
    checks.push({
      id: 'sdjwt.sd-hash',
      title: 'Key binding JWT covers the presented disclosures',
      ok: hash.ok,
      detail: hash.ok
        ? 'sd_hash matches the presented issuer JWT and disclosures.'
        : `sd_hash mismatch: expected ${hash.expected}, got ${hash.actual}.`,
    });

    const kbPayload = decodeJwt(parsed.keyBindingJwt) as Record<string, unknown>;
    const nonceOk = kbPayload.nonce === options.nonce;
    checks.push({
      id: 'sdjwt.kb-nonce',
      title: 'Key binding JWT echoes the verifier nonce',
      ok: nonceOk,
      detail: nonceOk
        ? 'Nonce matches the value issued for this request.'
        : `Expected nonce "${options.nonce}" but received "${String(kbPayload.nonce)}".`,
    });

    const audienceOk = kbPayload.aud === options.audience;
    checks.push({
      id: 'sdjwt.kb-audience',
      title: 'Key binding JWT is addressed to this verifier',
      ok: audienceOk,
      detail: audienceOk
        ? `Audience is ${options.audience}.`
        : `Expected audience "${options.audience}" but received "${String(kbPayload.aud)}".`,
    });

    const cnf = parsed.payload.cnf as { jwk?: JWK } | undefined;
    if (cnf?.jwk) {
      try {
        const header = decodeProtectedHeader(parsed.keyBindingJwt);
        const holderKey = await importJWK(cnf.jwk, header.alg ?? 'ES256');
        await jwtVerify(parsed.keyBindingJwt, holderKey);
        checks.push({
          id: 'sdjwt.kb-signature',
          title: 'Key binding JWT is signed by the confirmed holder key',
          ok: true,
          detail: 'KB-JWT signature verifies against the `cnf.jwk` in the credential.',
        });
      } catch (error) {
        checks.push({
          id: 'sdjwt.kb-signature',
          title: 'Key binding JWT is signed by the confirmed holder key',
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else {
    checks.push({
      id: 'sdjwt.kb-present',
      title: 'Presentation includes a key binding JWT',
      ok: false,
      detail: 'No KB-JWT: the presentation proves issuance but not possession by this holder.',
    });
  }

  const exp = parsed.payload.exp;
  const expired = typeof exp === 'number' && exp * 1000 < Date.now();
  checks.push({
    id: 'sdjwt.validity-window',
    title: 'Credential is within its validity window',
    ok: !expired,
    detail: expired ? `Credential expired at ${new Date((exp as number) * 1000).toISOString()}.` : 'Credential has not expired.',
    expiryRelated: true,
  });

  checks.push(constraintCheck(options.presentationDefinition, parsed.resolved));

  const { iss, iat, exp: _exp, cnf: _cnf, vct, ...rest } = parsed.resolved;
  return { verdict: decideVerdict(checks), checks, claims: rest, decoded: { ...parsed, vct }, };
}

/**
 * An expired-but-otherwise-sound credential is reported distinctly, because a
 * relying party's response to it (ask for a fresh one) differs from its
 * response to a forged one (reject the holder).
 */
function decideVerdict(checks: PresentationCheck[]): 'valid' | 'invalid' | 'valid-but-expired' {
  const failures = checks.filter((c) => !c.ok);
  if (failures.length === 0) return 'valid';
  if (failures.every((c) => c.expiryRelated)) return 'valid-but-expired';
  return 'invalid';
}

/**
 * Checks that the credential actually satisfies what was asked for.
 *
 * Kept distinct from signature verification because the two failures mean
 * different things: a bad signature means the credential is forged, while an
 * unsatisfied constraint means it is authentic but not what the verifier needs.
 */
function constraintCheck(
  definition: PresentationDefinition | undefined,
  credential: Record<string, unknown> | undefined,
): PresentationCheck {
  if (!credential) {
    return {
      id: 'vp.constraints',
      title: 'Presentation satisfies the presentation definition',
      ok: false,
      detail: 'The presentation contained no credential to evaluate.',
    };
  }

  const result = evaluateConstraints(definition, credential);
  const failures = result.details.filter((detail) => !detail.satisfied);

  return {
    id: 'vp.constraints',
    title: 'Presentation satisfies the presentation definition',
    ok: result.satisfied,
    detail: result.satisfied
      ? `All ${result.details.length} constraint(s) satisfied.`
      : failures.map((f) => `${f.path}: ${f.reason}`).join(' '),
  };
}

function collectErrors(result: { verified: boolean; error?: { errors?: Error[]; message?: string } }): string[] {
  if (result.verified) return [];
  const nested = result.error?.errors ?? [];
  if (nested.length > 0) return nested.map((error) => error.message);
  return result.error?.message ? [result.error.message] : [];
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
