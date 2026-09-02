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
    await this.checkIssuerIdentityDocuments(ctx, base);

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

  /**
   * Checks that the issuer publishes something a verifier can resolve its key
   * from.
   *
   * A credential is only as verifiable as the issuer's key material is
   * reachable. An issuer whose DID document or JWKS is missing produces
   * credentials that verify for whoever already has the key cached and for
   * nobody else — which looks like working until someone new tries.
   */
  protected async checkIssuerIdentityDocuments(ctx: RunContext, base: string): Promise<void> {
    const did = await ctx.http<Record<string, unknown>>({
      label: 'Fetch Issuer DID Document',
      from: 'Playground',
      to: 'Issuer',
      url: `${base}/.well-known/did.json`,
      allowNonOk: true,
    });

    const jwks = await ctx.http<{ keys?: unknown[] }>({
      label: 'Fetch Issuer JWKS',
      from: 'Playground',
      to: 'Issuer',
      url: `${base}/.well-known/jwks.json`,
      allowNonOk: true,
    });

    // A 200 carrying an error envelope is worse than an honest 4xx: a client
    // that checks the status code treats the error as the document.
    for (const [label, response] of [
      ['DID document', did],
      ['JWKS', jwks],
    ] as const) {
      if (response.ok && isErrorEnvelope(response.body)) {
        ctx.check({
          id: `vci.issuer.${label === 'JWKS' ? 'jwks' : 'did'}-status-code`,
          title: `${label} endpoint reports errors with an error status`,
          status: 'fail',
          spec: 'RFC 9110 §15',
          detail: `The endpoint returned HTTP 200 with an error body (${errorCode(response.body)}). A client checking the status code would treat that error as the document.`,
          attributedTo: 'issuer',
        });
      }
    }

    const didMethods = did.ok ? verificationMethodCount(did.body) : 0;
    const jwkCount = jwks.ok && Array.isArray(jwks.body?.keys) ? jwks.body.keys.length : 0;
    const resolvable = didMethods > 0 || jwkCount > 0;

    ctx.check({
      id: 'vci.issuer.key-material',
      title: 'Issuer publishes resolvable key material at its identifier',
      // Either document is enough: Data Integrity verifiers resolve a DID
      // document, JOSE-based ones a JWKS. Neither is the problem.
      status: resolvable ? 'pass' : 'fail',
      spec: 'did:web method / RFC 7517',
      detail: resolvable
        ? `${didMethods} verification method(s) in the DID document, ${jwkCount} key(s) in the JWKS.`
        : `Neither /.well-known/did.json (HTTP ${did.status}) nor /.well-known/jwks.json (HTTP ${jwks.status}) yielded a key at the issuer identifier. A verifier that has not already cached this issuer's key cannot verify anything it issues.`,
      attributedTo: resolvable ? undefined : 'issuer',
    });

    if (did.ok && didMethods > 0) this.checkAssertionMethods(ctx, did.body);
    if (!resolvable) await this.probeAlternateKeyLocation(ctx, base);
    if (did.ok && didMethods > 0) ctx.artifact({ label: 'Issuer DID document', kind: 'json', value: did.body });
    if (jwks.ok && jwkCount > 0) ctx.artifact({ label: 'Issuer JWKS', kind: 'json', value: jwks.body });
  }

  /**
   * Checks that `assertionMethod` names verification methods, not the DID.
   *
   * DID Core requires each entry to be an embedded verification method or a
   * reference to one — which means an id carrying a fragment. An entry that is
   * the bare DID dereferences to the document itself rather than to a key, so a
   * verifier establishing that a proof's key is authorised for assertions has
   * nothing to compare against. It fails open or closed depending on the
   * implementation, which is the worst kind of ambiguity to leave in a trust
   * decision.
   */
  protected checkAssertionMethods(ctx: RunContext, document: Record<string, unknown>): void {
    const entries = Array.isArray(document.assertionMethod) ? document.assertionMethod : [];
    if (entries.length === 0) {
      ctx.check({
        id: 'vci.issuer.assertion-method',
        title: 'DID document authorises a key for assertions',
        status: 'warn',
        spec: 'DID Core §5.3.2',
        detail:
          'The DID document lists no assertionMethod. A verifier checking that the proof key is authorised to make assertions has nothing to check against.',
        attributedTo: 'issuer',
      });
      return;
    }

    const ids = new Set(
      (Array.isArray(document.verificationMethod) ? document.verificationMethod : [])
        .map((method) => (method && typeof method === 'object' ? (method as Record<string, unknown>).id : undefined))
        .filter((id): id is string => typeof id === 'string'),
    );

    const unresolvable = entries.filter((entry) => {
      if (entry && typeof entry === 'object') return false; // embedded, fine
      return typeof entry !== 'string' || !ids.has(entry);
    });

    ctx.check({
      id: 'vci.issuer.assertion-method',
      title: 'assertionMethod entries reference a verification method',
      status: unresolvable.length === 0 ? 'pass' : 'fail',
      spec: 'DID Core §5.3.2',
      detail:
        unresolvable.length === 0
          ? `All ${entries.length} assertionMethod entr(y/ies) resolve to a verification method in the document.`
          : `${unresolvable.map((entry) => `"${String(entry)}"`).join(', ')} ${
              unresolvable.length === 1 ? 'is' : 'are'
            } not the id of any verification method in this document. Verification method ids present: ${[...ids].join(', ') || '(none)'}. An entry that is the bare DID dereferences to the document rather than to a key.`,
      attributedTo: unresolvable.length === 0 ? undefined : 'issuer',
    });
  }

  /**
   * Looks for key material somewhere other than the issuer identifier.
   *
   * Reported rather than quietly used: finding it under a service context path
   * means the deployment has the keys and publishes them where a conformant
   * verifier will not look, which is a more actionable statement than "no keys".
   */
  protected async probeAlternateKeyLocation(ctx: RunContext, base: string): Promise<void> {
    return;
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

/** Counts usable verification methods in a DID document. */
function verificationMethodCount(document: unknown): number {
  if (!document || typeof document !== 'object') return 0;
  const methods = (document as Record<string, unknown>).verificationMethod;
  if (!Array.isArray(methods)) return 0;
  return methods.filter(
    (method) =>
      method &&
      typeof method === 'object' &&
      ('publicKeyJwk' in method || 'publicKeyMultibase' in method || 'publicKeyBase58' in method),
  ).length;
}

/** Detects a MOSIP-style error envelope returned with a success status. */
function isErrorEnvelope(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const errors = (body as Record<string, unknown>).errors;
  return Array.isArray(errors) && errors.length > 0;
}

function errorCode(body: unknown): string {
  const errors = (body as { errors?: Array<{ errorCode?: string }> }).errors ?? [];
  return errors[0]?.errorCode ?? 'unknown';
}
