// The DigitalBazaar Verifiable Credential libraries are the reference
// implementations for Data Integrity proofs but ship no TypeScript types.
// Declared here with the shapes this codebase actually uses.

declare module '@digitalbazaar/vc' {
  export function issue(options: {
    credential: Record<string, unknown>;
    suite: unknown;
    documentLoader: unknown;
    purpose?: unknown;
  }): Promise<Record<string, unknown>>;

  export function signPresentation(options: {
    presentation: Record<string, unknown>;
    suite: unknown;
    documentLoader: unknown;
    challenge?: string;
    domain?: string;
    purpose?: unknown;
  }): Promise<Record<string, unknown>>;

  export function createPresentation(options: {
    verifiableCredential?: unknown;
    id?: string;
    holder?: string;
  }): Record<string, unknown>;

  export function verifyCredential(options: {
    credential: Record<string, unknown>;
    suite: unknown;
    documentLoader: unknown;
    purpose?: unknown;
    checkStatus?: unknown;
  }): Promise<{ verified: boolean; error?: { errors?: Error[]; message?: string }; results?: unknown }>;

  export function verify(options: {
    presentation: Record<string, unknown>;
    suite: unknown;
    documentLoader: unknown;
    challenge?: string;
    domain?: string;
    purpose?: unknown;
    unsignedPresentation?: boolean;
    checkStatus?: unknown;
    now?: Date | string;
  }): Promise<{ verified: boolean; error?: { errors?: Error[]; message?: string }; results?: unknown }>;
}

declare module '@digitalbazaar/ed25519-signature-2020' {
  export class Ed25519Signature2020 {
    constructor(options?: { key?: unknown; verificationMethod?: string; date?: string });
  }
}

declare module '@digitalbazaar/ed25519-verification-key-2020' {
  export class Ed25519VerificationKey2020 {
    id: string;
    controller: string;
    type: string;
    static generate(options?: { controller?: string; id?: string; seed?: Uint8Array }): Promise<Ed25519VerificationKey2020>;
    static from(key: Record<string, unknown>): Promise<Ed25519VerificationKey2020>;
    export(options: { publicKey?: boolean; privateKey?: boolean; includeContext?: boolean }): Promise<Record<string, unknown>>;
  }
}

declare module '@digitalbazaar/ed25519-multikey' {
  import type { JWK } from 'jose';
  export function from(key: Record<string, unknown>): Promise<Record<string, unknown>>;
  export function toJwk(options: { keyPair: unknown; secretKey?: boolean }): Promise<JWK>;
  export function fromJwk(options: { jwk: JWK; secretKey?: boolean; id?: string; controller?: string }): Promise<Record<string, unknown>>;
}

declare module '@digitalbazaar/security-document-loader' {
  export function securityLoader(options?: { fetchRemoteContexts?: boolean }): {
    addStatic(url: string, document: unknown): void;
    setProtocolHandler(options: { protocol: string; handler: { get(options: { url: string }): Promise<unknown> } }): void;
    build(): (url: string) => Promise<{ contextUrl?: string; document: unknown; documentUrl: string }>;
  };
}

// CommonJS: the API hangs off the default export, not named exports.
declare module 'jsonld-signatures' {
  interface JsonLdSignatures {
    purposes: {
      AssertionProofPurpose: new (options?: Record<string, unknown>) => unknown;
      AuthenticationProofPurpose: new (options?: Record<string, unknown>) => unknown;
    };
    sign(
      document: Record<string, unknown>,
      options: { suite: unknown; purpose: unknown; documentLoader: unknown },
    ): Promise<Record<string, unknown>>;
  }
  const jsigs: JsonLdSignatures;
  export default jsigs;
}

declare module '@digitalbazaar/ed25519-signature-2018' {
  export class Ed25519Signature2018 {
    constructor(options?: { key?: unknown; verificationMethod?: string; date?: string });
  }
}

declare module '@digitalbazaar/ed25519-verification-key-2018' {
  export class Ed25519VerificationKey2018 {
    id: string;
    controller: string;
    type: string;
    static generate(options?: { controller?: string; id?: string }): Promise<Ed25519VerificationKey2018>;
    static from(key: Record<string, unknown>): Promise<Ed25519VerificationKey2018>;
    export(options: { publicKey?: boolean; privateKey?: boolean; includeContext?: boolean }): Record<string, unknown>;
  }
}

declare module '@digitalbazaar/jws-linked-data-signature' {
  export class JwsLinkedDataSignature {
    constructor(options: {
      type: string;
      alg: string;
      LDKeyClass?: unknown;
      key?: unknown;
      signer?: { sign(options: { data: Uint8Array }): Promise<Uint8Array>; id?: string };
      verifier?: { verify(options: { data: Uint8Array; signature: Uint8Array }): Promise<boolean> };
      proof?: unknown;
      date?: string;
      contextUrl: string;
    });
    type: string;
    alg: string;
    verificationMethod?: string;
    ensureSuiteContext(options: { document: Record<string, unknown>; addSuiteContext: boolean }): void;
    assertVerificationMethod(options: { verificationMethod: Record<string, unknown> }): Promise<void>;
  }
}
