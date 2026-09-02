import type { CredentialIssuerMetadata, CredentialOffer, Participant } from '@interop/shared';
import { PRE_AUTHORIZED_CODE_GRANT } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import { discoverFromActuator } from '../core/versions.js';
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
      specs: ['openid4vci-draft-11', 'openid4vci-draft-12', 'openid4vci-draft-13', 'openid4vci-1.0'],
      interactive: false,
      config: [
        {
          key: 'baseUrl',
          label: 'Credential issuer URL',
          value: defaults.baseUrl,
          placeholder: 'http://localhost:8091',
          required: true,
        },
        {
          key: 'apiBaseUrl',
          label: 'Certify API base URL',
          value: '',
          placeholder: 'derived from credential_endpoint',
          required: false,
        },
        {
          key: 'version',
          label: 'Version label (if the service will not report one)',
          value: '',
          placeholder: 'e.g. 0.14.0',
          required: false,
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

  /**
   * Base path of Certify's own API, which is not the credential issuer
   * identifier.
   *
   * Certify is served under a context path (`/v1/certify`) while its issuer
   * identifier is the origin, because OpenID4VCI requires the metadata document
   * at the origin's `.well-known`. Derived from `credential_endpoint` so that a
   * deployment using a different context path still works.
   */
  private apiBaseUrl(ctx: RunContext, metadata: CredentialIssuerMetadata): string {
    const configured = ctx.config.overrides?.[this.manifest.id]?.apiBaseUrl || this.defaultConfig('apiBaseUrl');
    if (configured) return configured.replace(/\/$/, '');

    const credentialEndpoint = metadata.credential_endpoint ?? '';
    const marker = credentialEndpoint.lastIndexOf('/issuance/credential');
    if (marker > 0) return credentialEndpoint.slice(0, marker);

    const fallback = credentialEndpoint.replace(/\/credential$/, '');
    return fallback && fallback !== credentialEndpoint ? fallback : `${this.baseUrl(ctx)}/v1/certify`;
  }

  /**
   * Certify advertises an external authorization server, but a pre-authorized
   * code it minted itself can only be redeemed against its own token endpoint.
   *
   * Following RFC 8414 metadata here would send the code to a remote eSignet
   * that has never heard of it. The mismatch is reported rather than hidden,
   * because a third-party wallet doing the conformant thing would fail.
   */
  protected override async resolveTokenEndpoint(
    ctx: RunContext,
    base: string,
    metadata: CredentialIssuerMetadata,
  ): Promise<string> {
    const apiBase = this.apiBaseUrl(ctx, metadata);
    const issuerOrigin = safeOrigin(metadata.credential_issuer ?? base);

    // Certify publishes RFC 8414 metadata under its own context path. The
    // issuer identifier is the origin, and the shipped nginx front end does not
    // proxy `/.well-known/oauth-authorization-server` there, so discovery at the
    // location the specification names returns 404.
    const advertised = await ctx.http<{ token_endpoint?: string; grant_types_supported?: string[] }>({
      label: 'Authorization Server Metadata Discovery (Certify context path)',
      from: 'Playground',
      to: 'Inji Certify',
      url: `${apiBase}/.well-known/oauth-authorization-server`,
      allowNonOk: true,
    });

    const rootReachable = await ctx.http({
      label: 'Authorization Server Metadata Discovery (issuer origin)',
      from: 'Playground',
      to: 'Inji Certify',
      url: `${base.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
      allowNonOk: true,
    });

    ctx.check({
      id: 'vci.as.metadata-at-issuer',
      title: 'Authorization server metadata is served at the issuer identifier',
      status: rootReachable.ok ? 'pass' : 'fail',
      spec: 'RFC 8414 §3, OpenID4VCI §11.2.1',
      detail: rootReachable.ok
        ? 'The issuer origin serves /.well-known/oauth-authorization-server.'
        : `The issuer identifier is ${metadata.credential_issuer ?? base} but /.well-known/oauth-authorization-server there returns ${rootReachable.status}. It is served under the service context path instead (${apiBase}), which a wallet following RFC 8414 will not find.`,
      attributedTo: rootReachable.ok ? undefined : 'issuer',
    });

    const tokenEndpoint = advertised.ok ? advertised.body?.token_endpoint : undefined;

    if (tokenEndpoint) {
      const supportsPreAuth = advertised.body?.grant_types_supported?.includes(PRE_AUTHORIZED_CODE_GRANT);
      ctx.check({
        id: 'vci.as.pre-authorized-grant',
        title: 'Authorization server advertises the pre-authorized code grant',
        status: supportsPreAuth ? 'pass' : 'warn',
        spec: 'OpenID4VCI §3.5, RFC 8414',
        detail: supportsPreAuth
          ? 'grant_types_supported includes urn:ietf:params:oauth:grant-type:pre-authorized_code.'
          : `grant_types_supported is ${JSON.stringify(advertised.body?.grant_types_supported ?? null)}.`,
      });

      // A pre-authorized code minted by this Certify can only be redeemed by
      // this Certify. If metadata points elsewhere, a conformant wallet would
      // present the code to a server that never issued it.
      const tokenOrigin = safeOrigin(tokenEndpoint);
      if (issuerOrigin && tokenOrigin && issuerOrigin !== tokenOrigin) {
        const local = `${apiBase}/oauth/token`;
        ctx.check({
          id: 'vci.as.token-endpoint-locality',
          title: "Advertised token endpoint can redeem this issuer's pre-authorized codes",
          status: 'fail',
          spec: 'OpenID4VCI §3.5 / RFC 8414',
          detail:
            `Metadata advertises ${tokenEndpoint}, on a different origin from the issuer that minted the pre-authorized ` +
            `code (${issuerOrigin}). A wallet following the metadata would present the code to a server that never issued ` +
            `it. The playground redeems against ${local} so the run can continue.`,
          attributedTo: 'issuer',
        });
        return local;
      }

      ctx.check({
        id: 'vci.as.token-endpoint-locality',
        title: "Advertised token endpoint can redeem this issuer's pre-authorized codes",
        status: 'pass',
        spec: 'OpenID4VCI §3.5 / RFC 8414',
        detail: `Token endpoint ${tokenEndpoint} is on the same origin as the credential issuer.`,
      });
      return tokenEndpoint;
    }

    const fallback = `${apiBase}/oauth/token`;
    ctx.check({
      id: 'vci.as.metadata',
      title: 'Authorization server metadata is published',
      status: 'warn',
      spec: 'RFC 8414',
      detail: `No usable authorization server metadata; falling back to ${fallback}.`,
      attributedTo: 'issuer',
    });
    return fallback;
  }

  /** Certify's actuator lives under the service context path. */
  async discoverVersion(ctx: RunContext): Promise<{ value?: string; detail: string }> {
    return discoverFromActuator(ctx, `${this.baseUrl(ctx)}/v1/certify/actuator/info`, 'Inji Certify');
  }

  /** Certify serves its JWKS under the service context path, not the origin. */
  protected override async probeAlternateKeyLocation(ctx: RunContext, base: string): Promise<void> {
    const alternate = `${base.replace(/\/$/, '')}/v1/certify/.well-known/jwks.json`;
    const response = await ctx.http<{ keys?: unknown[] }>({
      label: 'Fetch Issuer JWKS (context path)',
      from: 'Playground',
      to: 'Inji Certify',
      url: alternate,
      allowNonOk: true,
    });

    const count = response.ok && Array.isArray(response.body?.keys) ? response.body.keys.length : 0;
    if (count === 0) return;

    ctx.check({
      id: 'vci.issuer.key-material-location',
      title: 'Key material is published where a verifier will look for it',
      status: 'fail',
      spec: 'RFC 7517 / OpenID4VCI §11.2.1',
      detail: `${count} key(s) are published at ${alternate}, under the service context path rather than at the credential issuer identifier. The keys exist; a verifier resolving them from the issuer identifier will not find them.`,
      attributedTo: 'issuer',
    });
  }

  async createOffer(ctx: RunContext, endpoints: IssuerEndpoints, opts: IssueOptions): Promise<OfferResult> {
    const apiBase = this.apiBaseUrl(ctx, endpoints.metadata);
    const configurationId =
      ctx.config.overrides?.[this.manifest.id]?.credentialConfigurationId || endpoints.configurationId;

    const claims = this.mapClaims(ctx, endpoints, configurationId, opts.claims);

    const created = await ctx.http<{ credentialOfferUri?: string; credential_offer_uri?: string }>({
      label: 'Create Pre-Authorized Offer (Certify)',
      from: 'Playground',
      to: 'Inji Certify',
      url: `${apiBase}/pre-authorized-data`,
      json: {
        credential_configuration_id: configurationId,
        claims,
        expires_in: 600,
      },
    });

    const offerUri = created.body.credentialOfferUri ?? created.body.credential_offer_uri;
    if (!offerUri) {
      ctx.fail(
        'Certify returned no credential offer URI from /pre-authorized-data. Check that the credential configuration id exists and that `credentialOfferCache` is present in mosip.certify.cache.names.',
        'issuer',
      );
    }

    // The URI Certify returns is a `openid-credential-offer://` deep link
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

  /**
   * Reshapes the run's claims onto the exact key set Certify advertises.
   *
   * Certify rejects any claim outside `credential_definition.credentialSubject`
   * with `unknown_claims`, so a generic claim set cannot be sent through
   * unaltered. Rather than hard-coding one deployment's field names, the
   * advertised keys are read from metadata and filled from the run's claims
   * where the names line up. The mapping is reported, because a claim that had
   * to be invented is a claim the credential does not really attest.
   */
  private mapClaims(
    ctx: RunContext,
    endpoints: IssuerEndpoints,
    configurationId: string,
    requested: Record<string, unknown>,
  ): Record<string, unknown> {
    const configuration = endpoints.metadata.credential_configurations_supported?.[configurationId];
    const advertised = configuration?.credential_definition?.credentialSubject;

    if (!advertised || typeof advertised !== 'object') {
      ctx.check({
        id: 'vci.claims.advertised',
        title: 'Issuer advertises the claims it accepts',
        status: 'warn',
        spec: 'OpenID4VCI §11.2.3',
        detail:
          'The credential configuration declares no credentialSubject, so the playground cannot tell which claims are accepted and sends its own set unchanged.',
        attributedTo: 'issuer',
      });
      return requested;
    }

    const keys = Object.keys(advertised);
    const claims: Record<string, unknown> = {};
    const matched: string[] = [];
    const substituted: string[] = [];

    for (const key of keys) {
      if (key in requested) {
        claims[key] = requested[key];
        matched.push(key);
      } else {
        claims[key] = SAMPLE_CLAIM_VALUES[key] ?? `sample-${key}`;
        substituted.push(key);
      }
    }

    const dropped = Object.keys(requested).filter((key) => !keys.includes(key));

    ctx.check({
      id: 'vci.claims.mapping',
      title: 'Requested claims map onto the claims the issuer advertises',
      status: dropped.length === 0 && substituted.length === 0 ? 'pass' : 'warn',
      spec: 'OpenID4VCI §11.2.3',
      detail: [
        matched.length > 0 ? `Sent as requested: ${matched.join(', ')}.` : '',
        substituted.length > 0 ? `Filled with sample values because the run did not supply them: ${substituted.join(', ')}.` : '',
        dropped.length > 0
          ? `Dropped because the issuer does not advertise them and rejects unknown claims: ${dropped.join(', ')}.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    });

    return claims;
  }
}

/** Stand-in values for claims a deployment advertises but the run did not set. */
const SAMPLE_CLAIM_VALUES: Record<string, unknown> = {
  fullName: 'Ada Lovelace',
  name: 'Ada Lovelace',
  givenName: 'Ada',
  familyName: 'Lovelace',
  dateOfBirth: '1815-12-10',
  gender: 'Female',
  phone: '9876543210',
  mobileNumber: '9876543210',
  email: 'ada@example.org',
  nationality: 'GB',
};

/** Origin of a URL, or undefined when it cannot be parsed. */
function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
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
