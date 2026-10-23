import { randomUUID } from 'node:crypto';
import { assessQrPayload } from './qr.js';
import type {
  Artifact,
  CheckStatus,
  ConformanceCheck,
  HttpExchange,
  Role,
  RunConfig,
  RunEvent,
  StepId,
  StepStatus,
  UserAction,
} from '@interop/shared';

export type EventSink = (event: RunEvent) => void;

/** Thrown by adapters to fail a run with an attributable, human-readable cause. */
export class RunFailure extends Error {
  constructor(
    message: string,
    readonly step: StepId,
    readonly attributedTo?: Role,
  ) {
    super(message);
    this.name = 'RunFailure';
  }
}

export interface TracedRequest {
  /** Protocol message name shown in the timeline, e.g. "Token Request". */
  label: string;
  /** Logical endpoints, used to draw the sequence diagram. */
  from: string;
  to: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Sent as JSON unless `form` is set. */
  json?: unknown;
  /** Sent as application/x-www-form-urlencoded. */
  form?: Record<string, string>;
  /** Accept header shorthand; defaults to application/json. */
  accept?: string;
  /** Treat a non-2xx as a normal outcome rather than a run failure. */
  allowNonOk?: boolean;
  /**
   * Leave a redirect unfollowed so the caller can inspect `Location`.
   *
   * The authorization code arrives in a redirect, and following it
   * automatically would consume the very thing the flow is delivering.
   */
  manualRedirect?: boolean;
  timeoutMs?: number;
}

export interface TracedResponse<T = unknown> {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: T;
  /** Raw response text, kept because some payloads are JWTs, not JSON. */
  raw: string;
  exchange: HttpExchange;
}

/**
 * Everything an adapter is given for the duration of a run.
 *
 * Adapters never touch the network or the event stream directly — they go
 * through this object, which is what makes the protocol inspector complete by
 * construction rather than by adapters remembering to log.
 */
export class RunContext {
  private currentStep: StepId = 'discover';
  private readonly pendingActions = new Map<string, { resolve: (value: unknown) => void; reject: (e: Error) => void }>();

  readonly exchanges: HttpExchange[] = [];
  readonly checks: ConformanceCheck[] = [];
  readonly artifacts: Artifact[] = [];
  /**
   * Steps in which a check failure is the intended result. Set by the engine
   * for tampered runs, so that a verifier correctly rejecting a forged
   * credential is not recorded as the verifier misbehaving.
   */
  private readonly stepsExpectingFailure = new Set<StepId>();
  /** Free-form scratch space adapters use to hand state to one another. */
  readonly state = new Map<string, unknown>();

  constructor(
    readonly runId: string,
    readonly config: RunConfig,
    private readonly emit: EventSink,
    /**
     * Maps an outbound URL to the address this process should actually dial.
     *
     * The hosted reference issuer and verifier publish their public URL in
     * metadata and offers, because that is what an external wallet has to be
     * able to reach. When this process then follows one of its own published
     * URLs, that address may not resolve from where it is running — inside a
     * container with a remapped port, or behind a tunnel. Rewriting to loopback
     * at dial time keeps the published identifiers correct while letting the
     * playground talk to itself.
     */
    private readonly resolveUrl: (url: string) => string = (url) => url,
  ) {}

  get step(): StepId {
    return this.currentStep;
  }

  expectFailuresIn(...steps: StepId[]): void {
    for (const step of steps) this.stepsExpectingFailure.add(step);
  }

  clearExpectedFailures(): void {
    this.stepsExpectingFailure.clear();
  }

  setStep(step: StepId, status: StepStatus, note?: string): void {
    this.currentStep = step;
    this.emit({ type: 'step.status', runId: this.runId, step, status, note, at: now() });
  }

  log(level: 'info' | 'warn' | 'error', message: string): void {
    this.emit({ type: 'log', runId: this.runId, level, message, at: now() });
  }

  /** Record a conformance assertion. Failures do not by themselves abort a run. */
  check(input: {
    id: string;
    title: string;
    status: CheckStatus;
    spec: string;
    detail: string;
    attributedTo?: Role;
  }): ConformanceCheck {
    const check: ConformanceCheck = {
      step: this.currentStep,
      ...input,
      ...(input.status === 'fail' && this.stepsExpectingFailure.has(this.currentStep)
        ? { expected: true }
        : {}),
    };
    this.checks.push(check);
    this.emit({ type: 'check', runId: this.runId, check, at: now() });
    return check;
  }

  /** Assert a condition, recording pass or fail either way. */
  expect(
    condition: boolean,
    input: { id: string; title: string; spec: string; pass: string; fail: string; attributedTo?: Role },
  ): boolean {
    this.check({
      id: input.id,
      title: input.title,
      status: condition ? 'pass' : 'fail',
      spec: input.spec,
      detail: condition ? input.pass : input.fail,
      attributedTo: condition ? undefined : input.attributedTo,
    });
    return condition;
  }

  artifact(input: { label: string; kind: Artifact['kind']; value: unknown }): Artifact {
    const artifact: Artifact = { id: randomUUID(), step: this.currentStep, ...input };
    this.artifacts.push(artifact);
    this.emit({ type: 'artifact', runId: this.runId, artifact, at: now() });

    // Anything destined for a QR code gets measured as it is recorded. Doing it
    // here rather than in each adapter means a new participant cannot forget,
    // and the check appears in the step that produced the payload.
    if (input.kind === 'qr' && typeof input.value === 'string') this.assessQr(input.label, input.value);

    return artifact;
  }

  /** Reports whether a QR payload can actually be scanned. */
  private assessQr(label: string, payload: string): void {
    const assessment = assessQrPayload(payload);

    // Keyed on the label as well as the step. Two QR payloads in one step would
    // otherwise share a check id, and the baseline comparison indexes checks by
    // id — so one would silently replace the other and a regression in it could
    // never be seen.
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    this.check({
      id: `qr.capacity.${this.currentStep}.${slug}`,
      title: `${label} fits in a scannable QR code`,
      status:
        assessment.verdict === 'comfortable'
          ? 'pass'
          : assessment.verdict === 'workable'
            ? 'pass'
            : assessment.verdict === 'impossible'
              ? 'fail'
              : 'warn',
      spec: 'ISO/IEC 18004 (QR capacity) / OpenID4VP §5.10',
      detail: assessment.summary,
      attributedTo: assessment.verdict === 'comfortable' || assessment.verdict === 'workable' ? undefined : 'verifier',
    });
  }

  fail(message: string, attributedTo?: Role): never {
    throw new RunFailure(message, this.currentStep, attributedTo);
  }

  /**
   * Pause the run until a human completes an out-of-band action — scanning a QR
   * with a phone wallet, or tapping a same-device deep link.
   */
  awaitUserAction(action: Omit<UserAction, 'id'>, timeoutMs = 300_000): Promise<unknown> {
    const id = randomUUID();
    const full: UserAction = { id, ...action };
    this.emit({ type: 'user.action', runId: this.runId, action: full, at: now() });
    this.setStep(action.step, 'awaiting-user', action.title);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingActions.delete(id);
        reject(new RunFailure(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for: ${action.title}`, action.step));
      }, timeoutMs);

      this.pendingActions.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          this.pendingActions.delete(id);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          this.pendingActions.delete(id);
          reject(error);
        },
      });
    });
  }

  /** Called from the HTTP layer when the user signals an action is done. */
  resolveUserAction(actionId: string, value: unknown): boolean {
    const pending = this.pendingActions.get(actionId);
    if (!pending) return false;
    pending.resolve(value);
    return true;
  }

  abortPendingActions(reason: string): void {
    for (const [, pending] of this.pendingActions) pending.reject(new Error(reason));
    this.pendingActions.clear();
  }

  /**
   * Perform an HTTP request, capturing the full request/response pair.
   *
   * Bodies are parsed as JSON when the content type says so and kept as text
   * otherwise, because several endpoints in this ecosystem return bare JWTs
   * (`application/oauth-authz-req+jwt`) rather than JSON envelopes.
   */
  async http<T = unknown>(req: TracedRequest): Promise<TracedResponse<T>> {
    const method = req.method ?? (req.json || req.form ? 'POST' : 'GET');
    const headers: Record<string, string> = {
      accept: req.accept ?? 'application/json',
      ...(req.headers ?? {}),
    };

    let body: string | undefined;
    if (req.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(req.form).toString();
    } else if (req.json !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      body = JSON.stringify(req.json);
    }

    const exchange: HttpExchange = {
      id: randomUUID(),
      step: this.currentStep,
      label: req.label,
      from: req.from,
      to: req.to,
      method,
      url: req.url,
      requestHeaders: headers,
      requestBody: req.form ?? req.json,
      startedAt: now(),
    };

    const startedAtMs = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 30_000);

    // The exchange records the URL as published; only the dial target changes,
    // so the inspector still shows what a real client would have requested.
    const target = this.resolveUrl(req.url);

    try {
      const response = await fetch(target, {
        method,
        headers,
        body,
        signal: controller.signal,
        ...(req.manualRedirect ? { redirect: 'manual' as const } : {}),
      });
      const raw = await response.text();
      const contentType = response.headers.get('content-type') ?? '';
      const parsed = contentType.includes('json') ? safeParseJson(raw) : raw;

      exchange.status = response.status;
      exchange.responseHeaders = Object.fromEntries(response.headers.entries());
      exchange.responseBody = parsed;
      exchange.durationMs = Date.now() - startedAtMs;
      this.record(exchange);

      // A 3xx is the expected outcome when redirects are being handled by the
      // caller, so it must not be treated as a failure.
      const redirected = req.manualRedirect && response.status >= 300 && response.status < 400;

      if (!response.ok && !redirected && !req.allowNonOk) {
        this.fail(`${req.label} failed: HTTP ${response.status} from ${req.to} — ${truncate(raw, 400)}`);
      }

      return {
        ok: response.ok,
        status: response.status,
        headers: exchange.responseHeaders,
        body: parsed as T,
        raw,
        exchange,
      };
    } catch (error) {
      if (error instanceof RunFailure) throw error;
      // Node's fetch reports every network failure as "fetch failed" and puts
      // the reason (DNS, TLS, refused) on `cause`, which is the part worth reading.
      const cause = error instanceof Error ? describeCause(error.cause) : '';
      const message = error instanceof Error ? `${error.message}${cause}` : String(error);
      exchange.error = controller.signal.aborted ? `Timed out after ${req.timeoutMs ?? 30_000}ms` : message;
      exchange.durationMs = Date.now() - startedAtMs;
      this.record(exchange);
      this.fail(`${req.label} could not reach ${req.to}: ${exchange.error}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Record an exchange that happened somewhere the orchestrator cannot
   * intercept — used by endpoint-only adapters to place a known-but-unobserved
   * message on the timeline rather than leaving a silent gap.
   */
  recordExternalExchange(input: Omit<HttpExchange, 'id' | 'step' | 'startedAt'>): void {
    this.record({ id: randomUUID(), step: this.currentStep, startedAt: now(), ...input });
  }

  private record(exchange: HttpExchange): void {
    this.exchanges.push(exchange);
    this.emit({ type: 'http', runId: this.runId, exchange, at: now() });
  }
}

function safeParseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * The useful part of a network error. Connecting to a host with several
 * addresses fails with an AggregateError whose own message is empty, so the
 * per-address codes (ENETUNREACH, ETIMEDOUT, ECONNREFUSED) are what say why.
 */
function describeCause(cause: unknown): string {
  if (!(cause instanceof Error)) return '';
  const inner = cause instanceof AggregateError
    ? cause.errors.map((e: { code?: string; message?: string }) => e.code ?? e.message)
    : [];
  const parts = [cause.message, (cause as { code?: string }).code, ...inner].filter(Boolean);
  return parts.length ? `: ${[...new Set(parts)].join(', ')}` : '';
}
