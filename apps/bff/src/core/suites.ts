import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify, type KeyObject } from 'node:crypto';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import { Ed25519Signature2018 } from '@digitalbazaar/ed25519-signature-2018';
import { JwsLinkedDataSignature } from '@digitalbazaar/jws-linked-data-signature';
import type { ProofType } from '@interop/shared';
import type { IssuerKey } from './keys.js';

/**
 * The Data Integrity proof suites the playground can produce and verify.
 *
 * Three rather than one because the Inji stack advertises exactly these three —
 * `Ed25519Signature2020`, `Ed25519Signature2018` and `RsaSignature2018` — and a
 * playground that only ever emits the first cannot tell you whether the other
 * two work. Which suite a credential carries is the single most common reason a
 * verifier rejects an otherwise valid credential.
 */

export const RSA_SUITE_CONTEXT = 'https://w3id.org/security/v2';

/**
 * `RsaSignature2018`, implemented here because no maintained package provides
 * it any more.
 *
 * It is the same construction as `Ed25519Signature2018` — a detached JWS over
 * the canonicalised document — differing only in the algorithm, so it is built
 * on the same base class rather than reimplemented. Signing and verification
 * are delegated to Node's RSASSA-PKCS1-v1_5 with SHA-256, which is what RS256
 * denotes.
 */
export class RsaSignature2018 extends JwsLinkedDataSignature {
  constructor(options: { key?: RsaKeyPair; verificationMethod?: string; date?: string } = {}) {
    super({
      type: 'RsaSignature2018',
      alg: 'RS256',
      contextUrl: RSA_SUITE_CONTEXT,
      LDKeyClass: RsaVerificationKey2018,
      signer: options.key?.signer(),
      verifier: undefined,
      date: options.date,
    });
    // Recorded on the proof so a verifier knows which key to resolve.
    this.verificationMethod = options.verificationMethod ?? options.key?.id;
  }

  /**
   * Checks that a resolved verification method can actually be used.
   *
   * The base class calls this but does not define it; each suite states its own
   * requirements. Failing here with a specific message beats failing later
   * inside the verifier with a generic one.
   */
  async assertVerificationMethod({
    verificationMethod,
  }: {
    verificationMethod: Record<string, unknown>;
  }): Promise<void> {
    const type = String(verificationMethod.type ?? '');
    if (type !== 'RsaVerificationKey2018') {
      throw new Error(
        `Verification method ${String(verificationMethod.id)} is a ${type || 'key of unknown type'}, but RsaSignature2018 requires an RsaVerificationKey2018.`,
      );
    }
    if (typeof verificationMethod.publicKeyPem !== 'string') {
      throw new Error(`Verification method ${String(verificationMethod.id)} carries no publicKeyPem.`);
    }
  }

  /**
   * Adds the suite context only when the document does not already define the
   * proof terms.
   *
   * The base class unconditionally appends `contextUrl`, which breaks a VC 1.1
   * credential: `https://www.w3.org/2018/credentials/v1` already defines
   * `RsaSignature2018` as a protected term, and layering `security/v2` on top
   * redefines it. Signing then fails outright rather than degrading.
   */
  ensureSuiteContext({ document, addSuiteContext }: { document: Record<string, unknown>; addSuiteContext: boolean }): void {
    const contexts = Array.isArray(document['@context'])
      ? (document['@context'] as unknown[])
      : [document['@context']];

    const alreadyDefined = contexts.some(
      (entry) =>
        entry === 'https://www.w3.org/2018/credentials/v1' ||
        entry === 'https://www.w3.org/ns/credentials/v2' ||
        entry === RSA_SUITE_CONTEXT,
    );
    if (alreadyDefined) return;

    if (!addSuiteContext) {
      throw new TypeError(`The document to be signed must contain this suite's @context, "${RSA_SUITE_CONTEXT}".`);
    }
    document['@context'] = [...contexts.filter(Boolean), RSA_SUITE_CONTEXT];
  }
}

/**
 * Minimal `RsaVerificationKey2018`.
 *
 * Only what the suite needs: import a verification method carrying a
 * `publicKeyPem` and expose a verifier over it.
 */
export class RsaVerificationKey2018 {
  constructor(
    readonly id: string,
    private readonly publicKey: KeyObject,
  ) {}

  static async from(verificationMethod: Record<string, unknown>): Promise<RsaVerificationKey2018> {
    const pem = verificationMethod.publicKeyPem;
    if (typeof pem !== 'string') {
      throw new Error(
        `Verification method ${String(verificationMethod.id)} carries no publicKeyPem, which RsaSignature2018 requires.`,
      );
    }
    return new RsaVerificationKey2018(String(verificationMethod.id ?? ''), createPublicKey(pem));
  }

  verifier(): { verify(options: { data: Uint8Array; signature: Uint8Array }): Promise<boolean> } {
    const publicKey = this.publicKey;
    return {
      async verify({ data, signature }) {
        try {
          return nodeVerify('sha256', data, publicKey, signature);
        } catch {
          return false;
        }
      },
    };
  }
}

/** An RSA key pair in the shape the suite expects. */
export class RsaKeyPair {
  constructor(
    readonly id: string,
    readonly controller: string,
    private readonly privateKey: KeyObject,
    readonly publicKeyPem: string,
  ) {}

  static fromPem(id: string, controller: string, privatePem: string): RsaKeyPair {
    const privateKey = createPrivateKey(privatePem);
    const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
    return new RsaKeyPair(id, controller, privateKey, publicKeyPem);
  }

  signer(): { sign(options: { data: Uint8Array }): Promise<Uint8Array>; id: string } {
    const privateKey = this.privateKey;
    const id = this.id;
    return {
      id,
      async sign({ data }) {
        return nodeSign('sha256', data, privateKey);
      },
    };
  }

  /** Verification method document published in the issuer's DID document. */
  verificationMethod(): Record<string, unknown> {
    return {
      '@context': RSA_SUITE_CONTEXT,
      id: this.id,
      type: 'RsaVerificationKey2018',
      controller: this.controller,
      publicKeyPem: this.publicKeyPem,
    };
  }
}

/**
 * Extra JSON-LD context a credential needs for a given suite, if any.
 *
 * Only the 2020 suite needs one. `https://www.w3.org/2018/credentials/v1`
 * already defines `Ed25519Signature2018` and `RsaSignature2018` as protected
 * terms, so adding their suite contexts on top is not merely redundant — it is
 * an error, and JSON-LD rejects the document for redefining a protected term.
 */
export const SUITE_CONTEXTS: Record<string, string | undefined> = {
  Ed25519Signature2020: 'https://w3id.org/security/suites/ed25519-2020/v1',
  Ed25519Signature2018: undefined,
  RsaSignature2018: undefined,
};

/** Builds the signing suite for a requested proof type. */
export function createIssuanceSuite(proofType: ProofType, issuerKey: IssuerKey): unknown {
  switch (proofType) {
    case 'Ed25519Signature2018':
      return new Ed25519Signature2018({ key: issuerKey.suiteKey2018 });
    case 'RsaSignature2018':
      return new RsaSignature2018({ key: issuerKey.rsaKey });
    case 'Ed25519Signature2020':
    case 'DataIntegrityProof':
    default:
      return new Ed25519Signature2020({ key: issuerKey.suiteKey });
  }
}

/**
 * Verification suites, offered together.
 *
 * A verifier does not get to choose what arrives; it has to recognise whatever
 * the issuer used, and offering only one suite would reject a valid credential
 * for the wrong reason.
 */
export function verificationSuites(): unknown[] {
  return [new Ed25519Signature2020(), new Ed25519Signature2018(), new RsaSignature2018()];
}

/** Proof types this playground can actually produce. */
export const SUPPORTED_PROOF_TYPES: ProofType[] = [
  'Ed25519Signature2020',
  'Ed25519Signature2018',
  'RsaSignature2018',
];
