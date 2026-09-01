import { randomUUID } from 'node:crypto';
import type {
  Participant,
  RunConfig,
  RunEvent,
  RunRecord,
  RunStatus,
  RunSummary,
  StepId,
  StepStatus,
  TamperMode,
} from '@interop/shared';
import { RunContext, RunFailure, type EventSink } from './context.js';
import { DEFAULT_CLAIMS } from './credentials.js';
import type { IssuerAdapter, VerificationOutcome, VerifierAdapter, WalletAdapter } from '../adapters/types.js';

export interface RunParticipants {
  issuer: IssuerAdapter;
  wallet: WalletAdapter;
  verifier: VerifierAdapter;
}

/**
 * The outcome a run is expected to reach.
 *
 * Tampered runs invert the usual meaning of success: a corrupted credential
 * that a verifier accepts is a *failure* of the verifier, and one it rejects is
 * a passing negative test. Without this the negative paths would be unusable,
 * since every one of them would be reported as a broken run.
 */
export function expectedVerdict(tamper: TamperMode): { verdict: VerificationOutcome['verdict'][]; rationale: string } {
  switch (tamper) {
    case 'none':
      return { verdict: ['valid'], rationale: 'An untampered credential must verify.' };
    case 'expire-credential':
      return {
        verdict: ['valid-but-expired', 'invalid'],
        rationale: 'An expired credential must be reported as expired, or at minimum rejected.',
      };
    case 'revoke-credential':
      return {
        verdict: ['invalid', 'error'],
        rationale: 'A revoked credential must be rejected even though its signature is intact.',
      };
    case 'break-signature':
    case 'wrong-type':
    case 'replay-nonce':
    case 'strip-holder-proof':
      return { verdict: ['invalid', 'error'], rationale: 'A tampered credential must be rejected.' };
    default:
      return { verdict: ['valid'], rationale: 'Unknown tamper mode; defaulting to expecting success.' };
  }
}

const STEP_ORDER: StepId[] = ['discover', 'offer', 'issue', 'present', 'verify'];

export class Run {
  readonly id = randomUUID();
  readonly startedAt = new Date();
  readonly ctx: RunContext;

  private status: RunStatus = 'pending';
  private readonly steps: Record<StepId, StepStatus> = {
    discover: 'pending',
    offer: 'pending',
    issue: 'pending',
    present: 'pending',
    verify: 'pending',
  };

  constructor(
    readonly config: RunConfig,
    private readonly participants: RunParticipants,
    private readonly emit: EventSink,
    resolveUrl?: (url: string) => string,
  ) {
    this.ctx = new RunContext(
      this.id,
      config,
      (event) => {
        if (event.type === 'step.status') this.steps[event.step] = event.status;
        this.emit(event);
      },
      resolveUrl,
    );
  }

  get runStatus(): RunStatus {
    return this.status;
  }

  resolveUserAction(actionId: string, value: unknown): boolean {
    return this.ctx.resolveUserAction(actionId, value);
  }

  abort(reason: string): void {
    this.status = 'aborted';
    this.ctx.abortPendingActions(reason);
  }

  async execute(): Promise<RunRecord> {
    this.status = 'running';
    this.emit({ type: 'run.started', runId: this.id, config: this.config, at: new Date().toISOString() });

    const issueOptions = {
      format: this.config.format,
      proofType: this.config.proofType,
      claims: this.config.claims ?? DEFAULT_CLAIMS,
    };
    const presentOptions = {
      format: this.config.format,
      walletProofType: this.config.walletProofType,
    };

    let failure: RunSummary['failure'];

    try {
      this.preflight();

      if (this.config.tamper !== 'none') {
        // From here the credential is deliberately broken, so checks failing
        // during presentation and verification are the intended result. They
        // are still reported; they just do not condemn the run.
        this.ctx.expectFailuresIn('present', 'verify');
      }

      this.ctx.setStep('discover', 'running');
      const endpoints = await this.participants.issuer.discover(this.ctx, issueOptions);
      this.ctx.setStep('discover', 'passed');

      this.ctx.setStep('offer', 'running');
      const offer = await this.participants.issuer.createOffer(this.ctx, endpoints, issueOptions);
      this.ctx.artifact({ label: 'Credential offer URI', kind: 'qr', value: offer.offerUri });
      this.ctx.setStep('offer', 'passed');

      this.ctx.setStep('issue', 'running');
      const held = await this.participants.wallet.acceptOffer(this.ctx, offer, endpoints, issueOptions);
      this.checkIssuedFormat(held.format);

      // Asked before any presentation exists, so a verifier that simply cannot
      // read this credential is distinguished from one that cannot complete the
      // exchange.
      if (this.participants.verifier.verifyCredentialDirectly && held.raw !== null) {
        // Widened to cover this check only. By this point the credential is
        // already deliberately broken, so a verifier rejecting it here is the
        // intended result — but issuance itself failing is not, which is why
        // the window opens now rather than at the start of the step.
        if (this.config.tamper !== 'none') this.ctx.expectFailuresIn('issue');
        await this.participants.verifier.verifyCredentialDirectly(this.ctx, held);
      }

      this.ctx.setStep('issue', 'passed');

      this.ctx.setStep('present', 'running');
      const request = await this.participants.verifier.createRequest(this.ctx, presentOptions);
      await this.participants.wallet.present(this.ctx, request, held, presentOptions);
      this.ctx.setStep('present', 'passed');

      this.ctx.setStep('verify', 'running');
      const outcome = await this.participants.verifier.awaitResult(this.ctx, request);
      this.ctx.artifact({ label: 'Verification result', kind: 'json', value: outcome.raw });
      this.evaluateOutcome(outcome);
      this.ctx.setStep('verify', 'passed');
    } catch (error) {
      const runFailure = error instanceof RunFailure ? error : undefined;
      const step = runFailure?.step ?? this.ctx.step;
      const message = error instanceof Error ? error.message : String(error);

      this.ctx.setStep(step, 'failed', message);
      this.ctx.log('error', message);
      failure = { step, message, attributedTo: runFailure?.attributedTo };

      for (const remaining of STEP_ORDER.slice(STEP_ORDER.indexOf(step) + 1)) {
        this.ctx.setStep(remaining, 'skipped');
      }
    }

    const genuineFailures = this.ctx.checks.filter((c) => c.status === 'fail' && !c.expected);
    const summary: RunSummary = {
      checksPassed: this.ctx.checks.filter((c) => c.status === 'pass').length,
      checksFailed: genuineFailures.length,
      checksWarned: this.ctx.checks.filter((c) => c.status === 'warn').length,
      checksExpectedFailures: this.ctx.checks.filter((c) => c.status === 'fail' && c.expected).length,
      durationMs: Date.now() - this.startedAt.getTime(),
      failure,
    };

    // Read through the accessor: `abort()` can fire from another request while
    // the run is in flight, so the field is not as narrow as assignment makes
    // it look, and a direct comparison gets flagged as unreachable.
    if (this.runStatus !== 'aborted') {
      this.status = failure || genuineFailures.length > 0 ? 'failed' : 'passed';
    }

    this.emit({
      type: 'run.finished',
      runId: this.id,
      status: this.status,
      summary,
      at: new Date().toISOString(),
    });

    return this.toRecord(summary);
  }

  /** Rejects combinations that cannot work, before any network traffic. */
  private preflight(): void {
    const { issuer, wallet, verifier } = this.participants;
    const format = this.config.format;

    for (const [role, participant] of [
      ['issuer', issuer.manifest],
      ['wallet', wallet.manifest],
      ['verifier', verifier.manifest],
    ] as const) {
      if (!participant.formats.includes(format)) {
        this.ctx.check({
          id: `preflight.${role}.format`,
          title: `Selected ${role} supports ${format}`,
          status: 'fail',
          spec: 'Playground preflight',
          detail: `${participant.label} declares support for ${participant.formats.join(', ')} but the run requested ${format}.`,
          attributedTo: role,
        });
        this.ctx.fail(`${participant.label} does not support the ${format} format.`, role);
      }
    }

    for (const [role, participant] of [
      ['issuer', issuer.manifest],
      ['wallet', wallet.manifest],
      ['verifier', verifier.manifest],
    ] as const) {
      for (const [index, constraint] of (participant.constraints ?? []).entries()) {
        this.ctx.check({
          id: `preflight.${role}.constraint-${index}`,
          title: `${participant.label} pairing constraint`,
          status: 'warn',
          spec: 'Playground preflight',
          detail: constraint,
        });
      }
    }

    if (this.config.tamper === 'revoke-credential' && format !== 'ldp_vc') {
      // Revocation is modelled through the W3C status list, which only the
      // JSON-LD credential carries. SD-JWT VC and mdoc have their own status
      // mechanisms (Token Status List, and the mdoc status field) that this
      // playground does not implement yet, and silently passing the run would
      // report an untested path as tested.
      this.ctx.check({
        id: 'preflight.tamper.status-support',
        title: 'Revocation can be modelled for this credential format',
        status: 'fail',
        spec: 'W3C Bitstring Status List / StatusList2021',
        detail: `Revocation is only wired up for ldp_vc, which carries a credentialStatus entry. ${format} uses a different status mechanism that this playground does not implement.`,
      });
      this.ctx.fail(`The revoke-credential fault is not applicable to ${format}.`);
    }

    if (this.config.tamper !== 'none' && wallet.manifest.traceability === 'endpoint-only') {
      this.ctx.check({
        id: 'preflight.tamper.traceability',
        title: 'Tamper mode is compatible with the selected wallet',
        status: 'warn',
        spec: 'Playground preflight',
        detail: `Tampering is applied at issuance, so it will reach ${wallet.manifest.label}, but the playground cannot observe how that wallet handles the corrupted credential — only what the verifier ultimately reports.`,
      });
    }
  }

  private checkIssuedFormat(issuedFormat: string): void {
    // A `null` credential means an off-box wallet holds it; there is nothing to
    // compare, and saying so beats reporting a false pass.
    if (this.participants.wallet.manifest.traceability === 'endpoint-only') return;

    this.ctx.expect(issuedFormat === this.config.format, {
      id: 'vci.credential.format-match',
      title: 'Issued credential is in the requested format',
      spec: 'OpenID4VCI §7.3',
      pass: `The credential came back as ${issuedFormat}, as requested.`,
      fail: `Requested ${this.config.format} but received ${issuedFormat}.`,
      attributedTo: 'issuer',
    });
  }

  private evaluateOutcome(outcome: VerificationOutcome): void {
    const expectation = expectedVerdict(this.config.tamper);
    const met = expectation.verdict.includes(outcome.verdict);

    // Recorded outside the expected-failure window: if the verifier *accepts* a
    // forged credential, that is the one failure a tampered run must surface.
    this.ctx.clearExpectedFailures();
    this.ctx.check({
      id: 'run.expected-outcome',
      title:
        this.config.tamper === 'none'
          ? 'Verification succeeded'
          : `Verifier correctly rejected the tampered credential (${this.config.tamper})`,
      status: met ? 'pass' : 'fail',
      spec: expectation.rationale,
      detail: met
        ? `Verifier reported "${outcome.verdict}", which is an expected outcome for this run.`
        : `Verifier reported "${outcome.verdict}" but this run expected one of: ${expectation.verdict.join(', ')}. ${
            this.config.tamper === 'none'
              ? ''
              : 'Accepting a deliberately corrupted credential is a verifier defect.'
          }`,
      attributedTo: met ? undefined : this.config.tamper === 'none' ? undefined : 'verifier',
    });
  }

  private toRecord(summary: RunSummary): RunRecord {
    const manifests: Record<'issuer' | 'wallet' | 'verifier', Participant> = {
      issuer: this.participants.issuer.manifest,
      wallet: this.participants.wallet.manifest,
      verifier: this.participants.verifier.manifest,
    };

    return {
      id: this.id,
      config: this.config,
      status: this.status,
      startedAt: this.startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      participants: manifests,
      steps: { ...this.steps },
      exchanges: [...this.ctx.exchanges],
      checks: [...this.ctx.checks],
      artifacts: [...this.ctx.artifacts],
      summary,
      // The report is only as trustworthy as its least-observable participant.
      traceability: Object.values(manifests).some((p) => p.traceability === 'endpoint-only')
        ? 'endpoint-only'
        : 'full',
    };
  }
}

export type { RunEvent };
