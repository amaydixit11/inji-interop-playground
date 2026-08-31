import { randomUUID, randomBytes } from 'node:crypto';
import type { AuthorizationRequest, Participant, PresentationDefinition } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import { buildPresentationDefinition } from '../services/mock-verifier.js';
import { pollUntil } from '../core/poll.js';
import type { PresentOptions, PresentationRequest, VerificationOutcome, VerifierAdapter } from './types.js';

/**
 * Verifier adapter for Inji Verify's `verify-service`.
 *
 * The service's own API is not itself OpenID4VP — `POST /vp-request` returns a
 * camelCase envelope (`clientId`, `responseUri`, `presentationDefinition`) and
 * leaves the caller to assemble the actual authorization request. That
 * translation happens here, which is also why it is worth checking: a wallet
 * handed the envelope verbatim would not find the parameters the specification
 * tells it to look for.
 */
export class InjiVerifyVerifier implements VerifierAdapter {
  readonly manifest: Participant;

  constructor(defaults: { baseUrl: string }) {
    this.manifest = {
      id: 'inji-verify',
      role: 'verifier',
      label: 'Inji Verify',
      kind: 'inji',
      summary:
        'MOSIP Inji Verify verify-service acting as an OpenID4VP relying party, with status and holder-proof checks.',
      traceability: 'full',
      formats: ['ldp_vc', 'vc+sd-jwt'],
      specs: ['openid4vp-draft-21', 'openid4vp-draft-23'],
      interactive: false,
      config: [
        {
          key: 'baseUrl',
          label: 'verify-service base URL',
          value: defaults.baseUrl,
          placeholder: 'http://localhost:8000/v1/verify',
          required: true,
        },
      ],
    };
  }

  private baseUrl(ctx: RunContext): string {
    return (
      ctx.config.overrides?.[this.manifest.id]?.baseUrl ??
      this.manifest.config.find((f) => f.key === 'baseUrl')?.value ??
      ''
    ).replace(/\/$/, '');
  }

  async createRequest(ctx: RunContext, opts: PresentOptions): Promise<PresentationRequest> {
    const base = this.baseUrl(ctx);
    const transactionId = `txn-${randomUUID()}`;
    const nonce = randomBytes(16).toString('base64url');
    const presentationDefinition = buildPresentationDefinition(opts.format);

    const response = await ctx.http<{
      transactionId: string;
      requestId: string;
      expiresAt?: number;
      requestUri?: string;
      authorizationDetails: {
        clientId: string;
        responseType: string;
        responseMode: string;
        responseUri: string;
        nonce: string;
        presentationDefinition?: PresentationDefinition;
        presentationDefinitionUri?: string;
      };
    }>({
      label: 'Create VP Request (Inji Verify)',
      from: 'Playground',
      to: 'Inji Verify',
      url: `${base}/vp-request`,
      json: {
        clientId: `${base}/vp-submission/direct-post`,
        transactionId,
        nonce,
        presentationDefinition,
        acceptVPWithoutHolderProof: false,
      },
    });

    const details = response.body.authorizationDetails;
    if (!details) {
      ctx.fail('Inji Verify returned no authorizationDetails for the VP request.', 'verifier');
    }

    ctx.check({
      id: 'vp.request.parameter-naming',
      title: 'Authorization request parameters use the specified names',
      status: 'warn',
      spec: 'OpenID4VP §5',
      detail:
        'verify-service returns its authorization request as a camelCase envelope (clientId, responseUri, presentationDefinition). OpenID4VP defines these as client_id, response_uri and presentation_definition, so the caller must translate before handing the request to a wallet.',
      attributedTo: 'verifier',
    });

    // Inji Verify generates its own nonce; use whichever it actually returned,
    // because that is the value the holder must echo back.
    const effectiveNonce = details.nonce ?? nonce;
    ctx.expect(effectiveNonce === nonce, {
      id: 'vp.request.nonce-honoured',
      title: 'Verifier honoured the requested nonce',
      spec: 'OpenID4VP §5',
      pass: 'The nonce supplied in the request creation call was used verbatim.',
      fail: `Supplied nonce "${nonce}" but the verifier issued "${effectiveNonce}". The playground will use the verifier's value.`,
      attributedTo: 'verifier',
    });

    const authorizationRequest: AuthorizationRequest = {
      client_id: details.clientId,
      response_type: 'vp_token',
      response_mode: 'direct_post',
      response_uri: details.responseUri,
      nonce: effectiveNonce,
      state: response.body.requestId,
      presentation_definition: details.presentationDefinition ?? presentationDefinition,
      ...(details.presentationDefinitionUri
        ? { presentation_definition_uri: details.presentationDefinitionUri }
        : {}),
    };

    ctx.artifact({ label: 'Authorization Request (normalised)', kind: 'json', value: authorizationRequest });
    ctx.artifact({ label: 'verify-service response (raw)', kind: 'json', value: response.body });

    const deeplink = `openid4vp://authorize?${new URLSearchParams(
      Object.fromEntries(
        Object.entries(authorizationRequest).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : JSON.stringify(value),
        ]),
      ),
    ).toString()}`;
    ctx.artifact({ label: 'OpenID4VP request URI (QR payload)', kind: 'qr', value: deeplink });

    return {
      authorizationRequest,
      requestUri: deeplink,
      transactionId: response.body.transactionId ?? transactionId,
      requestId: response.body.requestId,
      // `state` correlates the submission back to the request; verify-service
      // keys this on requestId rather than a separate state value.
      nonce: effectiveNonce,
      state: response.body.requestId,
      responseUri: details.responseUri,
    };
  }

  async awaitResult(ctx: RunContext, request: PresentationRequest): Promise<VerificationOutcome> {
    const base = this.baseUrl(ctx);

    const submitted = await pollUntil({
      description: 'VP submission',
      timeoutMs: 120_000,
      intervalMs: 1_500,
      attempt: async () => {
        const response = await ctx.http<{ status?: string }>({
          label: 'Poll VP Request Status',
          from: 'Playground',
          to: 'Inji Verify',
          url: `${base}/vp-request/${request.requestId}/status`,
          allowNonOk: true,
          // The status endpoint long-polls, so allow a generous read timeout.
          timeoutMs: 35_000,
        });
        return response.body?.status === 'VP_SUBMITTED' ? response.body : undefined;
      },
    });

    if (!submitted) {
      ctx.fail('Inji Verify never reported the presentation as submitted.', 'verifier');
    }

    const result = await ctx.http<{
      transactionId: string;
      allChecksSuccessful?: boolean;
      credentialResults?: Array<Record<string, unknown>>;
    }>({
      label: 'Fetch Verification Result',
      from: 'Playground',
      to: 'Inji Verify',
      url: `${base}/v2/vp-results/${request.transactionId}`,
      json: { skipStatusChecks: false, includeClaims: true },
    });

    ctx.artifact({ label: 'Inji Verify result', kind: 'json', value: result.body });

    const credentialResults = (result.body.credentialResults ?? []).map((entry) => ({
      status: String(entry.verificationStatus ?? entry.status ?? 'UNKNOWN'),
      detail: entry.verificationMessage ? String(entry.verificationMessage) : undefined,
      claims: (entry.claims as Record<string, unknown>) ?? undefined,
    }));

    for (const [index, entry] of credentialResults.entries()) {
      ctx.check({
        id: `verifier.inji.credential-${index}`,
        title: `Inji Verify credential ${index + 1} status`,
        status: entry.status.toUpperCase() === 'SUCCESS' ? 'pass' : 'fail',
        spec: 'Inji Verify verification result',
        detail: entry.detail ?? `verificationStatus = ${entry.status}`,
        attributedTo: entry.status.toUpperCase() === 'SUCCESS' ? undefined : 'wallet',
      });
    }

    return {
      verdict: deriveVerdict(result.body.allChecksSuccessful, credentialResults),
      raw: result.body,
      credentialResults,
    };
  }
}

/**
 * Maps Inji Verify's result onto the playground's three-way verdict.
 *
 * An expired-but-authentic credential is reported distinctly, because a relying
 * party's response to it differs from its response to a forged one.
 */
function deriveVerdict(
  allChecksSuccessful: boolean | undefined,
  credentialResults: Array<{ status: string; detail?: string }>,
): VerificationOutcome['verdict'] {
  if (allChecksSuccessful) return 'valid';

  const statuses = credentialResults.map((r) => r.status.toUpperCase());
  if (statuses.some((status) => status.includes('EXPIRED'))) return 'valid-but-expired';
  if (statuses.length === 0) return 'error';
  return 'invalid';
}
