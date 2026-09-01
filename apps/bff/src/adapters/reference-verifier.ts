import type { AuthorizationRequest, Participant } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import type { PresentOptions, PresentationRequest, VerificationOutcome, VerifierAdapter } from './types.js';
import { pollUntil } from '../core/poll.js';

/** Verifier adapter for the playground's own OpenID4VP relying party. */
export class ReferenceVerifier implements VerifierAdapter {
  readonly manifest: Participant;

  constructor(private readonly publicUrl: string) {
    this.manifest = {
      id: 'reference-verifier',
      role: 'verifier',
      label: 'Reference Verifier (OpenID4VP)',
      kind: 'mock',
      summary:
        'A specification-only OpenID4VP relying party hosted by the playground. Reports every individual check it performs, not just a verdict.',
      traceability: 'full',
      formats: ['ldp_vc', 'vc+sd-jwt', 'dc+sd-jwt', 'mso_mdoc'],
      specs: ['openid4vp-draft-21', 'openid4vp-draft-23', 'openid4vp-1.0'],
      interactive: false,
      config: [
        {
          key: 'baseUrl',
          label: 'Verifier base URL',
          value: new URL('/mock-verifier', publicUrl).toString(),
          required: true,
        },
      ],
    };
  }

  private baseUrl(ctx: RunContext): string {
    return (
      ctx.config.overrides?.[this.manifest.id]?.baseUrl ??
      new URL('/mock-verifier', this.publicUrl).toString()
    ).replace(/\/$/, '');
  }

  async createRequest(ctx: RunContext, opts: PresentOptions): Promise<PresentationRequest> {
    const response = await ctx.http<{
      transaction_id: string;
      request_id: string;
      request_uri: string;
      authorization_request: AuthorizationRequest;
      nonce: string;
      state: string;
      response_uri: string;
      deeplink: string;
    }>({
      label: 'Create Authorization Request',
      from: 'Playground',
      to: 'Verifier',
      url: `${this.baseUrl(ctx)}/requests`,
      json: { format: opts.format },
    });

    const body = response.body;
    ctx.artifact({ label: 'Authorization Request', kind: 'json', value: body.authorization_request });
    ctx.artifact({
      label: 'presentation_definition',
      kind: 'json',
      value: body.authorization_request.presentation_definition,
    });
    ctx.artifact({ label: 'OpenID4VP request URI (QR payload)', kind: 'qr', value: body.deeplink });

    return {
      authorizationRequest: body.authorization_request,
      requestUri: body.deeplink,
      transactionId: body.transaction_id,
      requestId: body.request_id,
      nonce: body.nonce,
      state: body.state,
      responseUri: body.response_uri,
    };
  }

  async awaitResult(ctx: RunContext, request: PresentationRequest): Promise<VerificationOutcome> {
    const result = await pollUntil({
      description: 'verification result',
      timeoutMs: 120_000,
      intervalMs: 1_000,
      attempt: async () => {
        const response = await ctx.http<{
          status: string;
          verdict?: VerificationOutcome['verdict'];
          checks?: Array<{
            id: string;
            title: string;
            ok: boolean;
            detail: string;
            expiryRelated?: boolean;
            warnOnly?: boolean;
          }>;
          claims?: Record<string, unknown>;
          error?: string;
          error_description?: string;
        }>({
          label: 'Poll Verification Result',
          from: 'Playground',
          to: 'Verifier',
          url: `${this.baseUrl(ctx)}/result/${request.transactionId}`,
        });
        return response.body.status === 'pending' ? undefined : response.body;
      },
    });

    if (!result) {
      ctx.fail('The verifier never reported a result for this transaction.', 'verifier');
    }

    if (result.status === 'error') {
      return {
        verdict: 'error',
        raw: result,
        message: result.error_description ?? result.error ?? 'Verification failed',
      };
    }

    // The reference verifier reports its individual checks, so surface each one
    // as a conformance check rather than collapsing them into a single verdict.
    for (const check of result.checks ?? []) {
      ctx.check({
        id: `verifier.${check.id}`,
        title: check.title,
        status: check.ok ? (check.warnOnly ? 'warn' : 'pass') : check.expiryRelated || check.warnOnly ? 'warn' : 'fail',
        spec: 'OpenID4VP §7 / credential format specification',
        detail: check.detail,
        attributedTo: check.ok ? undefined : 'wallet',
      });
    }

    return {
      verdict: result.verdict ?? 'error',
      raw: result,
      credentialResults: [{ status: result.verdict ?? 'unknown', claims: result.claims }],
    };
  }
}
