import type {
  AuthorizationRequest,
  CredentialFormat,
  CredentialIssuerMetadata,
  CredentialOffer,
  Participant,
  ProofType,
  WalletProofType,
} from '@interop/shared';
import type { RunContext } from '../core/context.js';

/** Resolved issuer endpoints after metadata discovery. */
export interface IssuerEndpoints {
  credentialIssuer: string;
  credentialEndpoint: string;
  tokenEndpoint: string;
  /** Present when the issuer supports the authorization code grant. */
  authorizationEndpoint?: string;
  nonceEndpoint?: string;
  jwksUri?: string;
  didDocumentUrl?: string;
  metadata: CredentialIssuerMetadata;
  /** The configuration id chosen for the requested format. */
  configurationId: string;
}

export interface OfferResult {
  /** The `openid-credential-offer://` URI a wallet consumes. */
  offerUri: string;
  offer: CredentialOffer;
  preAuthorizedCode?: string;
  txCode?: string;
}

/** A credential in the wallet's possession, in whatever encoding it arrived. */
export interface HeldCredential {
  format: CredentialFormat;
  /** Encoded form: a compact SD-JWT string, base64url CBOR, or JSON-LD object. */
  raw: unknown;
  /** Parsed JSON view, for formats that have one. */
  decoded?: Record<string, unknown>;
  /** Identifier of the key the holder must prove control of, when bound. */
  holderKeyId?: string;
}

/** A verifier's authorization request, plus everything needed to answer it. */
export interface PresentationRequest {
  authorizationRequest: AuthorizationRequest;
  /** The `openid4vp://` URI encoding the request, for QR / deep link. */
  requestUri: string;
  /** Verifier-side correlation ids, used to poll for the result. */
  transactionId: string;
  requestId?: string;
  nonce: string;
  state: string;
  responseUri: string;
}

export type Verdict = 'valid' | 'invalid' | 'valid-but-expired' | 'error';

export interface VerificationOutcome {
  verdict: Verdict;
  /** Verifier's own result payload, shown verbatim in the inspector. */
  raw: unknown;
  /** Per-credential breakdown when the verifier provides one. */
  credentialResults?: Array<{ status: string; detail?: string; claims?: Record<string, unknown> }>;
  message?: string;
}

export interface IssueOptions {
  format: CredentialFormat;
  proofType: ProofType;
  claims: Record<string, unknown>;
}

export interface PresentOptions {
  format: CredentialFormat;
  walletProofType: WalletProofType;
}

/**
 * Optional across all three roles: a participant that can report which build it
 * is. Implemented where the service exposes something; absent where it does not,
 * which is itself worth recording.
 */
export interface VersionAware {
  discoverVersion?(ctx: RunContext): Promise<{ value?: string; detail: string }>;
}

export interface IssuerAdapter extends VersionAware {
  manifest: Participant;
  /** Fetch and normalise `.well-known` metadata; also runs discovery checks. */
  discover(ctx: RunContext, opts: IssueOptions): Promise<IssuerEndpoints>;
  /** Produce a credential offer the chosen wallet can act on. */
  createOffer(ctx: RunContext, endpoints: IssuerEndpoints, opts: IssueOptions): Promise<OfferResult>;
}

export interface WalletAdapter extends VersionAware {
  manifest: Participant;
  /** Walk the OpenID4VCI flow to obtain the credential described by the offer. */
  acceptOffer(
    ctx: RunContext,
    offer: OfferResult,
    endpoints: IssuerEndpoints,
    opts: IssueOptions,
  ): Promise<HeldCredential>;
  /** Answer an OpenID4VP authorization request with a vp_token. */
  present(
    ctx: RunContext,
    request: PresentationRequest,
    held: HeldCredential,
    opts: PresentOptions,
  ): Promise<void>;
}

export interface VerifierAdapter extends VersionAware {
  manifest: Participant;
  /** Create an authorization request for the given format. */
  createRequest(ctx: RunContext, opts: PresentOptions): Promise<PresentationRequest>;
  /** Wait for the wallet's submission and return the verifier's verdict. */
  awaitResult(ctx: RunContext, request: PresentationRequest): Promise<VerificationOutcome>;
  /**
   * Optionally verify the credential on its own, outside any presentation.
   *
   * Run straight after issuance, before OpenID4VP is involved at all. It
   * separates two questions a single end-to-end result conflates: whether the
   * verifier can read this credential, and whether the presentation exchange
   * works. When a run fails, knowing which of the two broke is most of the
   * diagnosis.
   */
  verifyCredentialDirectly?(ctx: RunContext, held: HeldCredential): Promise<void>;
}
