import { randomUUID } from 'node:crypto';
import * as vc from '@digitalbazaar/vc';
import jsigs from 'jsonld-signatures';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import type { JWK } from 'jose';
import type { CredentialFormat, TamperMode } from '@interop/shared';
import type { IssuerKey } from './keys.js';
import type { DocumentLoader } from './jsonld.js';
import { PLAYGROUND_CONTEXT_PATH } from './jsonld.js';
import { issueMdoc, MDL_DOCTYPE } from './mdoc.js';
import { issueSdJwt } from './sdjwt.js';

export const CREDENTIAL_TYPE = 'InteropTestCredential';
export const VCT = 'https://inji-interop-playground.dev/vct/InteropTestCredential';

export const DEFAULT_CLAIMS: Record<string, unknown> = {
  fullName: 'Ada Lovelace',
  dateOfBirth: '1815-12-10',
  gender: 'Female',
  nationality: 'GB',
  idNumber: 'INJI-0000-0001',
};

export interface MintOptions {
  format: CredentialFormat;
  claims: Record<string, unknown>;
  issuerKey: IssuerKey;
  publicUrl: string;
  documentLoader: DocumentLoader;
  /** Holder public key, bound into the credential where the format supports it. */
  holderJwk?: JWK;
  holderDid?: string;
  tamper: TamperMode;
}

export interface MintedCredential {
  format: CredentialFormat;
  /** Encoded credential exactly as it goes on the wire. */
  raw: unknown;
  /** Human-readable view for the inspector. */
  decoded: Record<string, unknown>;
  /** Notes about deliberate corruption applied, surfaced in the report. */
  tamperNotes: string[];
}

/**
 * Produces a credential in the requested format, applying any requested
 * tampering *after* signing so the corruption is detectable rather than simply
 * being signed over.
 */
export async function mintCredential(options: MintOptions): Promise<MintedCredential> {
  switch (options.format) {
    case 'ldp_vc':
      return mintJsonLd(options);
    case 'vc+sd-jwt':
    case 'dc+sd-jwt':
      return mintSdJwtVc(options, options.format);
    case 'mso_mdoc':
      return mintMdoc(options);
    default: {
      const exhaustive: never = options.format;
      throw new Error(`Unsupported format: ${String(exhaustive)}`);
    }
  }
}

async function mintJsonLd(options: MintOptions): Promise<MintedCredential> {
  const tamperNotes: string[] = [];
  const expired = options.tamper === 'expire-credential';
  const now = new Date();
  const issuanceDate = expired ? new Date(now.getTime() - 365 * 864e5) : now;
  const expirationDate = expired ? new Date(now.getTime() - 864e5) : new Date(now.getTime() + 365 * 864e5);

  const type = ['VerifiableCredential'];
  if (options.tamper === 'wrong-type') {
    type.push('UnrelatedCredential');
    tamperNotes.push('Credential type set to UnrelatedCredential so it cannot satisfy the input descriptor.');
  } else {
    type.push(CREDENTIAL_TYPE);
  }
  if (expired) tamperNotes.push(`expirationDate backdated to ${expirationDate.toISOString()}.`);

  const credential: Record<string, unknown> = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      new URL(PLAYGROUND_CONTEXT_PATH, options.publicUrl).toString(),
    ],
    id: `urn:uuid:${randomUUID()}`,
    type,
    issuer: options.issuerKey.did,
    issuanceDate: issuanceDate.toISOString(),
    expirationDate: expirationDate.toISOString(),
    credentialSubject: {
      ...(options.holderDid ? { id: options.holderDid } : {}),
      ...options.claims,
    },
  };

  const suite = new Ed25519Signature2020({ key: options.issuerKey.suiteKey });

  // `vc.issue` validates the credential before signing and refuses one whose
  // expirationDate has already passed — reasonable for a real issuer, but it
  // makes the expired-credential negative test impossible. For that case only,
  // drop to the signing layer directly so the artefact is genuinely signed and
  // genuinely stale, which is exactly what the verifier needs to be shown.
  const signed = expired
    ? await jsigs.sign(credential, {
        suite,
        purpose: new jsigs.purposes.AssertionProofPurpose(),
        documentLoader: options.documentLoader,
      })
    : ((await vc.issue({
        credential,
        suite,
        documentLoader: options.documentLoader,
      })) as Record<string, unknown>);

  if (options.tamper === 'break-signature') {
    const proof = signed.proof as Record<string, unknown>;
    proof.proofValue = corruptSignature(String(proof.proofValue));
    tamperNotes.push('A character of proofValue was altered; the Ed25519 signature no longer verifies.');
  }

  return { format: 'ldp_vc', raw: signed, decoded: signed, tamperNotes };
}

async function mintSdJwtVc(
  options: MintOptions,
  typ: 'vc+sd-jwt' | 'dc+sd-jwt',
): Promise<MintedCredential> {
  const tamperNotes: string[] = [];
  const expired = options.tamper === 'expire-credential';
  const now = new Date();

  const issued = await issueSdJwt({
    typ,
    issuer: options.issuerKey.did,
    vct: options.tamper === 'wrong-type' ? `${VCT}#unrelated` : VCT,
    signingKey: options.issuerKey.joseKey,
    alg: 'EdDSA',
    kid: options.issuerKey.kid,
    selectiveClaims: options.claims,
    holderJwk: options.holderJwk,
    issuedAt: expired ? new Date(now.getTime() - 365 * 864e5) : now,
    expiresAt: expired ? new Date(now.getTime() - 864e5) : new Date(now.getTime() + 365 * 864e5),
  });

  if (expired) tamperNotes.push('`exp` backdated by one day.');
  if (options.tamper === 'wrong-type') tamperNotes.push('`vct` set to an unrelated type identifier.');

  let combined = issued.combined;
  if (options.tamper === 'break-signature') {
    const [header, payload, signature] = issued.issuerJwt.split('.');
    const broken = `${header}.${payload}.${corruptSignature(String(signature))}`;
    combined = combined.replace(issued.issuerJwt, broken);
    tamperNotes.push('A character of the issuer JWT signature was altered.');
  }

  return {
    format: typ,
    raw: combined,
    decoded: { header: { typ, alg: 'EdDSA', kid: options.issuerKey.kid }, payload: issued.payload, disclosures: issued.disclosures },
    tamperNotes,
  };
}

/**
 * Issues an ISO 18013-5 mdoc.
 *
 * The claim names are remapped onto the mDL namespace, because an mdoc's data
 * elements are drawn from a registered set rather than being free-form as in
 * JSON-LD or SD-JWT. Sending `fullName` where the standard says `given_name`
 * would produce a document no conformant reader would understand.
 */
async function mintMdoc(options: MintOptions): Promise<MintedCredential> {
  if (!options.holderJwk) {
    throw new Error(
      'mso_mdoc requires a holder key: the MobileSecurityObject binds a deviceKey, and there is no unbound form of the format.',
    );
  }

  const tamperNotes: string[] = [];
  const expired = options.tamper === 'expire-credential';
  const now = new Date();

  const issued = await issueMdoc({
    docType: options.tamper === 'wrong-type' ? 'org.example.unrelated.doc' : MDL_DOCTYPE,
    claims: toMdlElements(options.claims),
    signingKey: options.issuerKey.joseMdocKey,
    kid: options.issuerKey.mdocKid,
    deviceKeyJwk: options.holderJwk,
    signedAt: expired ? new Date(now.getTime() - 365 * 864e5) : now,
    validFrom: expired ? new Date(now.getTime() - 365 * 864e5) : now,
    validUntil: expired ? new Date(now.getTime() - 864e5) : new Date(now.getTime() + 365 * 864e5),
    corruptSignature: options.tamper === 'break-signature',
  });

  if (expired) tamperNotes.push('validUntil backdated by one day.');
  if (options.tamper === 'wrong-type') tamperNotes.push('docType set to an unrelated document type.');
  if (options.tamper === 'break-signature') tamperNotes.push('A byte of the issuerAuth COSE signature was flipped.');

  return { format: 'mso_mdoc', raw: issued.credential, decoded: issued.decoded, tamperNotes };
}

/** Maps the playground's claim names onto ISO 18013-5 mDL data elements. */
const MDL_ELEMENT_NAMES: Record<string, string> = {
  fullName: 'given_name',
  dateOfBirth: 'birth_date',
  gender: 'sex',
  nationality: 'nationality',
  idNumber: 'document_number',
};

function toMdlElements(claims: Record<string, unknown>): Record<string, unknown> {
  const elements: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(claims)) {
    elements[MDL_ELEMENT_NAMES[key] ?? key] = value;
  }
  return elements;
}

/**
 * Corrupts an encoded signature so that it genuinely fails to verify.
 *
 * A character in the middle is changed rather than the last one: in base64url
 * the final character often carries unused low-order bits, so altering it can
 * decode to the very same bytes and leave the signature perfectly valid — a
 * tamper test that silently tests nothing.
 */
function corruptSignature(value: string): string {
  if (value.length < 4) return value;
  const index = Math.floor(value.length / 2);
  const current = value[index] as string;
  const replacement = current === 'A' ? 'B' : 'A';
  return value.slice(0, index) + replacement + value.slice(index + 1);
}

export interface JsonLdVerifyResult {
  verified: boolean;
  expired: boolean;
  errors: string[];
}

/**
 * Verifies a JSON-LD credential's Data Integrity proof and validity window.
 *
 * Expiry is evaluated separately from the signature so the playground can
 * report "valid but expired" — a distinct outcome from a bad signature, and one
 * relying parties handle differently.
 */
export async function verifyJsonLdCredential(
  credential: Record<string, unknown>,
  documentLoader: DocumentLoader,
): Promise<JsonLdVerifyResult> {
  const errors: string[] = [];
  let verified = false;

  try {
    const result = await vc.verifyCredential({
      credential,
      suite: new Ed25519Signature2020(),
      documentLoader,
    });
    verified = result.verified;
    if (!result.verified) {
      const nested = result.error?.errors ?? [];
      const messages = nested.length > 0 ? nested.map((e) => e.message) : [result.error?.message ?? 'Proof verification failed'];
      errors.push(...messages);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const expiryValue = credential.expirationDate ?? credential.validUntil;
  const expired = typeof expiryValue === 'string' && new Date(expiryValue).getTime() < Date.now();

  return { verified, expired, errors };
}
