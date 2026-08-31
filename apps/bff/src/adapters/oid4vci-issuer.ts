import type {
  CredentialFormat,
  CredentialIssuerMetadata,
  CredentialOffer,
  Participant,
} from '@interop/shared';
import { PRE_AUTHORIZED_CODE_GRANT } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import type { IssueOptions, IssuerAdapter, IssuerEndpoints, OfferResult } from './types.js';

/**
 * Shared OpenID4VCI issuer behaviour: metadata discovery plus the conformance
 * checks that apply to any issuer regardless of vendor.
 *
 * Only offer creation is left to subclasses, because that step is the one the
 * specification does not define — every issuer exposes its own proprietary way
 * to mint an offer from its own business data.
 */
export abstract class BaseOid4vciIssuer implements IssuerAdapter {
  abstract manifest: Participant;

  protected abstract baseUrl(ctx: RunContext): string;

  abstract createOffer(
    ctx: RunContext,
    endpoints: IssuerEndpoints,
    opts: IssueOptions,
  ): Promise<OfferResult>;

  async discover(ctx: RunContext, opts: IssueOptions): Promise<IssuerEndpoints> {
    const base = this.baseUrl(ctx).replace(/\/$/, '');

    const metadataResponse = await ctx.http<CredentialIssuerMetadata>({
      label: 'Issuer Metadata Discovery',
      from: 'Playground',
      to: 'Issuer',
      url: `${base}/.well-known/openid-credential-issuer`,
    });
    const metadata = metadataResponse.body;

    ctx.artifact({ label: 'Credential Issuer Metadata', kind: 'json', value: metadata });

    ctx.expect(Boolean(metadata.credential_endpoint), {
      id: 'vci.metadata.credential-endpoint',
      title: 'Metadata advertises a credential endpoint',
      spec: 'OpenID4VCI §11.2.3',
      pass: `credential_endpoint is ${metadata.credential_endpoint}.`,
      fail: 'Metadata contains no credential_endpoint, so a wallet cannot request a credential.',
      attributedTo: 'issuer',
    });

    const configurations = metadata.credential_configurations_supported;
    ctx.check({
      id: 'vci.metadata.configurations',
      title: 'Metadata uses the draft-13+ credential_configurations_supported shape',
      status: configurations ? 'pass' : 'fail',
      spec: 'OpenID4VCI §11.2.3',
      detail: configurations
        ? `${Object.keys(configurations).length} credential configuration(s) advertised.`
        : 'No credential_configurations_supported. Pre-draft-13 issuers use `credentials_supported`, which wallets built to draft 13 or later will not read.',
      attributedTo: configurations ? undefined : 'issuer',
    });

    const configurationId = this.selectConfiguration(ctx, metadata, opts.format);
    const tokenEndpoint = await this.resolveTokenEndpoint(ctx, base, metadata);

    return {
      credentialIssuer: metadata.credential_issuer ?? base,
      credentialEndpoint: metadata.credential_endpoint ?? `${base}/credential`,
      tokenEndpoint,
      nonceEndpoint: metadata.nonce_endpoint,
      jwksUri: `${base}/.well-known/jwks.json`,
      didDocumentUrl: `${base}/.well-known/did.json`,
      metadata,
      configurationId,
    };
  }

  /** Picks the advertised configuration that provides the requested format. */
  protected selectConfiguration(
    ctx: RunContext,
    metadata: CredentialIssuerMetadata,
    format: CredentialFormat,
  ): string {
    const configurations = metadata.credential_configurations_supported ?? {};
    const match = Object.entries(configurations).find(([, config]) => config.format === format);

    if (!match) {
      const advertised = [...new Set(Object.values(configurations).map((c) => c.format))];
      ctx.check({
        id: 'vci.metadata.format-supported',
        title: 'Issuer advertises the requested credential format',
        status: 'fail',
        spec: 'OpenID4VCI §11.2.3',
        detail: `Requested "${format}" but the issuer advertises only: ${advertised.join(', ') || '(none)'}.`,
        attributedTo: 'issuer',
      });
      ctx.fail(
        `The issuer does not advertise the ${format} format. Advertised formats: ${advertised.join(', ') || 'none'}.`,
        'issuer',
      );
    }

    ctx.check({
      id: 'vci.metadata.format-supported',
      title: 'Issuer advertises the requested credential format',
      status: 'pass',
      spec: 'OpenID4VCI §11.2.3',
      detail: `Configuration "${match[0]}" provides format "${format}".`,
    });

    return match[0];
  }

  /**
   * Finds the token endpoint, following the authorization server metadata when
   * the issuer delegates authorization elsewhere (as Certify does to eSignet).
   */
  protected async resolveTokenEndpoint(
    ctx: RunContext,
    base: string,
    metadata: CredentialIssuerMetadata,
  ): Promise<string> {
    const authorizationServer = metadata.authorization_servers?.[0] ?? base;

    const response = await ctx.http<{ token_endpoint?: string; grant_types_supported?: string[] }>({
      label: 'Authorization Server Metadata Discovery',
      from: 'Playground',
      to: 'Authorization Server',
      url: `${authorizationServer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
      allowNonOk: true,
    });

    if (response.ok && response.body?.token_endpoint) {
      const supportsPreAuth = response.body.grant_types_supported?.includes(PRE_AUTHORIZED_CODE_GRANT);
      ctx.check({
        id: 'vci.as.pre-authorized-grant',
        title: 'Authorization server advertises the pre-authorized code grant',
        status: supportsPreAuth ? 'pass' : 'warn',
        spec: 'OpenID4VCI §3.5, RFC 8414',
        detail: supportsPreAuth
          ? 'grant_types_supported includes urn:ietf:params:oauth:grant-type:pre-authorized_code.'
          : `grant_types_supported is ${JSON.stringify(response.body.grant_types_supported ?? null)}. The playground will still attempt the grant, since some servers support it without advertising it.`,
      });
      return response.body.token_endpoint;
    }

    // Falling back rather than failing: several deployments serve a working
    // token endpoint without publishing RFC 8414 metadata for it.
    const fallback = `${base}/oauth/token`;
    ctx.check({
      id: 'vci.as.metadata',
      title: 'Authorization server metadata is published',
      status: 'warn',
      spec: 'RFC 8414',
      detail: `No usable /.well-known/oauth-authorization-server at ${authorizationServer}. Falling back to ${fallback}.`,
      attributedTo: 'issuer',
    });
    return fallback;
  }

  /** Shared validation of an offer, whoever produced it. */
  protected validateOffer(ctx: RunContext, offer: CredentialOffer, expectedConfigurationId: string): void {
    ctx.artifact({ label: 'Credential Offer', kind: 'json', value: offer });

    ctx.expect(Boolean(offer.credential_issuer), {
      id: 'vci.offer.issuer',
      title: 'Offer names the credential issuer',
      spec: 'OpenID4VCI §4.1.1',
      pass: `credential_issuer is ${offer.credential_issuer}.`,
      fail: 'Offer has no credential_issuer, so a wallet cannot discover where to redeem it.',
      attributedTo: 'issuer',
    });

    const ids = offer.credential_configuration_ids;
    ctx.check({
      id: 'vci.offer.configuration-ids',
      title: 'Offer uses credential_configuration_ids',
      status: ids ? 'pass' : 'fail',
      spec: 'OpenID4VCI §4.1.1',
      detail: ids
        ? `Offer references ${ids.join(', ')}.`
        : 'Offer uses the pre-draft-13 `credentials` array instead of `credential_configuration_ids`.',
      attributedTo: ids ? undefined : 'issuer',
    });

    if (ids && !ids.includes(expectedConfigurationId)) {
      ctx.check({
        id: 'vci.offer.configuration-match',
        title: 'Offer references the configuration selected from metadata',
        status: 'warn',
        spec: 'OpenID4VCI §4.1.1',
        detail: `Metadata selection chose "${expectedConfigurationId}" but the offer references ${ids.join(', ')}.`,
        attributedTo: 'issuer',
      });
    }

    const grant = offer.grants?.[PRE_AUTHORIZED_CODE_GRANT];
    ctx.expect(Boolean(grant?.['pre-authorized_code']), {
      id: 'vci.offer.pre-authorized-code',
      title: 'Offer carries a pre-authorized code',
      spec: 'OpenID4VCI §4.1.1',
      pass: 'A pre-authorized code is present, so issuance can proceed without an interactive login.',
      fail: 'No pre-authorized code in the offer. Only the authorization code grant is available, which needs a human to log in.',
      attributedTo: 'issuer',
    });

    if (grant && 'user_pin_required' in grant) {
      ctx.check({
        id: 'vci.offer.tx-code-shape',
        title: 'Offer uses the draft-13 tx_code object',
        status: 'warn',
        spec: 'OpenID4VCI §4.1.1',
        detail:
          'Offer carries the pre-draft-13 boolean `user_pin_required` rather than the `tx_code` object. Wallets built to draft 13 or later will not prompt for a PIN.',
        attributedTo: 'issuer',
      });
    }
  }
}
