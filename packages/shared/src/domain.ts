/**
 * Core domain model for the Inji Interoperability Playground.
 *
 * A *run* is one end-to-end interoperability test: a chosen issuer, wallet and
 * verifier are wired together, a credential is issued, held, presented and
 * verified, and every protocol exchange along the way is captured.
 */

export type Role = 'issuer' | 'wallet' | 'verifier';

/**
 * Credential formats, named with the identifiers the protocols actually put on
 * the wire (OpenID4VCI `format`, OpenID4VP `vp_formats`) rather than friendly
 * names, so payloads in the inspector line up with what we asked for.
 */
export type CredentialFormat = 'ldp_vc' | 'vc+sd-jwt' | 'dc+sd-jwt' | 'mso_mdoc';

export const CREDENTIAL_FORMAT_LABELS: Record<CredentialFormat, string> = {
  ldp_vc: 'W3C VC (JSON-LD, Data Integrity proof)',
  'vc+sd-jwt': 'IETF SD-JWT VC (draft type, vc+sd-jwt)',
  'dc+sd-jwt': 'IETF SD-JWT VC (registered type, dc+sd-jwt)',
  mso_mdoc: 'ISO/IEC 18013-5 mDoc / mDL',
};

/**
 * How each format is described to someone who is not implementing it.
 *
 * The technical labels name the specification, which is what a developer needs
 * and exactly what a non-specialist does not: "vc+sd-jwt" says nothing about
 * what the thing can do.
 */
export const CREDENTIAL_FORMAT_PLAIN: Record<CredentialFormat, string> = {
  ldp_vc: 'a standard W3C digital credential, the format most government wallets use',
  'vc+sd-jwt': 'a compact credential that lets the holder reveal individual details separately',
  'dc+sd-jwt': 'a compact credential that lets the holder reveal individual details separately',
  mso_mdoc: 'a mobile driving licence, in the ISO format used by physical-ID schemes',
};

/** Proof / signature suite used on the issued credential. */
export type ProofType =
  | 'Ed25519Signature2018'
  | 'Ed25519Signature2020'
  | 'RsaSignature2018'
  | 'DataIntegrityProof'
  | 'ES256'
  | 'EdDSA'
  | 'RS256';

/** Data Integrity suites the playground can issue and verify. */
export const ISSUABLE_PROOF_TYPES = [
  'Ed25519Signature2020',
  'Ed25519Signature2018',
  'RsaSignature2018',
] as const satisfies readonly ProofType[];

export const PROOF_TYPE_LABELS: Partial<Record<ProofType, string>> = {
  Ed25519Signature2020: 'Ed25519Signature2020 (multibase proofValue)',
  Ed25519Signature2018: 'Ed25519Signature2018 (detached JWS)',
  RsaSignature2018: 'RsaSignature2018 (detached JWS, RS256)',
};

/**
 * Which revision of the W3C Verifiable Credentials data model to issue.
 *
 * Not a cosmetic change: `issuanceDate` and `expirationDate` become `validFrom`
 * and `validUntil`, and the context defines a different term set. A verifier
 * written for one and handed the other usually reads the validity period as
 * absent rather than failing loudly, which is the quiet kind of incompatibility
 * worth having a dimension for.
 */
export type VcVersion = '1.1' | '2.0';

export const VC_VERSION_LABELS: Record<VcVersion, string> = {
  '1.1': 'W3C VC 1.1 (issuanceDate / expirationDate)',
  '2.0': 'W3C VC 2.0 (validFrom / validUntil)',
};

/**
 * How an SD-JWT issuer tells a verifier which key signed the credential.
 *
 * `did` puts a `kid` in the header and expects the verifier to resolve it;
 * `x5c` embeds a certificate chain so nothing has to be resolved. Both are
 * permitted by SD-JWT VC, and a verifier that supports only one cannot read
 * credentials from an issuer that uses the other — which is exactly the kind of
 * incompatibility worth being able to select between.
 */
export type IssuerKeyReference = 'did' | 'x5c';

export const ISSUER_KEY_REFERENCE_LABELS: Record<IssuerKeyReference, string> = {
  did: 'kid — verifier resolves the issuer DID',
  x5c: 'x5c — certificate chain embedded in the credential',
};

/** Key-binding proof the wallet sends to the credential endpoint. */
export type WalletProofType = 'jwt' | 'cwt' | 'none';

/**
 * Which spec revision a participant speaks. Recorded per run because the single
 * most common source of real interop failure in this ecosystem is two sides
 * implementing different drafts of the same protocol.
 */
export type SpecVersion =
  | 'openid4vci-draft-11'
  | 'openid4vci-draft-12'
  | 'openid4vci-draft-13'
  | 'openid4vci-1.0'
  | 'openid4vp-draft-21'
  | 'openid4vp-draft-23'
  | 'openid4vp-1.0';

/**
 * The OpenID4VCI revision a run speaks on the wire.
 *
 * Kept as an explicit dimension of a run rather than inferred, because the
 * revisions differ in ways that silently break a client that assumes the wrong
 * one — where the credential sits in the response, whether `format` is echoed,
 * and where the nonce for the holder proof comes from. Being able to select it
 * is what turns "our wallet works against our issuer" into a statement about
 * which revisions actually interoperate.
 */
export type VciDraft = 'draft-11' | 'draft-12' | 'draft-13' | '1.0';

export const VCI_DRAFT_LABELS: Record<VciDraft, string> = {
  'draft-11': 'OpenID4VCI draft 11 (/vd11/credential)',
  'draft-12': 'OpenID4VCI draft 12 (/vd12/credential)',
  'draft-13': 'OpenID4VCI draft 13 (/credential)',
  '1.0': 'OpenID4VCI 1.0 final (/credential, credentials[])',
};

/**
 * How much of a participant's traffic the playground can actually observe.
 *
 * This distinction is deliberately part of the domain model and surfaced in the
 * UI: when a real mobile wallet scans a QR code, the wallet <-> issuer exchange
 * happens on the phone and the orchestrator never sees it. Reporting such a run
 * with the same confidence as a fully-traced one would be dishonest.
 */
export type Traceability =
  /** The orchestrator performs the exchanges itself; every payload is captured. */
  | 'full'
  /** Exchanges happen off-box; we observe only what the endpoints report. */
  | 'endpoint-only';

/** Where an implementation comes from — drives the "is this real interop?" claim. */
export type ParticipantKind =
  /** A real Inji module (Certify, Mimoto/Wallet, Verify). */
  | 'inji'
  /** A spec-compliant implementation written for this playground. */
  | 'mock'
  /** A third-party implementation outside the MOSIP ecosystem. */
  | 'external';

/** A single selectable implementation for one of the three roles. */
export interface Participant {
  id: string;
  role: Role;
  label: string;
  kind: ParticipantKind;
  /** One-line description shown under the card in the selector. */
  summary: string;
  traceability: Traceability;
  /** Formats this participant can handle in this role. */
  formats: CredentialFormat[];
  /** Protocol revisions this participant implements. */
  specs: SpecVersion[];
  /** Whether the run can proceed without human interaction (QR scanning etc). */
  interactive: boolean;
  /** Configurable fields (base URLs, client ids) with their current values. */
  config: ParticipantConfigField[];
  /** Set when the participant cannot currently be used, with the reason why. */
  unavailable?: string;
  /**
   * Structural limits on what this participant can be paired with.
   *
   * Surfaced before a run rather than discovered during one: some
   * implementations only work with counterparties they were configured for in
   * advance, and finding that out from a failed run wastes everyone's time.
   */
  constraints?: string[];
}

export interface ParticipantConfigField {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  /** Marks fields that must be reachable for the participant to work. */
  required: boolean;
  secret?: boolean;
}

/**
 * How the wallet and verifier reach each other.
 *
 * Cross-device is the QR case: the verifier shows a code, a separate device
 * scans it, and the verifier learns the outcome by polling. Same-device is a
 * redirect on one device, where the wallet hands control back through a
 * `redirect_uri` carrying a one-time response code. They fail differently —
 * cross-device is bounded by QR capacity, same-device by redirect handling and
 * response-code replay — so which one is under test has to be explicit.
 */
export type FlowMode = 'cross-device' | 'same-device';

export const FLOW_MODE_LABELS: Record<FlowMode, string> = {
  'cross-device': 'Cross-device (QR, verifier polls for the result)',
  'same-device': 'Same-device (redirect back with a one-time response code)',
};

/**
 * Which OpenID4VCI grant the wallet uses to obtain the credential.
 *
 * Every run so far used the pre-authorized code, because it is the only grant
 * that needs no human — which is what makes unattended testing possible, and
 * also means the flow most real deployments actually use went untested. The
 * authorization code grant adds an authorization request, a redirect, a user
 * consent step and PKCE, each of which is a place for two implementations to
 * disagree.
 */
export type GrantType = 'pre-authorized_code' | 'authorization_code';

export const GRANT_TYPE_LABELS: Record<GrantType, string> = {
  'pre-authorized_code': 'Pre-authorized code (no login)',
  authorization_code: 'Authorization code with PKCE (consent step)',
};

/**
 * How a verifier states what it wants.
 *
 * OpenID4VP 1.0 replaces Presentation Exchange with DCQL, and the two are not
 * interchangeable: DCQL addresses claims by path segments rather than JSONPath,
 * describes credential types per format rather than through generic filters,
 * and — most consequentially — makes `vp_token` a map keyed by query id instead
 * of a single value. A wallet or verifier built for one does not understand the
 * other, which is why this is a dimension rather than an implementation detail.
 */
export type QueryLanguage = 'presentation-exchange' | 'dcql';

export const QUERY_LANGUAGE_LABELS: Record<QueryLanguage, string> = {
  'presentation-exchange': 'Presentation Exchange (presentation_definition)',
  dcql: 'DCQL (dcql_query, OpenID4VP 1.0)',
};

/** Deliberate corruption applied to a run to exercise negative paths. */
export type TamperMode =
  | 'none'
  /** Flip a byte in the credential signature — verification must fail. */
  | 'break-signature'
  /** Backdate `expirationDate` / `exp` — verification must report expired. */
  | 'expire-credential'
  /** Present a credential whose type does not satisfy the request. */
  | 'wrong-type'
  /** Echo a nonce that does not match the one the verifier issued. */
  | 'replay-nonce'
  /** Strip the holder binding proof from the presentation. */
  | 'strip-holder-proof'
  /** Revoke the credential after issuing it, via the issuer's status list. */
  | 'revoke-credential'
  /** Redeem the same-device response code a second time. */
  | 'replay-response-code';

export const TAMPER_MODE_LABELS: Record<TamperMode, string> = {
  none: 'No tampering (happy path)',
  'break-signature': 'Corrupt credential signature',
  'expire-credential': 'Issue an already-expired credential',
  'wrong-type': 'Present a credential of the wrong type',
  'replay-nonce': 'Replay a stale nonce',
  'strip-holder-proof': 'Strip the holder binding proof',
  'revoke-credential': 'Revoke the credential after issuing it',
  'replay-response-code': 'Redeem the same-device response code twice',
};

/** Everything needed to start a run. */
export interface RunConfig {
  issuerId: string;
  walletId: string;
  verifierId: string;
  format: CredentialFormat;
  proofType: ProofType;
  walletProofType: WalletProofType;
  /** OpenID4VCI revision to speak; defaults to draft 13. */
  vciDraft?: VciDraft;
  /** How the wallet returns the presentation; defaults to cross-device. */
  flowMode?: FlowMode;
  /** W3C data model revision for JSON-LD credentials; defaults to 1.1. */
  vcVersion?: VcVersion;
  /** How an SD-JWT names its issuer key; defaults to the DID. */
  issuerKeyReference?: IssuerKeyReference;
  /** How the verifier states its request; defaults to Presentation Exchange. */
  queryLanguage?: QueryLanguage;
  /** Which OpenID4VCI grant to use; defaults to the pre-authorized code. */
  grantType?: GrantType;
  /**
   * Stop after this phase and treat the run as complete.
   *
   * For auditing a deployment the playground cannot drive end to end — an
   * issuer behind an interactive login, say. Its metadata is still worth
   * checking, and a metadata audit that reports itself as a failed run because
   * it never issued anything is telling you about the wrong thing.
   */
  stopAfter?: StepId;
  tamper: TamperMode;
  /** Claims to put in the credential; defaults to a sample identity subject. */
  claims?: Record<string, unknown>;
  /** Per-participant config overrides, keyed by participant id then field key. */
  overrides?: Record<string, Record<string, string>>;
}

/* ------------------------------------------------------------------ *
 * Run lifecycle
 * ------------------------------------------------------------------ */

/** The five phases every run moves through, in order. */
export type StepId =
  | 'discover'
  | 'offer'
  | 'issue'
  | 'present'
  | 'verify';

export const STEP_LABELS: Record<StepId, string> = {
  discover: 'Discover issuer metadata',
  offer: 'Create credential offer',
  issue: 'Issue credential (OpenID4VCI)',
  present: 'Present credential (OpenID4VP)',
  verify: 'Verify presentation',
};

export type StepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'awaiting-user';

export type RunStatus = 'pending' | 'running' | 'awaiting-user' | 'passed' | 'failed' | 'aborted';

/** One captured HTTP request/response pair. */
export interface HttpExchange {
  id: string;
  step: StepId;
  /** Human-readable name of the protocol message, e.g. "Token Request". */
  label: string;
  /** Logical sender and receiver, used to draw the sequence diagram. */
  from: string;
  to: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  durationMs?: number;
  error?: string;
  startedAt: string;
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

/**
 * A single conformance assertion evaluated against captured payloads.
 *
 * These are what turn a run from "it worked on my machine" into an
 * interoperability report: each one cites the clause it is checking, so a
 * failure is actionable by whichever team owns that side of the exchange.
 */
export interface ConformanceCheck {
  id: string;
  step: StepId;
  title: string;
  status: CheckStatus;
  /** Specification clause this assertion comes from. */
  spec: string;
  /** What was actually observed, in developer-facing terms. */
  detail: string;
  /** Set on failure: which participant's behaviour caused it. */
  attributedTo?: Role;
  /**
   * True when this failure is the point of the test rather than a defect —
   * a verifier rejecting a deliberately corrupted credential, for instance.
   * Expected failures are reported but do not fail the run.
   */
  expected?: boolean;
}

/** A durable output of a run — the credential, the presentation, the result. */
export interface Artifact {
  id: string;
  step: StepId;
  label: string;
  /** `jwt` and `sd-jwt` get special decoding treatment in the inspector. */
  kind: 'json' | 'jwt' | 'sd-jwt' | 'cbor' | 'text' | 'qr';
  value: unknown;
}

export type RunEvent =
  | { type: 'run.started'; runId: string; config: RunConfig; at: string }
  | { type: 'step.status'; runId: string; step: StepId; status: StepStatus; note?: string; at: string }
  | { type: 'http'; runId: string; exchange: HttpExchange; at: string }
  | { type: 'check'; runId: string; check: ConformanceCheck; at: string }
  | { type: 'artifact'; runId: string; artifact: Artifact; at: string }
  | { type: 'log'; runId: string; level: 'info' | 'warn' | 'error'; message: string; at: string }
  /** Emitted when the run needs a human to scan a QR or tap a deep link. */
  | { type: 'user.action'; runId: string; action: UserAction; at: string }
  | { type: 'run.finished'; runId: string; status: RunStatus; summary: RunSummary; at: string };

/**
 * A run event carrying its position in the run's event log.
 *
 * The sequence number exists because a client can receive the same event twice:
 * once over the socket, and again in the catch-up log it fetches after starting
 * a run. Without an ordering key, replaying that log can apply a stale prefix
 * over newer state and wind the UI backwards.
 */
export type StampedRunEvent = RunEvent & { seq: number };

export interface UserAction {
  id: string;
  step: StepId;
  title: string;
  instructions: string;
  /** Value to encode as a QR code and/or offer as a deep link. */
  uri: string;
  expiresAt?: string;
}

/** Wall-clock time spent in each phase of a run. */
export type StepTimings = Partial<Record<StepId, number>>;

export interface RunSummary {
  checksPassed: number;
  checksFailed: number;
  checksWarned: number;
  /** Failures that were deliberately provoked, counted separately. */
  checksExpectedFailures: number;
  /** Milliseconds spent in each phase, for latency reporting. */
  stepDurations?: StepTimings;
  durationMs: number;
  /** Populated when the run failed, describing the first fatal problem. */
  failure?: { step: StepId; message: string; attributedTo?: Role };
}

/**
 * A run without its payloads.
 *
 * The history list, dashboard and comparison view all need a run's checks and
 * configuration; none of them needs the credential bodies or the raw HTTP
 * exchanges, which are the overwhelming bulk of a record. Returning full
 * records made the listing grow linearly with every payload ever captured — six
 * megabytes for twenty-seven runs — so the list is projected and the full record
 * fetched by id when someone actually opens one.
 */
export type RunListItem = Omit<RunRecord, 'exchanges' | 'artifacts'> & {
  exchangeCount: number;
  artifactCount: number;
};

/** Aggregate statistics over recorded runs. */
export interface RunStats {
  total: number;
  passed: number;
  failed: number;
  /** Median and 95th percentile of total run duration, in milliseconds. */
  durationP50: number;
  durationP95: number;
  /** Median duration of each phase, in milliseconds. */
  stepMedians: StepTimings;
  /** Success rate broken down by a dimension, for spotting what fails. */
  byFormat: StatBucket[];
  byIssuer: StatBucket[];
  byVerifier: StatBucket[];
  byFault: StatBucket[];
  /** Success rate by participant build, for regression tracking across releases. */
  byVersion: StatBucket[];
  /** The checks that fail or warn most often across the whole history. */
  topFindings: Array<{ title: string; status: CheckStatus; count: number; spec: string }>;
}

export interface StatBucket {
  key: string;
  total: number;
  passed: number;
  /** Median total duration for this bucket, in milliseconds. */
  durationP50: number;
}

/**
 * Which build of a participant a run exercised.
 *
 * Needed for the one thing a run history is actually for: telling whether a
 * result changed because the software changed. Discovery is unreliable across
 * this stack — some services publish build info, some publish nothing — so an
 * operator-supplied label is a first-class alternative rather than a fallback,
 * and the source is recorded either way so nobody mistakes a guess for a fact.
 */

/**
 * A plain-language account of what a run actually did.
 *
 * Built by the engine rather than reconstructed in the UI, because the facts
 * that matter to a non-specialist — which claims were shared, which were
 * withheld, whether anyone could tell the credential was genuine — are known
 * precisely at the moment they happen and only approximately afterwards.
 */
export interface ParticipantVersion {
  role: Role;
  participantId: string;
  /** Where the value came from, or that there is none. */
  source: 'discovered' | 'declared' | 'unknown';
  /** Version, commit or build identifier. */
  value?: string;
  /** What was consulted, for a reader who wants to check. */
  detail?: string;
}

export interface RunNarrative {
  /** Every claim the issuer put in the credential. */
  issuedClaims: Record<string, unknown>;
  /** Claim names the verifier's request actually asked for, when it named any. */
  requestedClaims: string[];
  /** Claims the verifier ended up seeing. */
  disclosedClaims: Record<string, unknown>;
  /** Claims the holder kept back — the point of selective disclosure. */
  withheldClaims: string[];
  /** Whether the credential is cryptographically tied to this holder's key. */
  holderBound: boolean;
  /** Whether the presentation could only be used for this one request. */
  boundToRequest: boolean;
  verdict?: 'valid' | 'invalid' | 'valid-but-expired' | 'error';
  /** What the verifier established, in words rather than clause references. */
  verifierEstablished: Array<{ claim: string; ok: boolean; note?: string }>;
}

/** The persisted record of a completed run, and the row in the matrix report. */
export interface RunRecord {
  id: string;
  config: RunConfig;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  participants: { issuer: Participant; wallet: Participant; verifier: Participant };
  steps: Record<StepId, StepStatus>;
  exchanges: HttpExchange[];
  checks: ConformanceCheck[];
  artifacts: Artifact[];
  summary?: RunSummary;
  /** Plain-language account of the run, for readers who are not protocol people. */
  narrative?: RunNarrative;
  /** Which build of each participant this run exercised. */
  versions?: ParticipantVersion[];
  /** Weakest traceability across the three participants; caveats the result. */
  traceability: Traceability;
}
