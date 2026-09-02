import { randomUUID } from 'node:crypto';
import * as vc from '@digitalbazaar/vc';
import jsigs from 'jsonld-signatures';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import { SignJWT, type JWK } from 'jose';
import type { Participant, PresentationSubmission, VciDraft } from '@interop/shared';
import { PRE_AUTHORIZED_CODE_GRANT } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import type { DocumentLoader } from '../core/jsonld.js';
import type { WalletKey } from '../core/keys.js';
import { requestedClaimNames as dcqlClaimNames } from '../core/dcql.js';
import { presentMdoc } from '../core/mdoc.js';
import { parseSdJwt, presentSdJwt } from '../core/sdjwt.js';
import type {
  HeldCredential,
  IssueOptions,
  IssuerEndpoints,
  OfferResult,
  PresentOptions,
  PresentationRequest,
  WalletAdapter,
} from './types.js';
import { playgroundVersion } from '../core/versions.js';

/**
 * A headless, standards-only wallet.
 *
 * Deliberately written against OpenID4VCI and OpenID4VP alone, with no
 * knowledge of any particular issuer or verifier. That is what makes it useful
 * as a control: when this wallet fails against an implementation, the fault is
 * in one of the two protocol endpoints rather than in a bespoke integration.
 */
export class ReferenceWallet implements WalletAdapter {
  /** Hosted by the playground, so its version is this repository's. */
  async discoverVersion(): Promise<{ value?: string; detail: string }> {
    return playgroundVersion();
  }

  readonly manifest: Participant;

  constructor(
    private readonly deps: {
      walletKey: () => Promise<WalletKey>;
      documentLoader: () => DocumentLoader;
    },
  ) {
    this.manifest = {
      id: 'reference-wallet',
      role: 'wallet',
      label: 'Reference Wallet (headless)',
      kind: 'mock',
      summary:
        'A protocol-only OpenID4VCI/OpenID4VP client with no vendor-specific behaviour. Runs unattended and every exchange is captured.',
      traceability: 'full',
      formats: ['ldp_vc', 'vc+sd-jwt', 'dc+sd-jwt', 'mso_mdoc'],
      specs: ['openid4vci-draft-11', 'openid4vci-draft-12', 'openid4vci-draft-13', 'openid4vci-1.0', 'openid4vp-draft-21', 'openid4vp-draft-23'],
      interactive: false,
      config: [],
    };
  }

  async acceptOffer(
    ctx: RunContext,
    offer: OfferResult,
    endpoints: IssuerEndpoints,
    opts: IssueOptions,
  ): Promise<HeldCredential> {
    const walletKey = await this.deps.walletKey();
    const grant = offer.offer.grants?.[PRE_AUTHORIZED_CODE_GRANT];

    if (!grant?.['pre-authorized_code']) {
      ctx.fail(
        'The credential offer carries no pre-authorized code. The reference wallet only implements the pre-authorized code grant, because the authorization code grant needs an interactive login.',
        'issuer',
      );
    }

    // --- Token request ---------------------------------------------------
    const tokenResponse = await ctx.http<{
      access_token?: string;
      token_type?: string;
      c_nonce?: string;
      expires_in?: number;
    }>({
      label: 'Token Request (pre-authorized_code)',
      from: 'Wallet',
      to: 'Issuer',
      url: endpoints.tokenEndpoint,
      form: {
        grant_type: PRE_AUTHORIZED_CODE_GRANT,
        'pre-authorized_code': grant['pre-authorized_code'],
        ...(offer.txCode ? { tx_code: offer.txCode } : {}),
      },
    });

    const accessToken = tokenResponse.body.access_token;
    if (!accessToken) {
      ctx.fail('Token response contained no access_token.', 'issuer');
    }

    ctx.expect(tokenResponse.body.token_type?.toLowerCase() === 'bearer', {
      id: 'vci.token.type',
      title: 'Token response uses the Bearer token type',
      spec: 'OpenID4VCI §6.2 / RFC 6749 §5.1',
      pass: `token_type is "${tokenResponse.body.token_type}".`,
      fail: `Expected token_type "Bearer", got "${String(tokenResponse.body.token_type)}".`,
      attributedTo: 'issuer',
    });

    // --- Nonce for the holder proof --------------------------------------
    let cNonce = tokenResponse.body.c_nonce;
    if (!cNonce && endpoints.nonceEndpoint) {
      // OpenID4VCI 1.0 moved `c_nonce` out of the token response into a
      // dedicated nonce endpoint; support both so the wallet works either way.
      const nonceResponse = await ctx.http<{ c_nonce?: string }>({
        label: 'Nonce Request',
        from: 'Wallet',
        to: 'Issuer',
        url: endpoints.nonceEndpoint,
        method: 'POST',
        json: {},
        allowNonOk: true,
      });
      cNonce = nonceResponse.body?.c_nonce;
    }

    ctx.check({
      id: 'vci.nonce.available',
      title: 'Issuer supplied a nonce for the holder proof',
      status: cNonce ? 'pass' : 'warn',
      spec: 'OpenID4VCI §7.2 (c_nonce) / §8 (Nonce Endpoint)',
      detail: cNonce
        ? 'A c_nonce was obtained, so the key binding proof can be bound to this issuance.'
        : 'No c_nonce from either the token response or a nonce endpoint. The proof cannot be replay-protected.',
      attributedTo: cNonce ? undefined : 'issuer',
    });

    // --- Credential request ----------------------------------------------
    const proofJwt = await this.buildProofJwt(ctx, walletKey, endpoints.credentialIssuer, endpoints, cNonce);
    ctx.artifact({ label: 'Holder key binding proof (decoded)', kind: 'jwt', value: proofJwt });

    const draft = ctx.config.vciDraft ?? 'draft-13';
    const credentialEndpoint = credentialEndpointFor(endpoints.credentialEndpoint, draft);

    const credentialRequest = this.buildCredentialRequest(endpoints, opts, proofJwt);
    const credentialResponse = await ctx.http<{
      credential?: unknown;
      credentials?: Array<{ credential: unknown }>;
      format?: string;
    }>({
      label: `Credential Request (${draft})`,
      from: 'Wallet',
      to: 'Issuer',
      url: credentialEndpoint,
      headers: { authorization: `Bearer ${accessToken}` },
      json: credentialRequest,
    });

    const credential = this.readCredential(ctx, credentialResponse.body, draft);

    return this.toHeldCredential(ctx, credential, opts, walletKey);
  }

  async present(
    ctx: RunContext,
    request: PresentationRequest,
    held: HeldCredential,
    opts: PresentOptions,
  ): Promise<void> {
    const walletKey = await this.deps.walletKey();
    const { authorizationRequest } = request;

    ctx.expect(authorizationRequest.response_mode === 'direct_post', {
      id: 'vp.response-mode',
      title: 'Verifier requested a supported response mode',
      spec: 'OpenID4VP §6.2',
      pass: 'response_mode is direct_post.',
      fail: `The reference wallet implements direct_post only; the verifier asked for "${authorizationRequest.response_mode}".`,
      attributedTo: 'verifier',
    });

    const { vpToken, submission } =
      held.format === 'ldp_vc'
        ? await this.buildJsonLdPresentation(ctx, request, held, walletKey)
        : held.format === 'mso_mdoc'
          ? await this.buildMdocPresentation(ctx, request, held, walletKey)
          : await this.buildSdJwtPresentation(ctx, request, held, opts, walletKey);

    ctx.artifact({
      label: 'vp_token',
      kind: held.format === 'ldp_vc' ? 'json' : held.format === 'mso_mdoc' ? 'cbor' : 'sd-jwt',
      value: vpToken,
    });
    if (submission) ctx.artifact({ label: 'presentation_submission', kind: 'json', value: submission });

    const dcql = request.authorizationRequest.dcql_query;
    const serialised = typeof vpToken === 'string' ? vpToken : JSON.stringify(vpToken);

    // OpenID4VP 1.0 makes `vp_token` a map keyed by DCQL query id, so a verifier
    // can tell which presentation answers which part of its request.
    // Presentation Exchange sends a single value plus a descriptor map instead.
    const form: Record<string, string> = dcql
      ? {
          vp_token: JSON.stringify({ [dcql.credentials[0]?.id ?? 'credential']: serialised }),
          state: request.state,
        }
      : {
          vp_token: serialised,
          presentation_submission: JSON.stringify(submission),
          state: request.state,
        };

    ctx.check({
      id: 'vp.response.envelope',
      title: dcql ? 'Response uses the DCQL-keyed vp_token map' : 'Response carries a presentation submission',
      status: 'pass',
      spec: 'OpenID4VP 1.0 §8.1 / OpenID4VP draft 21 §6.1',
      detail: dcql
        ? `vp_token is an object keyed by query id ("${dcql.credentials[0]?.id}"), as OpenID4VP 1.0 requires.`
        : 'vp_token is a single value accompanied by a presentation_submission descriptor map.',
    });

    const submitted = await ctx.http<{ redirect_uri?: string }>({
      label: 'Authorization Response (direct_post)',
      from: 'Wallet',
      to: 'Verifier',
      url: request.responseUri,
      form,
    });

    if (ctx.config.flowMode === 'same-device') {
      await this.followSameDeviceRedirect(ctx, submitted.body?.redirect_uri);
    }
  }

  /**
   * Completes the same-device return leg.
   *
   * In a same-device flow the wallet and the verifier's page are on one screen,
   * so the verifier hands back a URL to return to instead of being polled. The
   * one-time response code in that URL is what stops anyone who observes the
   * redirect from reading the result; the wallet redeems it once, and the
   * `replay-response-code` fault redeems it twice to check that the second
   * attempt is refused.
   */
  private async followSameDeviceRedirect(ctx: RunContext, redirectUri: string | undefined): Promise<void> {
    ctx.expect(Boolean(redirectUri), {
      id: 'vp.same-device.redirect',
      title: 'Verifier returns a redirect_uri for the same-device flow',
      spec: 'OpenID4VP §7.2 (response_uri with redirect)',
      pass: `The direct_post response carried a redirect_uri, so the wallet can hand control back.`,
      fail: 'No redirect_uri in the direct_post response. On one device the user is left on the wallet with no way back to the verifier.',
      attributedTo: 'verifier',
    });
    if (!redirectUri) return;

    const first = await ctx.http<{ status?: string }>({
      label: 'Follow Same-Device Redirect',
      from: 'Wallet',
      to: 'Verifier',
      url: redirectUri,
      allowNonOk: true,
    });

    ctx.expect(first.ok, {
      id: 'vp.same-device.response-code',
      title: 'Response code is redeemable',
      spec: 'OpenID4VP §7.2',
      pass: 'The response code was accepted on first use.',
      fail: `Redeeming the response code returned HTTP ${first.status}.`,
      attributedTo: 'verifier',
    });

    if (ctx.config.tamper !== 'replay-response-code') return;

    const second = await ctx.http<unknown>({
      label: 'Replay Same-Device Response Code',
      from: 'Wallet',
      to: 'Verifier',
      url: redirectUri,
      allowNonOk: true,
    });

    ctx.expect(!second.ok, {
      id: 'vp.same-device.response-code-single-use',
      title: 'Response code cannot be redeemed twice',
      spec: 'OpenID4VP §7.2',
      pass: `A second redemption was refused with HTTP ${second.status}, as it must be.`,
      fail: 'The response code was accepted a second time. Anyone who observes the redirect can replay it and read the presentation result.',
      attributedTo: 'verifier',
    });
  }

  /**
   * Reads the credential out of a response, holding the issuer to the shape its
   * revision defines.
   *
   * The revisions disagree about this in ways a wallet cannot paper over
   * silently: draft 11 and 12 echo `format` and return a single `credential`,
   * draft 13 drops the echo, and 1.0 replaces the scalar with a `credentials`
   * array. Accepting whatever turns up would hide exactly the mismatch this
   * playground exists to find, so the expected shape is asserted first and the
   * fallback recorded as a finding rather than applied quietly.
   */
  private readCredential(
    ctx: RunContext,
    body: { credential?: unknown; credentials?: Array<{ credential: unknown }>; format?: string },
    draft: VciDraft,
  ): unknown {
    const scalar = body.credential;
    const fromArray = body.credentials?.[0]?.credential;

    if (draft === '1.0') {
      ctx.check({
        id: 'vci.credential.envelope',
        title: 'Response uses the credentials array required by OpenID4VCI 1.0',
        status: fromArray !== undefined ? 'pass' : 'fail',
        spec: 'OpenID4VCI 1.0 §8.3',
        detail:
          fromArray !== undefined
            ? 'Response carries credentials[0].credential.'
            : 'Response carries only the pre-1.0 scalar `credential`. A wallet built strictly to 1.0 would find nothing.',
        attributedTo: fromArray !== undefined ? undefined : 'issuer',
      });
    } else {
      ctx.check({
        id: 'vci.credential.envelope',
        title: `Response carries a credential in the shape ${draft} defines`,
        status: scalar !== undefined ? 'pass' : 'fail',
        spec: 'OpenID4VCI draft 11-13 §7.3',
        detail:
          scalar !== undefined
            ? 'Response carries the scalar `credential`.'
            : 'Response carries no scalar `credential`. Only the 1.0 array form is present.',
        attributedTo: scalar !== undefined ? undefined : 'issuer',
      });
    }

    // `format` was echoed up to draft 12 and removed in draft 13.
    const echoesFormat = body.format !== undefined;
    const shouldEcho = draft === 'draft-11' || draft === 'draft-12';
    ctx.check({
      id: 'vci.credential.format-echo',
      title: `Response ${shouldEcho ? 'echoes' : 'omits'} the format, as ${draft} requires`,
      status: echoesFormat === shouldEcho ? 'pass' : 'warn',
      spec: 'OpenID4VCI draft 12 §7.3 vs draft 13 §7.3',
      detail: shouldEcho
        ? echoesFormat
          ? `format is "${body.format}".`
          : 'No format in the response. A draft 11 or 12 wallet expects it to be echoed.'
        : echoesFormat
          ? `Response still echoes format ("${body.format}"), which draft 13 removed. Harmless to a tolerant wallet, but it signals the issuer is on an earlier revision than advertised.`
          : 'No format echoed, as expected.',
      attributedTo: echoesFormat === shouldEcho ? undefined : 'issuer',
    });

    const credential = scalar ?? fromArray;
    if (credential === undefined) {
      ctx.fail(
        'Credential response contained neither `credential` (draft 11-13) nor `credentials[0].credential` (1.0).',
        'issuer',
      );
    }
    return credential;
  }
  /**
   * Builds an `openid4vci-proof+jwt` proving control of the holder key.
   *
   * The header carries exactly one key identifier. OpenID4VCI §7.2.1 requires
   * that — supplying both `jwk` and `kid` is a protocol violation, and real
   * issuers reject it outright rather than picking one. Which one to send is
   * chosen from the binding methods the issuer advertises, because an issuer
   * that only supports `did:jwk` cannot use a bare `jwk` header and vice versa.
   */
  private async buildProofJwt(
    ctx: RunContext,
    walletKey: WalletKey,
    audience: string,
    endpoints: IssuerEndpoints,
    nonce?: string,
  ): Promise<string> {
    const configuration = endpoints.metadata.credential_configurations_supported?.[endpoints.configurationId];
    const bindingMethods = configuration?.cryptographic_binding_methods_supported ?? [];

    let keyHeader: { jwk: JWK } | { kid: string };
    let chosen: string;

    // Preference order matters. A bare `jwk` is self-contained: the issuer can
    // bind the key into the credential without resolving anything, which is
    // what an SD-JWT `cnf` claim needs. A DID reference is used only when the
    // issuer does not accept a raw key, and `did:jwk` before other methods
    // because it too carries the key rather than requiring a lookup.
    if (bindingMethods.length === 0 || bindingMethods.includes('jwk')) {
      keyHeader = { jwk: walletKey.publicJwk };
      chosen = 'jwk';
    } else if (bindingMethods.includes('did:jwk')) {
      keyHeader = { kid: didJwk(walletKey.publicJwk) };
      chosen = 'did:jwk';
    } else {
      keyHeader = { kid: walletKey.kid };
      chosen = walletKey.kid.split('#')[0]?.split(':').slice(0, 2).join(':') ?? 'did';
    }

    ctx.check({
      id: 'vci.proof.key-identifier',
      title: 'Proof JWT carries exactly one key identifier',
      status: 'pass',
      spec: 'OpenID4VCI §7.2.1',
      detail:
        bindingMethods.length > 0
          ? `Issuer advertises ${bindingMethods.join(', ')}; the proof uses ${chosen}.`
          : `Issuer advertises no cryptographic_binding_methods_supported; the proof uses ${chosen}.`,
    });

    return new SignJWT({
      aud: audience,
      iat: Math.floor(Date.now() / 1000),
      ...(nonce ? { nonce } : {}),
    })
      .setProtectedHeader({ alg: walletKey.alg, typ: 'openid4vci-proof+jwt', ...keyHeader })
      .sign(walletKey.privateKey);
  }

  private buildCredentialRequest(
    endpoints: IssuerEndpoints,
    opts: IssueOptions,
    proofJwt: string,
  ): Record<string, unknown> {
    const configuration = endpoints.metadata.credential_configurations_supported?.[endpoints.configurationId];
    const request: Record<string, unknown> = {
      format: opts.format,
      proof: { proof_type: 'jwt', jwt: proofJwt },
    };

    if (opts.format === 'ldp_vc') {
      request.credential_definition = configuration?.credential_definition ?? {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential'],
      };
    } else if (configuration?.vct) {
      request.vct = configuration.vct;
    }

    return request;
  }

  private toHeldCredential(
    ctx: RunContext,
    credential: unknown,
    opts: IssueOptions,
    walletKey: WalletKey,
  ): HeldCredential {
    if (opts.format === 'mso_mdoc' && typeof credential === 'string') {
      ctx.artifact({ label: 'Issued credential (mdoc IssuerSigned)', kind: 'cbor', value: credential });
      return { format: 'mso_mdoc', raw: credential, holderKeyId: walletKey.kid };
    }

    if (typeof credential === 'string' && credential.includes('~')) {
      const parsed = parseSdJwt(credential);
      ctx.artifact({ label: 'Issued credential (SD-JWT VC)', kind: 'sd-jwt', value: credential });
      ctx.artifact({ label: 'Issued credential (decoded)', kind: 'json', value: parsed });
      return {
        format: opts.format === 'ldp_vc' ? 'vc+sd-jwt' : opts.format,
        raw: credential,
        decoded: parsed.resolved,
        holderKeyId: walletKey.kid,
      };
    }

    // Some issuers return a JSON-LD credential as a JSON-encoded string.
    const parsed =
      typeof credential === 'string' ? (JSON.parse(credential) as Record<string, unknown>) : (credential as Record<string, unknown>);

    ctx.artifact({ label: 'Issued credential (W3C VC)', kind: 'json', value: parsed });
    return { format: 'ldp_vc', raw: parsed, decoded: parsed, holderKeyId: walletKey.suiteKid };
  }

  /**
   * Checks an issued JSON-LD credential for the things that make one
   * unverifiable elsewhere, before trying to present it.
   *
   * These are the failures that turn into "it worked against our own verifier
   * but nobody else can read it": a context that does not dereference, an
   * issuer nobody can resolve, a verification method that is not a key. Each is
   * reported separately so a failure names the specific defect rather than
   * surfacing as one opaque canonicalisation error.
   */
  private async inspectJsonLdCredential(ctx: RunContext, credential: Record<string, unknown>): Promise<void> {
    const loader = this.deps.documentLoader();

    // The two revisions name the validity window differently. A credential
    // carrying neither pair, or the pair belonging to the other revision, is
    // typically read as having no validity period at all rather than failing —
    // so it is worth asserting rather than assuming.
    const requested = ctx.config.vcVersion ?? '1.1';
    const declaredContexts = toArray(credential['@context']).filter(
      (entry): entry is string => typeof entry === 'string',
    );
    const isV2 = declaredContexts.includes('https://www.w3.org/ns/credentials/v2');
    const hasV2Dates = 'validFrom' in credential || 'validUntil' in credential;
    const hasV11Dates = 'issuanceDate' in credential || 'expirationDate' in credential;

    ctx.check({
      id: 'vc.data-model.version',
      title: `Credential uses the W3C data model it was issued under (${requested})`,
      status: (isV2 ? hasV2Dates : hasV11Dates) ? 'pass' : 'fail',
      spec: 'W3C VC Data Model 1.1 §4.6 / 2.0 §4.8',
      detail: isV2
        ? hasV2Dates
          ? 'Uses the VC 2.0 context with validFrom/validUntil.'
          : 'Declares the VC 2.0 context but carries issuanceDate/expirationDate, which 2.0 replaced. A 2.0 verifier reads this as having no validity period.'
        : hasV11Dates
          ? 'Uses the VC 1.1 context with issuanceDate/expirationDate.'
          : 'Declares the VC 1.1 context but carries validFrom/validUntil, which 1.1 does not define.',
      attributedTo: (isV2 ? hasV2Dates : hasV11Dates) ? undefined : 'issuer',
    });
    const contexts = toArray(credential['@context']).filter((entry): entry is string => typeof entry === 'string');
    const unresolvable: string[] = [];

    for (const url of contexts) {
      try {
        const { document } = await loader(url);
        if (!document || typeof document !== 'object' || !('@context' in (document as object))) {
          unresolvable.push(`${url} (resolved, but is not a JSON-LD context document)`);
        }
      } catch (error) {
        unresolvable.push(`${url} (${error instanceof Error ? error.message : String(error)})`);
      }
    }

    ctx.expect(unresolvable.length === 0, {
      id: 'vc.context.dereferenceable',
      title: 'Every @context entry resolves to a JSON-LD context',
      spec: 'W3C VC Data Model §4.1, JSON-LD 1.1 §3.1',
      pass: `All ${contexts.length} context(s) resolved.`,
      fail: `Could not use: ${unresolvable.join('; ')}. A credential whose context does not dereference cannot be canonicalised, so its proof cannot be verified by anyone.`,
      attributedTo: 'issuer',
    });

    const issuer = typeof credential.issuer === 'string' ? credential.issuer : (credential.issuer as { id?: string })?.id;
    if (issuer) {
      const placeholder = /^did:example:/.test(issuer);
      ctx.check({
        id: 'vc.issuer.resolvable',
        title: 'Credential issuer is a resolvable identifier',
        status: placeholder ? 'fail' : 'pass',
        spec: 'W3C VC Data Model §4.5',
        detail: placeholder
          ? `The issuer is "${issuer}", a placeholder from the did:example method. No verifier can resolve it to a key, so the credential cannot be verified outside the system that made it.`
          : `Issuer is ${issuer}.`,
        attributedTo: placeholder ? 'issuer' : undefined,
      });
    }

    const proof = (Array.isArray(credential.proof) ? credential.proof[0] : credential.proof) as
      | Record<string, unknown>
      | undefined;
    if (proof) {
      const method = String(proof.verificationMethod ?? '');
      // A verification method identifies one key. A JWKS endpoint is a set of
      // them, so it leaves the verifier no way to know which one signed.
      const looksLikeKeySet = /jwks(\.json)?$/i.test(method);
      ctx.check({
        id: 'vc.proof.verification-method',
        title: 'Proof verification method identifies a single key',
        status: looksLikeKeySet || !method ? 'fail' : 'pass',
        spec: 'W3C VC Data Integrity §2.2',
        detail: !method
          ? 'The proof carries no verificationMethod.'
          : looksLikeKeySet
            ? `verificationMethod is "${method}", which is a JWKS endpoint rather than a single key. A verifier cannot tell which key in the set produced the proof.`
            : `verificationMethod is ${method}.`,
        attributedTo: looksLikeKeySet || !method ? 'issuer' : undefined,
      });
    }

    const types = toArray(credential.type).filter((entry): entry is string => typeof entry === 'string');
    ctx.check({
      id: 'vc.subject.populated',
      title: 'Credential carries a credential subject',
      status: credential.credentialSubject ? 'pass' : 'fail',
      spec: 'W3C VC Data Model §4.4',
      detail: credential.credentialSubject
        ? `Subject present; type is ${types.join(', ')}.`
        : `credentialSubject is null or absent, so the credential asserts nothing about anyone. Type is ${types.join(', ')}.`,
      attributedTo: credential.credentialSubject ? undefined : 'issuer',
    });
  }

  private async buildJsonLdPresentation(
    ctx: RunContext,
    request: PresentationRequest,
    held: HeldCredential,
    walletKey: WalletKey,
  ): Promise<{ vpToken: unknown; submission?: PresentationSubmission }> {
    const credential = held.raw as Record<string, unknown>;
    await this.inspectJsonLdCredential(ctx, credential);

    // Built directly rather than through `vc.createPresentation`, which
    // validates every embedded credential in verify mode and so refuses to wrap
    // an expired one. The presentation context is taken from the credential so
    // a VC 1.1 credential is not wrapped in a VC 2.0 presentation.
    const credentialContexts = toArray(credential['@context']).filter(
      (entry): entry is string => typeof entry === 'string',
    );
    const presentationContext = credentialContexts.includes('https://www.w3.org/ns/credentials/v2')
      ? 'https://www.w3.org/ns/credentials/v2'
      : 'https://www.w3.org/2018/credentials/v1';

    const presentation: Record<string, unknown> = {
      '@context': [presentationContext],
      type: ['VerifiablePresentation'],
      id: `urn:uuid:${randomUUID()}`,
      holder: walletKey.did,
      verifiableCredential: [credential],
    };

    const expiry = credential.expirationDate ?? credential.validUntil;
    const credentialExpired = typeof expiry === 'string' && new Date(expiry).getTime() < Date.now();

    if (credentialExpired) {
      // `vc.signPresentation` validates embedded credentials and refuses to
      // wrap an expired one. That is a defensible wallet policy, but it is a
      // policy, not a protocol rule — and applying it here would mean the
      // verifier never gets to demonstrate its own expiry handling. Present it
      // and let the relying party decide, saying so explicitly in the report.
      ctx.check({
        id: 'wallet.expired-credential-policy',
        title: 'Wallet presents an expired credential rather than blocking it',
        status: 'warn',
        spec: 'Playground wallet policy',
        detail:
          'The held credential is past its expiration date. This wallet forwards it so the verifier can be observed rejecting it; a production wallet may instead refuse to present it at all.',
      });
    }

    const tamper = ctx.config.tamper;

    if (tamper === 'strip-holder-proof') {
      // Sent unsigned: the credential inside is still authentic, but nothing
      // binds the presentation to the holder, so the verifier has no evidence
      // the presenter is the subject.
      ctx.log('warn', 'Presenting without a holder proof, as requested by the injected fault.');
      return {
        vpToken: presentation,
        submission: buildSubmission(request, 'ldp_vp', 'ldp_vc'),
      };
    }

    // A nonce from a different exchange: the presentation is well-formed and
    // correctly signed, but replayed, and a verifier must refuse it.
    const challenge = tamper === 'replay-nonce' ? 'stale-nonce-from-an-earlier-exchange' : request.nonce;

    let signed: Record<string, unknown>;
    try {
      signed = credentialExpired
        ? await jsigs.sign(presentation, {
            suite: new Ed25519Signature2020({ key: walletKey.suiteKey }),
            purpose: new jsigs.purposes.AuthenticationProofPurpose({
              challenge,
              domain: request.authorizationRequest.client_id,
            }),
            documentLoader: this.deps.documentLoader(),
          })
        : await vc.signPresentation({
            presentation,
            suite: new Ed25519Signature2020({ key: walletKey.suiteKey }),
            documentLoader: this.deps.documentLoader(),
            // The verifier's nonce becomes the proof challenge; this is what
            // makes the presentation non-replayable against another request.
            challenge,
            domain: request.authorizationRequest.client_id,
          });
    } catch (error) {
      // Almost always the credential's own fault: a context that will not
      // dereference, or a term that will not expand, makes the credential
      // impossible to canonicalise and therefore impossible to embed in a
      // signed presentation. Reporting that and presenting unsigned is more
      // useful than aborting, because the verifier still gets to weigh in.
      ctx.check({
        id: 'vp.signing',
        title: 'Holder can sign a presentation containing this credential',
        status: 'fail',
        spec: 'W3C VC Data Integrity / JSON-LD 1.1',
        detail: `${error instanceof Error ? error.message : String(error)} The presentation is being sent unsigned so the verifier's handling can still be observed.`,
        attributedTo: 'issuer',
      });
      return { vpToken: presentation, submission: buildSubmission(request, 'ldp_vp', 'ldp_vc') };
    }

    return { vpToken: signed, submission: buildSubmission(request, 'ldp_vp', 'ldp_vc') };
  }

  /**
   * Builds an OpenID4VP `DeviceResponse`.
   *
   * Device authentication signs over a session transcript derived from the
   * verifier's client id, response URI and nonce, so the response cannot be
   * replayed against a different request.
   */
  private async buildMdocPresentation(
    ctx: RunContext,
    request: PresentationRequest,
    held: HeldCredential,
    walletKey: WalletKey,
  ): Promise<{ vpToken: string; submission?: PresentationSubmission }> {
    const tamper = ctx.config.tamper;

    if (tamper === 'strip-holder-proof') {
      ctx.log('warn', 'Omitting mdoc device authentication, as requested by the injected fault.');
    }

    const presented = await presentMdoc({
      credential: held.raw as string,
      deviceKey: walletKey.privateKey,
      clientId: request.authorizationRequest.client_id,
      responseUri: request.responseUri,
      nonce: request.nonce,
      omitDeviceAuth: tamper === 'strip-holder-proof',
      replayNonce: tamper === 'replay-nonce' ? 'stale-nonce-from-an-earlier-exchange' : undefined,
    });

    ctx.check({
      id: 'vp.mdoc.device-binding',
      title: 'DeviceResponse binds to this request',
      status: tamper === 'strip-holder-proof' ? 'warn' : 'pass',
      spec: 'ISO/IEC 18013-5 §9.1.3, ISO/IEC 18013-7 Annex B',
      detail:
        tamper === 'strip-holder-proof'
          ? 'Device authentication omitted; the response proves issuance but not possession.'
          : 'Device signature covers the session transcript built from the verifier client id, response URI and nonce.',
    });

    return { vpToken: presented.vpToken, submission: buildSubmission(request, 'mso_mdoc', 'mso_mdoc') };
  }

  private async buildSdJwtPresentation(
    ctx: RunContext,
    request: PresentationRequest,
    held: HeldCredential,
    opts: PresentOptions,
    walletKey: WalletKey,
  ): Promise<{ vpToken: string; submission?: PresentationSubmission }> {
    const parsed = parseSdJwt(held.raw as string);
    const requested = requestedClaimNames(request);
    const disclose = requested.length > 0 ? requested : parsed.disclosures.map((d) => d.name);

    ctx.check({
      id: 'vp.selective-disclosure',
      title: 'Wallet discloses only the requested claims',
      status: disclose.length < parsed.disclosures.length ? 'pass' : 'warn',
      spec: 'OpenID4VP §7 / SD-JWT VC §5',
      detail:
        disclose.length < parsed.disclosures.length
          ? `Disclosing ${disclose.length} of ${parsed.disclosures.length} claims: ${disclose.join(', ')}.`
          : `The request did not constrain individual claims, so all ${parsed.disclosures.length} were disclosed. A verifier asking for limit_disclosure should also name the fields it needs.`,
    });

    const tamper = ctx.config.tamper;
    const omitKeyBinding = opts.walletProofType === 'none' || tamper === 'strip-holder-proof';

    if (tamper === 'strip-holder-proof') {
      ctx.log('warn', 'Omitting the key binding JWT, as requested by the injected fault.');
    }

    const vpToken = await presentSdJwt({
      combined: held.raw as string,
      disclose,
      keyBinding: omitKeyBinding
        ? undefined
        : {
            audience: request.authorizationRequest.client_id,
            // A nonce from a different exchange: correctly signed, but replayed.
            nonce: tamper === 'replay-nonce' ? 'stale-nonce-from-an-earlier-exchange' : request.nonce,
            signingKey: walletKey.privateKey,
            alg: walletKey.alg,
          },
    });

    return { vpToken, submission: buildSubmission(request, held.format, held.format) };
  }
}

/** Builds the presentation submission describing where each credential sits. */
function buildSubmission(
  request: PresentationRequest,
  format: string,
  nestedFormat: string,
): PresentationSubmission | undefined {
  // DCQL has no presentation submission: the response is keyed by query id
  // instead, so sending one would be meaningless rather than merely redundant.
  if (request.authorizationRequest.dcql_query) return undefined;

  const definition = request.authorizationRequest.presentation_definition;
  const descriptorId = definition?.input_descriptors?.[0]?.id ?? 'unknown';
  const isEnvelope = format === 'ldp_vp';

  return {
    id: randomUUID(),
    definition_id: definition?.id ?? 'unknown',
    descriptor_map: [
      {
        id: descriptorId,
        format,
        path: '$',
        ...(isEnvelope
          ? { path_nested: { id: descriptorId, format: nestedFormat, path: '$.verifiableCredential[0]' } }
          : {}),
      },
    ],
  };
}

/**
 * Extracts the claim names the request asks for, so a wallet can withhold
 * everything else.
 *
 * Reads whichever language the verifier used. A wallet that understood only one
 * would over-disclose against the other — silently, because sending everything
 * always satisfies a request.
 */
function requestedClaimNames(request: PresentationRequest): string[] {
  const dcql = request.authorizationRequest.dcql_query;
  if (dcql) return dcqlClaimNames(dcql);

  const descriptors = request.authorizationRequest.presentation_definition?.input_descriptors ?? [];
  const names = new Set<string>();

  for (const descriptor of descriptors) {
    for (const field of descriptor.constraints?.fields ?? []) {
      for (const path of field.path) {
        // Only leaf claim paths are actionable, e.g. `$.fullName`. Paths into
        // metadata such as `$.vct` are constraints on the credential, not
        // requests for a claim to be disclosed.
        const match = /^\$\.([A-Za-z_][\w]*)$/.exec(path);
        const name = match?.[1];
        if (name && !['vct', 'iss', 'type', 'exp', 'iat', 'cnf'].includes(name)) names.add(name);
      }
    }
  }
  return [...names];
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** `did:jwk` per the DID JWK method: base64url of the JSON public key. */
function didJwk(jwk: JWK): string {
  return `did:jwk:${Buffer.from(JSON.stringify(jwk)).toString('base64url')}`;
}

/**
 * Maps the credential endpoint onto the path a given revision serves it at.
 *
 * Draft 11 and 12 are served beside the current endpoint rather than replacing
 * it, so a deployment can support several revisions at once — which is exactly
 * the situation that makes testing them separately worthwhile.
 */
function credentialEndpointFor(credentialEndpoint: string, draft: VciDraft): string {
  if (draft !== 'draft-11' && draft !== 'draft-12') return credentialEndpoint;
  const segment = draft === 'draft-11' ? 'vd11' : 'vd12';
  return credentialEndpoint.replace(/\/credential$/, `/${segment}/credential`);
}
