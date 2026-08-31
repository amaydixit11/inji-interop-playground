import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, type JWK, type KeyLike } from 'jose';

/**
 * Minimal but faithful IETF SD-JWT VC implementation.
 *
 * Written directly against the specification rather than pulled from a library
 * so that the playground can deliberately emit malformed variants — a library
 * that refuses to produce a bad token cannot exercise a verifier's negative
 * paths, which is half of what this tool is for.
 */

export interface SdJwtIssueOptions {
  /** `vc+sd-jwt` (draft) or `dc+sd-jwt` (registered media type). */
  typ: 'vc+sd-jwt' | 'dc+sd-jwt';
  issuer: string;
  /** Verifiable credential type identifier. */
  vct: string;
  signingKey: KeyLike;
  alg: 'EdDSA' | 'ES256';
  kid: string;
  /** Claims made selectively disclosable, one disclosure each. */
  selectiveClaims: Record<string, unknown>;
  /** Claims always visible in the issuer-signed payload. */
  alwaysVisibleClaims?: Record<string, unknown>;
  /** Holder public key, embedded as `cnf.jwk` for key binding. */
  holderJwk?: JWK;
  expiresAt?: Date;
  issuedAt?: Date;
}

export interface SdJwtIssueResult {
  /** Issuer-signed JWT plus all disclosures, tilde-separated and tilde-terminated. */
  combined: string;
  issuerJwt: string;
  disclosures: Disclosure[];
  payload: Record<string, unknown>;
}

export interface Disclosure {
  /** base64url of `[salt, claimName, claimValue]`. */
  encoded: string;
  salt: string;
  name: string;
  value: unknown;
  /** base64url(sha-256(encoded)) — what appears in `_sd`. */
  digest: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sha256Digest(input: string): string {
  return createHash('sha256').update(input, 'ascii').digest('base64url');
}

export function makeDisclosure(name: string, value: unknown): Disclosure {
  const salt = base64url(randomBytes(16));
  // The array form is serialised exactly once; the digest must be taken over
  // these precise bytes, so the encoded string is the canonical representation.
  const encoded = base64url(JSON.stringify([salt, name, value]));
  return { encoded, salt, name, value, digest: sha256Digest(encoded) };
}

export async function issueSdJwt(options: SdJwtIssueOptions): Promise<SdJwtIssueResult> {
  const issuedAt = options.issuedAt ?? new Date();
  const disclosures = Object.entries(options.selectiveClaims).map(([name, value]) =>
    makeDisclosure(name, value),
  );

  const payload: Record<string, unknown> = {
    iss: options.issuer,
    iat: Math.floor(issuedAt.getTime() / 1000),
    vct: options.vct,
    _sd_alg: 'sha-256',
    // Digest order must not leak the claim order.
    _sd: disclosures.map((d) => d.digest).sort(),
    ...(options.alwaysVisibleClaims ?? {}),
  };
  if (options.expiresAt) payload.exp = Math.floor(options.expiresAt.getTime() / 1000);
  if (options.holderJwk) payload.cnf = { jwk: options.holderJwk };

  const issuerJwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: options.alg, typ: options.typ, kid: options.kid })
    .sign(options.signingKey);

  return {
    issuerJwt,
    disclosures,
    payload,
    combined: `${issuerJwt}~${disclosures.map((d) => d.encoded).join('~')}${disclosures.length ? '~' : ''}`,
  };
}

export interface SdJwtPresentOptions {
  combined: string;
  /** Claim names to disclose; others are withheld. Omit to disclose everything. */
  disclose?: string[];
  keyBinding?: {
    audience: string;
    nonce: string;
    signingKey: KeyLike;
    alg: 'ES256' | 'EdDSA';
    /** Deliberately sign over the wrong digest, to test verifier enforcement. */
    corruptSdHash?: boolean;
  };
}

/** Builds a holder presentation: issuer JWT, selected disclosures, KB-JWT. */
export async function presentSdJwt(options: SdJwtPresentOptions): Promise<string> {
  const parsed = parseSdJwt(options.combined);
  const selected = options.disclose
    ? parsed.disclosures.filter((d) => options.disclose?.includes(d.name))
    : parsed.disclosures;

  const presentation = `${parsed.issuerJwt}~${selected.map((d) => d.encoded).join('~')}${selected.length ? '~' : ''}`;
  if (!options.keyBinding) return presentation;

  // `sd_hash` binds the KB-JWT to exactly the disclosures being presented, so
  // a verifier can detect a presentation reassembled from a different subset.
  const sdHash = options.keyBinding.corruptSdHash
    ? sha256Digest(`${presentation}tampered`)
    : sha256Digest(presentation);

  const kbJwt = await new SignJWT({
    aud: options.keyBinding.audience,
    nonce: options.keyBinding.nonce,
    iat: Math.floor(Date.now() / 1000),
    sd_hash: sdHash,
  })
    .setProtectedHeader({ alg: options.keyBinding.alg, typ: 'kb+jwt' })
    .sign(options.keyBinding.signingKey);

  return `${presentation}${kbJwt}`;
}

export interface ParsedSdJwt {
  issuerJwt: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  disclosures: Disclosure[];
  keyBindingJwt?: string;
  /** Payload with disclosed claims merged in, for display. */
  resolved: Record<string, unknown>;
}

export function parseSdJwt(combined: string): ParsedSdJwt {
  const parts = combined.split('~');
  const issuerJwt = parts[0];
  if (!issuerJwt) throw new Error('SD-JWT is empty');

  // A trailing empty segment means no key binding JWT; a non-empty final
  // segment after the disclosures is the KB-JWT.
  const last = parts[parts.length - 1];
  const hasKeyBinding = parts.length > 1 && last !== '';
  const disclosureParts = parts.slice(1, hasKeyBinding ? parts.length - 1 : parts.length).filter(Boolean);

  const header = decodeJwtSegment(issuerJwt, 0);
  const payload = decodeJwtSegment(issuerJwt, 1);

  const disclosures = disclosureParts.map((encoded) => {
    const [salt, name, value] = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as [
      string,
      string,
      unknown,
    ];
    return { encoded, salt, name, value, digest: sha256Digest(encoded) };
  });

  const resolved: Record<string, unknown> = { ...payload };
  delete resolved._sd;
  delete resolved._sd_alg;
  for (const disclosure of disclosures) resolved[disclosure.name] = disclosure.value;

  return {
    issuerJwt,
    header,
    payload,
    disclosures,
    keyBindingJwt: hasKeyBinding ? last : undefined,
    resolved,
  };
}

function decodeJwtSegment(jwt: string, index: 0 | 1): Record<string, unknown> {
  const segment = jwt.split('.')[index];
  if (!segment) throw new Error('Malformed JWT');
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Verifies the digest integrity of a presentation: every disclosure presented
 * must be committed to by the issuer-signed `_sd` array.
 *
 * Signature verification is separate — this is the check that catches a holder
 * who invented a disclosure the issuer never made.
 */
export function verifyDisclosureDigests(parsed: ParsedSdJwt): { ok: boolean; unmatched: string[] } {
  const committed = new Set<string>(Array.isArray(parsed.payload._sd) ? (parsed.payload._sd as string[]) : []);
  const unmatched = parsed.disclosures.filter((d) => !committed.has(d.digest)).map((d) => d.name);
  return { ok: unmatched.length === 0, unmatched };
}

/** Recomputes and compares the `sd_hash` binding in a KB-JWT. */
export function verifyKeyBindingHash(combined: string): { ok: boolean; expected?: string; actual?: string } {
  const parsed = parseSdJwt(combined);
  if (!parsed.keyBindingJwt) return { ok: false };
  const kbPayload = decodeJwtSegment(parsed.keyBindingJwt, 1);
  const withoutKb = combined.slice(0, combined.length - parsed.keyBindingJwt.length);
  const expected = sha256Digest(withoutKb);
  return { ok: kbPayload.sd_hash === expected, expected, actual: kbPayload.sd_hash as string | undefined };
}
