import type { AuthorizationRequest, CredentialOffer, Participant, PresentationDefinition } from '@interop/shared';
import { PRE_AUTHORIZED_CODE_GRANT } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import { BaseOid4vciIssuer } from './oid4vci-issuer.js';
import type {
  IssueOptions,
  IssuerEndpoints,
  OfferResult,
  PresentOptions,
  PresentationRequest,
  VerificationOutcome,
  VerifierAdapter,
} from './types.js';

/**
 * An OpenID4VCI issuer belonging to somebody else.
 *
 * Configured with a credential offer pasted from any third-party issuer — a
 * Sphereon, walt.id or EUDI reference deployment, or another national stack.
 * Everything after that is the same standards-only path used for Inji Certify,
 * which is the point: it demonstrates interoperability outside the MOSIP
 * ecosystem rather than only within it.
 *
 * Offers are pasted rather than requested because minting one is the step
 * OpenID4VCI does not standardise; every issuer exposes its own API for it.
 */
export class ExternalIssuer extends BaseOid4vciIssuer {
  readonly manifest: Participant;

  constructor() {
    super();
    this.manifest = {
      id: 'external-issuer',
      role: 'issuer',
      label: 'External OpenID4VCI issuer',
      kind: 'external',
      summary:
        'Any third-party issuer. Paste a credential offer from its demo page and the playground redeems it exactly as it would an Inji one.',
      traceability: 'full',
      formats: ['ldp_vc', 'vc+sd-jwt', 'dc+sd-jwt', 'mso_mdoc'],
      specs: ['openid4vci-draft-13', 'openid4vci-1.0'],
      interactive: false,
      config: [
        {
          key: 'credentialOffer',
          label: 'Credential offer (URI or JSON)',
          value: '',
          placeholder: 'openid-credential-offer://?credential_offer_uri=…',
          required: true,
        },
      ],
    };
  }

  /** Discovery targets whatever issuer the pasted offer names. */
  protected baseUrl(ctx: RunContext): string {
    const offer = this.parseOffer(ctx);
    if (!offer.credential_issuer) {
      ctx.fail('The pasted credential offer does not name a credential_issuer.', 'issuer');
    }
    return offer.credential_issuer.replace(/\/$/, '');
  }

  async createOffer(ctx: RunContext, endpoints: IssuerEndpoints): Promise<OfferResult> {
    const offer = this.parseOffer(ctx);
    this.validateOffer(ctx, offer, endpoints.configurationId);

    const grant = offer.grants?.[PRE_AUTHORIZED_CODE_GRANT];
    return {
      offerUri: this.rawOffer(ctx),
      offer,
      preAuthorizedCode: grant?.['pre-authorized_code'],
      txCode: ctx.config.overrides?.[this.manifest.id]?.txCode,
    };
  }

  private rawOffer(ctx: RunContext): string {
    const value = ctx.config.overrides?.[this.manifest.id]?.credentialOffer?.trim();
    if (!value) {
      ctx.fail(
        'No credential offer supplied. Paste one from the external issuer, either the openid-credential-offer:// link or the offer JSON itself.',
        'issuer',
      );
    }
    return value;
  }

  /**
   * Accepts every shape an issuer might hand over: the offer JSON, a deep link
   * carrying it by value, or one carrying a URL to fetch it from.
   */
  private parseOffer(ctx: RunContext): CredentialOffer {
    const raw = this.rawOffer(ctx);
    const cached = ctx.state.get('external-issuer.offer');
    if (cached) return cached as CredentialOffer;

    let offer: CredentialOffer | undefined;

    if (raw.trimStart().startsWith('{')) {
      offer = JSON.parse(raw) as CredentialOffer;
    } else if (raw.includes('credential_offer=')) {
      const query = raw.slice(raw.indexOf('?') + 1);
      const value = new URLSearchParams(query).get('credential_offer');
      if (value) offer = JSON.parse(value) as CredentialOffer;
    }

    if (!offer) {
      ctx.fail(
        'Could not read the credential offer. A by-reference offer (credential_offer_uri) must be dereferenced first — paste the offer JSON itself.',
        'issuer',
      );
    }

    ctx.state.set('external-issuer.offer', offer);
    return offer;
  }
}

/**
 * An OpenID4VP verifier belonging to somebody else.
 *
 * Configured with an authorization request pasted from a third-party verifier's
 * QR code. The playground's wallet answers it for real, but the verdict is
 * rendered on the other party's screen: there is no standard way to read a
 * result back out of an arbitrary verifier, so the run is `endpoint-only` and
 * the operator reports what they saw.
 */
export class ExternalVerifier implements VerifierAdapter {
  readonly manifest: Participant = {
    id: 'external-verifier',
    role: 'verifier',
    label: 'External OpenID4VP verifier',
    kind: 'external',
    summary:
      "Any third-party relying party. Paste its authorization request; the wallet responds for real and you confirm the verdict shown on the verifier's own screen.",
    traceability: 'endpoint-only',
    formats: ['ldp_vc', 'vc+sd-jwt', 'dc+sd-jwt', 'mso_mdoc'],
    specs: ['openid4vp-draft-21', 'openid4vp-draft-23', 'openid4vp-1.0'],
    interactive: true,
    config: [
      {
        key: 'authorizationRequest',
        label: 'Authorization request (URI or JSON)',
        value: '',
        placeholder: 'openid4vp://authorize?client_id=…&request_uri=…',
        required: true,
      },
    ],
  };

  async createRequest(ctx: RunContext, opts: PresentOptions): Promise<PresentationRequest> {
    const raw = ctx.config.overrides?.[this.manifest.id]?.authorizationRequest?.trim();
    if (!raw) {
      ctx.fail('No authorization request supplied. Paste one from the external verifier.', 'verifier');
    }

    const request = await this.resolveRequest(ctx, raw);

    if (!request.response_uri && !request.redirect_uri) {
      ctx.fail('The authorization request names neither response_uri nor redirect_uri, so there is nowhere to send the presentation.', 'verifier');
    }

    ctx.expect(Boolean(request.nonce), {
      id: 'vp.request.nonce',
      title: 'Authorization request carries a nonce',
      spec: 'OpenID4VP §5',
      pass: 'A nonce is present, so the presentation can be bound to this request.',
      fail: 'No nonce in the request. Any presentation produced for it is replayable.',
      attributedTo: 'verifier',
    });

    const definition = request.presentation_definition as PresentationDefinition | undefined;
    ctx.check({
      id: 'vp.request.query',
      title: 'Authorization request states what it wants',
      status: definition || request.dcql_query ? 'pass' : 'warn',
      spec: 'OpenID4VP §5 (presentation_definition / dcql_query)',
      detail: definition
        ? `Presentation Exchange definition "${definition.id}" with ${definition.input_descriptors?.length ?? 0} input descriptor(s).`
        : request.dcql_query
          ? 'Request uses a DCQL query (OpenID4VP 1.0).'
          : 'Neither presentation_definition nor dcql_query is present; the wallet has to guess what to send.',
      attributedTo: definition || request.dcql_query ? undefined : 'verifier',
    });

    ctx.artifact({ label: 'Authorization Request (external)', kind: 'json', value: request });

    return {
      authorizationRequest: request,
      requestUri: raw,
      transactionId: request.state ?? 'external',
      nonce: request.nonce,
      state: request.state ?? '',
      responseUri: (request.response_uri ?? request.redirect_uri) as string,
    };
  }

  /** Reads a request given inline, or fetches one given by reference. */
  private async resolveRequest(ctx: RunContext, raw: string): Promise<AuthorizationRequest> {
    if (raw.trimStart().startsWith('{')) return JSON.parse(raw) as AuthorizationRequest;

    const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw;
    const params = new URLSearchParams(query);
    const requestUri = params.get('request_uri');

    if (requestUri) {
      const response = await ctx.http<unknown>({
        label: 'Fetch Authorization Request',
        from: 'Wallet',
        to: 'Verifier',
        url: requestUri,
        accept: 'application/oauth-authz-req+jwt, application/json',
      });

      // A request object is either a signed JWT or a bare JSON document.
      if (typeof response.body === 'string' && response.body.split('.').length === 3) {
        const payload = response.body.split('.')[1] as string;
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AuthorizationRequest;
      }
      return response.body as AuthorizationRequest;
    }

    const inline: Record<string, unknown> = {};
    for (const [key, value] of params) {
      inline[key] = value.trimStart().startsWith('{') ? JSON.parse(value) : value;
    }
    return inline as unknown as AuthorizationRequest;
  }

  async awaitResult(ctx: RunContext, request: PresentationRequest): Promise<VerificationOutcome> {
    const answer = (await ctx.awaitUserAction({
      step: 'verify',
      title: 'Read the verdict from the external verifier',
      instructions:
        'The presentation has been posted to the external verifier. There is no standard way to read a result back from an arbitrary relying party, so check its screen and confirm below what it reported.',
      uri: request.responseUri,
    })) as { verdict?: VerificationOutcome['verdict'] } | undefined;

    const verdict = answer?.verdict ?? 'valid';
    ctx.check({
      id: 'verifier.external.self-reported',
      title: 'Verdict was read from the external verifier',
      status: 'warn',
      spec: 'Playground observability',
      detail: `Reported as "${verdict}" by the operator. This is the one result in the report that the playground did not observe for itself.`,
    });

    return { verdict, raw: { reportedBy: 'operator', verdict }, message: 'Operator-reported verdict.' };
  }
}
