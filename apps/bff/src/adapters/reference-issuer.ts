import type { CredentialOffer, Participant } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import { BaseOid4vciIssuer } from './oid4vci-issuer.js';
import type { IssueOptions, IssuerEndpoints, OfferResult } from './types.js';
import { playgroundVersion } from '../core/versions.js';

/**
 * Issuer adapter for the playground's own OpenID4VCI service.
 *
 * Its value is as a control: when a run fails with this issuer on one side, the
 * problem is almost certainly on the other, because this implementation is
 * verified against the specification and nothing else.
 */
export class ReferenceIssuer extends BaseOid4vciIssuer {
  /** Hosted by the playground, so its version is this repository's. */
  async discoverVersion(): Promise<{ value?: string; detail: string }> {
    return playgroundVersion();
  }

  readonly manifest: Participant;

  constructor(private readonly publicUrl: string) {
    super();
    this.manifest = {
      id: 'reference-issuer',
      role: 'issuer',
      label: 'Reference Issuer (OpenID4VCI)',
      kind: 'mock',
      summary:
        'A specification-only OpenID4VCI issuer hosted by the playground. Issues W3C VC JSON-LD, SD-JWT VC and ISO 18013-5 mdoc with real signatures.',
      traceability: 'full',
      formats: ['ldp_vc', 'vc+sd-jwt', 'dc+sd-jwt', 'mso_mdoc'],
      specs: ['openid4vci-draft-11', 'openid4vci-draft-12', 'openid4vci-draft-13', 'openid4vci-1.0'],
      interactive: false,
      config: [
        {
          key: 'baseUrl',
          label: 'Issuer base URL',
          value: new URL('/mock-issuer', publicUrl).toString(),
          required: true,
        },
      ],
    };
  }

  protected baseUrl(ctx: RunContext): string {
    return (
      ctx.config.overrides?.[this.manifest.id]?.baseUrl ??
      new URL('/mock-issuer', this.publicUrl).toString()
    );
  }

  async createOffer(ctx: RunContext, endpoints: IssuerEndpoints, opts: IssueOptions): Promise<OfferResult> {
    const response = await ctx.http<{
      credential_offer: CredentialOffer;
      credential_offer_uri: string;
      offer_deeplink: string;
    }>({
      label: 'Create Credential Offer',
      from: 'Playground',
      to: 'Issuer',
      url: `${this.baseUrl(ctx).replace(/\/$/, '')}/offers`,
      json: {
        format: opts.format,
        proofType: opts.proofType,
        vcVersion: ctx.config.vcVersion ?? '1.1',
        issuerKeyReference: ctx.config.issuerKeyReference ?? 'did',
        grantType: ctx.config.grantType ?? 'pre-authorized_code',
        claims: opts.claims,
        tamper: ctx.config.tamper,
      },
    });

    const offer = response.body.credential_offer;
    this.validateOffer(ctx, offer, endpoints.configurationId);

    return {
      offerUri: response.body.offer_deeplink,
      offer,
      preAuthorizedCode:
        offer.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code']?.['pre-authorized_code'],
    };
  }
}
