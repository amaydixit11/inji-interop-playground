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

/** Proof / signature suite used on the issued credential. */
export type ProofType =
  | 'Ed25519Signature2018'
  | 'Ed25519Signature2020'
  | 'RsaSignature2018'
  | 'DataIntegrityProof'
  | 'ES256'
  | 'EdDSA'
  | 'RS256';

/** Key-binding proof the wallet sends to the credential endpoint. */
export type WalletProofType = 'jwt' | 'cwt' | 'none';

/**
 * Which spec revision a participant speaks. Recorded per run because the single
 * most common source of real interop failure in this ecosystem is two sides
 * implementing different drafts of the same protocol.
 */
export type SpecVersion =
  | 'openid4vci-draft-13'
  | 'openid4vci-1.0'
  | 'openid4vp-draft-21'
  | 'openid4vp-draft-23'
  | 'openid4vp-1.0';

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
  | 'strip-holder-proof';

export const TAMPER_MODE_LABELS: Record<TamperMode, string> = {
  none: 'No tampering (happy path)',
  'break-signature': 'Corrupt credential signature',
  'expire-credential': 'Issue an already-expired credential',
  'wrong-type': 'Present a credential of the wrong type',
  'replay-nonce': 'Replay a stale nonce',
  'strip-holder-proof': 'Strip the holder binding proof',
};

/** Everything needed to start a run. */
export interface RunConfig {
  issuerId: string;
  walletId: string;
  verifierId: string;
  format: CredentialFormat;
  proofType: ProofType;
  walletProofType: WalletProofType;
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

export interface UserAction {
  id: string;
  step: StepId;
  title: string;
  instructions: string;
  /** Value to encode as a QR code and/or offer as a deep link. */
  uri: string;
  expiresAt?: string;
}

export interface RunSummary {
  checksPassed: number;
  checksFailed: number;
  checksWarned: number;
  /** Failures that were deliberately provoked, counted separately. */
  checksExpectedFailures: number;
  durationMs: number;
  /** Populated when the run failed, describing the first fatal problem. */
  failure?: { step: StepId; message: string; attributedTo?: Role };
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
  /** Weakest traceability across the three participants; caveats the result. */
  traceability: Traceability;
}
