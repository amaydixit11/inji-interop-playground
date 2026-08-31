import * as Ed25519Multikey from '@digitalbazaar/ed25519-multikey';
import { importJWK, type JWK, type KeyLike } from 'jose';
import type { DocumentLoader } from './jsonld.js';
import { findVerificationMethod } from './jsonld.js';

/**
 * Resolves a signing key referenced by a JWT `kid` or a credential `iss`.
 *
 * Both DID verification-method shapes in circulation are handled: the JWK form
 * that JOSE-based implementations publish, and the multibase form that Data
 * Integrity implementations publish. An issuer that publishes only one of them
 * still interoperates with a verifier expecting the other, which is a gap worth
 * absorbing here rather than failing the run over.
 */
export async function resolveVerificationKey(
  reference: string,
  documentLoader: DocumentLoader,
  alg?: string,
): Promise<{ key: KeyLike; jwk: JWK; verificationMethod: unknown }> {
  const { document } = await documentLoader(reference);
  const method = extractMethod(document, reference);
  const jwk = await toJwk(method);
  if (!jwk) {
    throw new Error(`Verification method ${reference} exposes no usable public key`);
  }
  const key = (await importJWK(jwk, alg ?? jwk.alg ?? inferAlg(jwk))) as KeyLike;
  return { key, jwk, verificationMethod: method };
}

function extractMethod(document: unknown, reference: string): Record<string, unknown> {
  if (!document || typeof document !== 'object') {
    throw new Error(`Could not resolve ${reference}`);
  }
  const doc = document as Record<string, unknown>;

  // A bare DID resolves to a DID document; pick its first assertion method.
  if (doc.id && Array.isArray(doc.verificationMethod) && !reference.includes('#')) {
    const assertion = Array.isArray(doc.assertionMethod) ? doc.assertionMethod[0] : undefined;
    if (typeof assertion === 'string') {
      const found = findVerificationMethod(doc, assertion);
      if (found) return found as Record<string, unknown>;
    }
    return doc.verificationMethod[0] as Record<string, unknown>;
  }
  return doc;
}

async function toJwk(method: Record<string, unknown>): Promise<JWK | undefined> {
  if (method.publicKeyJwk) return method.publicKeyJwk as JWK;
  if (method.publicKeyMultibase) {
    const multikey = await Ed25519Multikey.from({
      '@context': 'https://w3id.org/security/multikey/v1',
      type: 'Multikey',
      publicKeyMultibase: method.publicKeyMultibase as string,
    });
    return { ...(await Ed25519Multikey.toJwk({ keyPair: multikey })), alg: 'EdDSA' };
  }
  return undefined;
}

function inferAlg(jwk: JWK): string {
  if (jwk.kty === 'OKP') return 'EdDSA';
  if (jwk.kty === 'EC' && jwk.crv === 'P-256') return 'ES256';
  if (jwk.kty === 'RSA') return 'RS256';
  throw new Error(`Cannot infer a signing algorithm for key type ${String(jwk.kty)}`);
}
