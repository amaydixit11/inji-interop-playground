import { randomUUID, randomBytes } from 'node:crypto';
import type { AuthorizationRequest, Participant, PresentationDefinition } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import { buildPresentationDefinition } from '../services/mock-verifier.js';
import { pollUntil } from '../core/poll.js';
import type {
  HeldCredential,
  PresentOptions,
  PresentationRequest,
  VerificationOutcome,
  VerifierAdapter,
} from './types.js';

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
        'The /vp-request response is a camelCase envelope (clientId, responseUri, presentationDefinition) rather than the specified client_id, response_uri and presentation_definition. This affects only a caller wiring a wallet against that API directly — the request object served at the request_uri does use the specified names, so the normal cross-device path is unaffected.',
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

    await this.inspectRequestObject(ctx, base, response.body.requestId);

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

  /**
   * Submits the credential to verify-service on its own, via
   * `POST /v2/vc-verification`.
   *
   * The v2 endpoint is used rather than v1 because v1 answers only
   * `{"verificationStatus":"INVALID"}` with no reason, which is not enough to
   * act on. v2 returns the individual check that failed and its error code.
   */
  async verifyCredentialDirectly(ctx: RunContext, held: HeldCredential): Promise<void> {
    const base = this.baseUrl(ctx);
    const credential = typeof held.raw === 'string' ? held.raw : JSON.stringify(held.raw);

    const response = await ctx.http<{
      allChecksSuccessful?: boolean;
      schemaAndSignatureCheck?: { valid?: boolean; error?: { errorCode?: string; errorMessage?: string } };
      expiryCheck?: { valid?: boolean } | null;
      statusCheck?: unknown[];
      claims?: Record<string, unknown>;
    }>({
      label: 'Direct Credential Verification',
      from: 'Playground',
      to: 'Inji Verify',
      url: `${base}/v2/vc-verification`,
      json: { verifiableCredential: credential, includeClaims: true, skipStatusChecks: false },
      allowNonOk: true,
    });

    if (!response.ok) {
      ctx.check({
        id: 'verifier.direct.reachable',
        title: 'Verifier can be asked to verify a credential on its own',
        status: 'warn',
        spec: 'Inji Verify /v2/vc-verification',
        detail: `The endpoint returned HTTP ${response.status}. Only the presentation path can be exercised against this deployment.`,
      });
      return;
    }

    const signatureCheck = response.body.schemaAndSignatureCheck;
    const ok = signatureCheck?.valid === true;

    ctx.check({
      id: 'verifier.direct.credential',
      title: 'Verifier accepts the issued credential on its own',
      status: ok ? 'pass' : 'fail',
      spec: 'W3C VC Data Model / Inji Verify credential verification',
      detail: ok
        ? 'verify-service verified the credential outside any presentation, so the credential itself is readable by this verifier.'
        : `verify-service rejected the credential before any presentation was involved: ${
            signatureCheck?.error?.errorCode ?? 'unknown'
          } — ${signatureCheck?.error?.errorMessage ?? 'no detail given'}. Whatever happens in the OpenID4VP exchange, the credential itself cannot be read by this verifier.`,
      attributedTo: ok ? undefined : 'issuer',
    });

    ctx.artifact({ label: 'Direct verification result (Inji Verify)', kind: 'json', value: response.body });
  }

  /**
   * Fetches the request object verify-service publishes at
   * `GET /vp-request/{requestId}`.
   *
   * OpenID4VP lets a verifier pass its request by reference, and a signed
   * request object is what lets a wallet trust that the request really came
   * from the client id it names. Whether this deployment signs it, and whether
   * the object uses the specified parameter names, both matter to any wallet
   * that follows the `request_uri`.
   */
  private async inspectRequestObject(ctx: RunContext, base: string, requestId: string): Promise<void> {
    const response = await ctx.http<unknown>({
      label: 'Fetch Request Object',
      from: 'Wallet',
      to: 'Inji Verify',
      url: `${base}/vp-request/${requestId}`,
      accept: 'application/oauth-authz-req+jwt',
      allowNonOk: true,
    });

    if (!response.ok) {
      ctx.check({
        id: 'vp.request-object.available',
        title: 'Request object is retrievable by reference',
        status: 'warn',
        spec: 'OpenID4VP §5.10 (request_uri)',
        detail: `GET /vp-request/${requestId} returned HTTP ${response.status}. A wallet handed a request_uri would have nothing to fetch, so only by-value requests work against this deployment.`,
        attributedTo: 'verifier',
      });
      return;
    }

    const raw = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
    const isJwt = raw.split('.').length === 3 && !raw.trimStart().startsWith('{');

    ctx.check({
      id: 'vp.request-object.signed',
      title: 'Request object is a signed JWT',
      status: isJwt ? 'pass' : 'warn',
      spec: 'OpenID4VP §5.10, JAR (RFC 9101)',
      detail: isJwt
        ? 'The request object is a JWS, so a wallet can establish that the request came from the client it names.'
        : 'The request object is returned unsigned. A wallet cannot tell whether the request genuinely came from the client id it carries, which matters most in exactly the cross-device flow request_uri exists for.',
      attributedTo: isJwt ? undefined : 'verifier',
    });

    if (isJwt) {
      try {
        const payload = JSON.parse(
          Buffer.from(raw.split('.')[1] as string, 'base64url').toString('utf8'),
        ) as Record<string, unknown>;
        ctx.artifact({ label: 'Request object (decoded)', kind: 'json', value: payload });

        const missing = ['client_id', 'response_uri', 'nonce', 'response_type'].filter((key) => !(key in payload));
        ctx.check({
          id: 'vp.request-object.parameters',
          title: 'Request object uses the specified parameter names',
          status: missing.length === 0 ? 'pass' : 'fail',
          spec: 'OpenID4VP §5',
          detail:
            missing.length === 0
              ? 'All required parameters are present under their specified names.'
              : `Missing from the request object: ${missing.join(', ')}. Present keys: ${Object.keys(payload).join(', ')}.`,
          attributedTo: missing.length === 0 ? undefined : 'verifier',
        });
      } catch {
        ctx.check({
          id: 'vp.request-object.parameters',
          title: 'Request object uses the specified parameter names',
          status: 'warn',
          spec: 'OpenID4VP §5',
          detail: 'The request object payload could not be decoded as JSON.',
        });
      }
    } else {
      ctx.artifact({ label: 'Request object (raw)', kind: 'text', value: raw });
    }
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
      credentialResults?: Array<{
        allChecksSuccessful?: boolean;
        schemaAndSignatureCheck?: { valid?: boolean; error?: { errorCode?: string; errorMessage?: string } };
        expiryCheck?: { valid?: boolean } | null;
        statusCheck?: unknown[];
        holderProofCheck?: { valid?: boolean; error?: { errorCode?: string; errorMessage?: string } } | null;
        claims?: Record<string, unknown>;
      }>;
    }>({
      label: 'Fetch Verification Result',
      from: 'Playground',
      to: 'Inji Verify',
      url: `${base}/v2/vp-results/${request.transactionId}`,
      json: { skipStatusChecks: false, includeClaims: true },
    });

    ctx.artifact({ label: 'Inji Verify result', kind: 'json', value: result.body });

    const credentialResults = result.body.credentialResults ?? [];

    // Each sub-check is surfaced separately rather than collapsed into the
    // verdict. verify-service reports them individually, and which ones it did
    // *not* run is as informative as the ones that passed.
    for (const [index, entry] of credentialResults.entries()) {
      const prefix = credentialResults.length > 1 ? `credential ${index + 1}: ` : '';

      report(ctx, `verifier.inji.signature-${index}`, `${prefix}Signature and schema`, entry.schemaAndSignatureCheck);
      report(ctx, `verifier.inji.holder-proof-${index}`, `${prefix}Holder proof`, entry.holderProofCheck);

      if (entry.expiryCheck) {
        ctx.check({
          id: `verifier.inji.expiry-${index}`,
          title: `${prefix}Within validity period`,
          status: entry.expiryCheck.valid ? 'pass' : 'warn',
          spec: 'Inji Verify credential verification',
          detail: entry.expiryCheck.valid ? 'Inji Verify found the credential in date.' : 'Inji Verify reports the credential as expired.',
        });
      }

      // An empty status list is not the same as a clean one: verify-service
      // logs that status checking is unsupported for some formats and returns
      // nothing, which reads identically to "checked, and fine".
      const statusChecks = entry.statusCheck ?? [];
      ctx.check({
        id: `verifier.inji.status-${index}`,
        title: `${prefix}Revocation status was checked`,
        status: statusChecks.length > 0 ? 'pass' : 'warn',
        spec: 'W3C Bitstring Status List / IETF Token Status List',
        detail:
          statusChecks.length > 0
            ? `verify-service ran ${statusChecks.length} status check(s).`
            : 'verify-service returned an empty status list. Its log reports status checking as unsupported for this credential format, so a revoked credential would be accepted.',
        attributedTo: statusChecks.length > 0 ? undefined : 'verifier',
      });
    }

    const verdict = deriveVerdict(result.body.allChecksSuccessful, credentialResults);

    return {
      verdict,
      raw: result.body,
      credentialResults: credentialResults.map((entry) => ({
        status: entry.allChecksSuccessful ? 'SUCCESS' : 'FAILED',
        detail: entry.schemaAndSignatureCheck?.error?.errorMessage,
        claims: entry.claims,
      })),
    };
  }
}

/** Records one of verify-service's sub-checks, when it reported that check. */
function report(
  ctx: RunContext,
  id: string,
  title: string,
  check: { valid?: boolean; error?: { errorCode?: string; errorMessage?: string } } | null | undefined,
): void {
  if (!check) return;
  ctx.check({
    id,
    title: `Inji Verify: ${title}`,
    status: check.valid ? 'pass' : 'fail',
    spec: 'Inji Verify credential verification',
    detail: check.valid
      ? 'Reported valid by verify-service.'
      : `${check.error?.errorCode ?? 'failed'} — ${check.error?.errorMessage ?? 'no detail given'}`,
    attributedTo: check.valid ? undefined : 'issuer',
  });
}

/**
 * Maps verify-service's result onto the playground's three-way verdict.
 *
 * Reads `allChecksSuccessful`, which is the field verify-service actually sets.
 * An earlier version looked for `verificationStatus`, which the v2 response does
 * not carry — so a fully successful verification was reported as UNKNOWN and
 * counted as a failure. Worth remembering: a result mapped from the wrong field
 * name looks exactly like the other party being broken.
 */
function deriveVerdict(
  allChecksSuccessful: boolean | undefined,
  credentialResults: Array<{ allChecksSuccessful?: boolean; expiryCheck?: { valid?: boolean } | null }>,
): VerificationOutcome['verdict'] {
  if (allChecksSuccessful) return 'valid';
  if (credentialResults.length === 0) return 'error';

  // Everything sound except the validity window is a distinct outcome, and the
  // only one a holder can do anything about.
  const onlyExpired = credentialResults.every(
    (entry) => entry.expiryCheck && entry.expiryCheck.valid === false,
  );
  if (onlyExpired) return 'valid-but-expired';

  return 'invalid';
}
