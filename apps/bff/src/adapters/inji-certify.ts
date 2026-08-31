import type { CredentialOffer, Participant } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import { DEFAULT_CLAIMS } from '../core/credentials.js';
import { BaseOid4vciIssuer } from './oid4vci-issuer.js';
import type { IssueOptions, IssuerEndpoints, OfferResult } from './types.js';

/**
 * Issuer adapter for Inji Certify.
 *
 * Discovery and issuance are the shared OpenID4VCI path; only offer creation is
 * Certify-specific. Certify exposes `POST /pre-authorized-data`, which returns a
 * `credentialOfferUri` pointing at `GET /credential-offer-data/{id}` — a
 * proprietary shape wrapping a standard offer, so the offer is dereferenced here
 * and then validated by exactly the same checks as any other issuer's.
 */
export class InjiCertifyIssuer extends BaseOid4vciIssuer {
  readonly manifest: Participant;

  constructor(defaults: { baseUrl: string; credentialConfigurationId: string }) {
    super();
    this.manifest = {
      id: 'inji-certify',
      role: 'issuer',
      label: 'Inji Certify',
      kind: 'inji',
      summary:
        'MOSIP Inji Certify issuing over OpenID4VCI via the pre-authorized code grant. Point it at a local Docker Compose stack or the Collab sandbox.',
      traceability: 'full',
      formats: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'],
      specs: ['openid4vci-draft-13', 'openid4vci-1.0'],
      interactive: false,
      config: [
        {
          key: 'baseUrl',
          label: 'Certify base URL',
          value: defaults.baseUrl,
          placeholder: 'http://localhost:8090/v1/certify',
          required: true,
        },
        {
          key: 'credentialConfigurationId',
          label: 'Credential configuration id',
          value: defaults.credentialConfigurationId,
          placeholder: 'InjiTestCredential',
          required: false,
        },
      ],
    };
  }

  protected baseUrl(ctx: RunContext): string {
    const configured = ctx.config.overrides?.[this.manifest.id]?.baseUrl ?? this.defaultConfig('baseUrl');
    return configured.replace(/\/$/, '');
  }

  private defaultConfig(key: string): string {
    return this.manifest.config.find((field) => field.key === key)?.value ?? '';
  }

  async createOffer(ctx: RunContext, endpoints: IssuerEndpoints, opts: IssueOptions): Promise<OfferResult> {
    const configurationId =
      ctx.config.overrides?.[this.manifest.id]?.credentialConfigurationId ||
      endpoints.configurationId;

    const created = await ctx.http<{ credentialOfferUri?: string; credential_offer_uri?: string }>({
      label: 'Create Pre-Authorized Offer (Certify)',
      from: 'Playground',
      to: 'Inji Certify',
      url: `${this.baseUrl(ctx)}/pre-authorized-data`,
      json: {
        credential_configuration_id: configurationId,
        claims: Object.keys(opts.claims).length > 0 ? opts.claims : DEFAULT_CLAIMS,
        expires_in: 600,
      },
    });

    const offerUri = created.body.credentialOfferUri ?? created.body.credential_offer_uri;
    if (!offerUri) {
      ctx.fail(
        'Certify returned no credentialOfferUri from /pre-authorized-data. Check that the credential configuration id exists and that the pre-authorized code plugin is enabled.',
        'issuer',
      );
    }

    // The URI Certify returns may be a `openid-credential-offer://` deep link
    // wrapping the real fetch URL, so unwrap before dereferencing.
    const fetchUrl = extractOfferUri(offerUri) ?? offerUri;

    const fetched = await ctx.http<CredentialOffer>({
      label: 'Fetch Credential Offer',
      from: 'Playground',
      to: 'Inji Certify',
      url: fetchUrl,
    });

    const offer = fetched.body;
    this.validateOffer(ctx, offer, endpoints.configurationId);

    return {
      offerUri,
      offer,
      preAuthorizedCode:
        offer.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code']?.['pre-authorized_code'],
    };
  }
}

/** Pulls the `credential_offer_uri` out of a deep link, if that is what we got. */
function extractOfferUri(value: string): string | undefined {
  if (!value.includes('credential_offer_uri=')) return undefined;
  try {
    const query = value.slice(value.indexOf('?') + 1);
    return new URLSearchParams(query).get('credential_offer_uri') ?? undefined;
  } catch {
    return undefined;
  }
}
