import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Ed25519VerificationKey2020 } from '@digitalbazaar/ed25519-verification-key-2020';
import * as Ed25519Multikey from '@digitalbazaar/ed25519-multikey';
import { exportJWK, generateKeyPair, importJWK, type JWK, type KeyLike } from 'jose';

/**
 * Long-lived key material for the playground's own issuer and wallet.
 *
 * Keys are persisted so that a credential issued in one session still verifies
 * in the next and the published DID document stays stable — a verifier that
 * cached our DID must not start failing across a restart.
 */

const KEY_DIR = resolve(process.cwd(), '.keys');

async function readJson<T>(name: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(resolve(KEY_DIR, `${name}.json`), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  const path = resolve(KEY_DIR, `${name}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

/**
 * `did:web` derived from the URL the playground is reachable at.
 *
 * did:web rather than did:key because it is the method the Inji modules resolve
 * today; a did:key issuer would fail against them for reasons that have nothing
 * to do with the credential under test.
 */
export function didWebFor(publicUrl: string, path?: string): string {
  const url = new URL(publicUrl);
  const host = url.port ? `${url.hostname}%3A${url.port}` : url.hostname;
  const segments = [...url.pathname.split('/'), ...(path ?? '').split('/')].filter(Boolean);
  return ['did:web', host, ...segments].join(':');
}

/** The HTTPS URL a `did:web` DID document must be served from. */
export function didWebUrl(did: string): string {
  const [, , encodedHost, ...segments] = did.split(':');
  const host = decodeURIComponent(encodedHost ?? '');
  return segments.length > 0
    ? `https://${host}/${segments.join('/')}/did.json`
    : `https://${host}/.well-known/did.json`;
}

/**
 * The issuer's Ed25519 key, usable both as a Data Integrity suite key and as a
 * JOSE key, so one published DID document covers JSON-LD and SD-JWT issuance.
 */
export interface IssuerKey {
  did: string;
  kid: string;
  /** Suite key for `Ed25519Signature2020` proofs. */
  suiteKey: Ed25519VerificationKey2020;
  /** Same key as JOSE, for signing SD-JWTs with EdDSA. */
  joseKey: KeyLike;
  publicJwk: JWK;
  /** Verification method document served at `kid`. */
  verificationMethod: Record<string, unknown>;
  didDocument: Record<string, unknown>;
  /**
   * ES256 key used to sign mdoc issuer authentication.
   *
   * A separate key because the ISO 18013-5 COSE profile is built around ECDSA
   * on P-256; an Ed25519 key cannot be used where the specification and the
   * readers that implement it expect ES256.
   */
  joseMdocKey: KeyLike;
  mdocKid: string;
  mdocPublicJwk: JWK;
}

/**
 * The wallet's holder key material.
 *
 * Two keys, because the two protocols demand different things: OpenID4VCI proofs
 * and SD-JWT key binding are JOSE signatures (ES256), while signing a JSON-LD
 * Verifiable Presentation needs an Ed25519 Data Integrity suite key. Real
 * wallets hold several keys for the same reason.
 */
export interface WalletKey {
  did: string;
  /** ES256 key id, used for `openid4vci-proof+jwt` and `kb+jwt`. */
  kid: string;
  privateKey: KeyLike;
  publicJwk: JWK;
  alg: 'ES256';
  /** Ed25519 key id, used for `Ed25519Signature2020` presentation proofs. */
  suiteKid: string;
  suiteKey: Ed25519VerificationKey2020;
  suiteVerificationMethod: Record<string, unknown>;
  didDocument: Record<string, unknown>;
}

let issuerKeyPromise: Promise<IssuerKey> | undefined;
let walletKeyPromise: Promise<WalletKey> | undefined;

export function getIssuerKey(publicUrl: string): Promise<IssuerKey> {
  issuerKeyPromise ??= buildIssuerKey(publicUrl);
  return issuerKeyPromise;
}

export function getWalletKey(publicUrl: string): Promise<WalletKey> {
  walletKeyPromise ??= buildWalletKey(publicUrl);
  return walletKeyPromise;
}

async function buildIssuerKey(publicUrl: string): Promise<IssuerKey> {
  const did = didWebFor(publicUrl, 'issuer');
  const kid = `${did}#key-1`;

  let exported = await readJson<Record<string, unknown>>('mock-issuer');
  if (!exported) {
    const generated = await Ed25519VerificationKey2020.generate({ controller: did, id: kid });
    exported = await generated.export({ publicKey: true, privateKey: true, includeContext: true });
    await writeJson('mock-issuer', exported);
  }

  // The DID is derived from the public URL, which can change between runs
  // (localhost vs an ngrok tunnel), so re-stamp the identifiers on load rather
  // than trusting the ones baked in at generation time.
  const suiteKey = await Ed25519VerificationKey2020.from({ ...exported, id: kid, controller: did });

  const multikey = await Ed25519Multikey.from(
    await suiteKey.export({ publicKey: true, privateKey: true, includeContext: true }),
  );
  const privateJwk = await Ed25519Multikey.toJwk({ keyPair: multikey, secretKey: true });
  const publicJwk = await Ed25519Multikey.toJwk({ keyPair: multikey });
  const joseKey = (await importJWK({ ...privateJwk, d: ed25519SeedFromJwkD(privateJwk.d), alg: 'EdDSA' }, 'EdDSA')) as KeyLike;

  const verificationMethod = (await suiteKey.export({
    publicKey: true,
    includeContext: true,
  })) as Record<string, unknown>;

  const mdocKid = `${did}#mdoc-1`;
  let mdocStored = await readJson<{ privateJwk: JWK; publicJwk: JWK }>('mock-issuer-mdoc');
  if (!mdocStored) {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    mdocStored = { privateJwk: await exportJWK(privateKey), publicJwk: await exportJWK(publicKey) };
    await writeJson('mock-issuer-mdoc', mdocStored);
  }
  const joseMdocKey = (await importJWK(mdocStored.privateJwk, 'ES256')) as KeyLike;
  const mdocPublicJwk: JWK = { ...mdocStored.publicJwk, alg: 'ES256' };

  const didDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
      'https://w3id.org/security/suites/jws-2020/v1',
    ],
    id: did,
    verificationMethod: [
      verificationMethod,
      // Published alongside the multibase form because SD-JWT verifiers look
      // for a JWK, while Data Integrity verifiers look for publicKeyMultibase.
      { id: `${did}#jwk-1`, type: 'JsonWebKey2020', controller: did, publicKeyJwk: { ...publicJwk, alg: 'EdDSA' } },
      { id: mdocKid, type: 'JsonWebKey2020', controller: did, publicKeyJwk: mdocPublicJwk },
    ],
    assertionMethod: [kid, `${did}#jwk-1`, mdocKid],
    authentication: [kid, `${did}#jwk-1`, mdocKid],
  };

  return {
    did,
    kid,
    suiteKey,
    joseKey,
    publicJwk: { ...publicJwk, kid, alg: 'EdDSA' },
    verificationMethod,
    didDocument,
    joseMdocKey,
    mdocKid,
    mdocPublicJwk,
  };
}

async function buildWalletKey(publicUrl: string): Promise<WalletKey> {
  const did = didWebFor(publicUrl, 'wallet');
  const kid = `${did}#holder-1`;
  const suiteKid = `${did}#holder-ed25519`;

  let stored = await readJson<{ privateJwk: JWK; publicJwk: JWK }>('mock-wallet');
  if (!stored) {
    // ES256 rather than EdDSA: `proof_types_supported` across this ecosystem
    // consistently lists ES256, and some issuers accept nothing else.
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    stored = { privateJwk: await exportJWK(privateKey), publicJwk: await exportJWK(publicKey) };
    await writeJson('mock-wallet', stored);
  }

  let suiteExport = await readJson<Record<string, unknown>>('mock-wallet-ed25519');
  if (!suiteExport) {
    const generated = await Ed25519VerificationKey2020.generate({ controller: did, id: suiteKid });
    suiteExport = await generated.export({ publicKey: true, privateKey: true, includeContext: true });
    await writeJson('mock-wallet-ed25519', suiteExport);
  }
  const suiteKey = await Ed25519VerificationKey2020.from({ ...suiteExport, id: suiteKid, controller: did });
  const suiteVerificationMethod = (await suiteKey.export({
    publicKey: true,
    includeContext: true,
  })) as Record<string, unknown>;

  const privateKey = (await importJWK(stored.privateJwk, 'ES256')) as KeyLike;
  const publicJwk: JWK = { ...stored.publicJwk, alg: 'ES256' };

  const didDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
      'https://w3id.org/security/suites/jws-2020/v1',
    ],
    id: did,
    verificationMethod: [
      { id: kid, type: 'JsonWebKey2020', controller: did, publicKeyJwk: publicJwk },
      suiteVerificationMethod,
    ],
    authentication: [kid, suiteKid],
    assertionMethod: [kid, suiteKid],
  };

  return { did, kid, privateKey, publicJwk, alg: 'ES256', suiteKid, suiteKey, suiteVerificationMethod, didDocument };
}

/**
 * Narrows an Ed25519 private key to the 32-byte seed a JWK requires.
 *
 * `@digitalbazaar/ed25519-multikey` emits the 64-byte libsodium form
 * (seed followed by public key) as JWK `d`. RFC 8037 defines `d` as the seed
 * alone, and Node rejects the longer value outright, so trim it here.
 */
function ed25519SeedFromJwkD(d: string | undefined): string | undefined {
  if (!d) return d;
  const bytes = Buffer.from(d, 'base64url');
  return bytes.length > 32 ? bytes.subarray(0, 32).toString('base64url') : d;
}
