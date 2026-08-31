import { randomUUID } from 'node:crypto';
import * as vc from '@digitalbazaar/vc';
import jsigs from 'jsonld-signatures';
import { Ed25519Signature2020 } from '@digitalbazaar/ed25519-signature-2020';
import { SignJWT } from 'jose';
import type { Participant, PresentationSubmission } from '@interop/shared';
import { PRE_AUTHORIZED_CODE_GRANT } from '@interop/shared';
import type { RunContext } from '../core/context.js';
import type { DocumentLoader } from '../core/jsonld.js';
import type { WalletKey } from '../core/keys.js';
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

/**
 * A headless, standards-only wallet.
 *
 * Deliberately written against OpenID4VCI and OpenID4VP alone, with no
 * knowledge of any particular issuer or verifier. That is what makes it useful
 * as a control: when this wallet fails against an implementation, the fault is
 * in one of the two protocol endpoints rather than in a bespoke integration.
 */
export class ReferenceWallet implements WalletAdapter {
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
      formats: ['ldp_vc', 'vc+sd-jwt', 'dc+sd-jwt'],
      specs: ['openid4vci-draft-13', 'openid4vci-1.0', 'openid4vp-draft-21', 'openid4vp-draft-23'],
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
    const proofJwt = await this.buildProofJwt(walletKey, endpoints.credentialIssuer, cNonce);
    ctx.artifact({ label: 'Holder key binding proof (decoded)', kind: 'jwt', value: proofJwt });

    const credentialRequest = this.buildCredentialRequest(endpoints, opts, proofJwt);
    const credentialResponse = await ctx.http<{
      credential?: unknown;
      credentials?: Array<{ credential: unknown }>;
      format?: string;
    }>({
      label: 'Credential Request',
      from: 'Wallet',
      to: 'Issuer',
      url: endpoints.credentialEndpoint,
      headers: { authorization: `Bearer ${accessToken}` },
      json: credentialRequest,
    });

    // Both the draft-13 single `credential` and the 1.0 `credentials` array are
    // accepted, since issuers in this ecosystem are split across the revisions.
    const credential =
      credentialResponse.body.credential ?? credentialResponse.body.credentials?.[0]?.credential;

    if (credential === undefined) {
      ctx.fail(
        'Credential response contained neither `credential` (draft 13) nor `credentials[0].credential` (1.0).',
        'issuer',
      );
    }

    ctx.expect(credential !== undefined, {
      id: 'vci.credential.present',
      title: 'Credential response carries a credential',
      spec: 'OpenID4VCI §7.3',
      pass: 'The response contained an issued credential.',
      fail: 'No credential in the response.',
      attributedTo: 'issuer',
    });

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
        : await this.buildSdJwtPresentation(ctx, request, held, opts, walletKey);

    ctx.artifact({ label: 'vp_token', kind: held.format === 'ldp_vc' ? 'json' : 'sd-jwt', value: vpToken });
    ctx.artifact({ label: 'presentation_submission', kind: 'json', value: submission });

    await ctx.http({
      label: 'Authorization Response (direct_post)',
      from: 'Wallet',
      to: 'Verifier',
      url: request.responseUri,
      form: {
        vp_token: typeof vpToken === 'string' ? vpToken : JSON.stringify(vpToken),
        presentation_submission: JSON.stringify(submission),
        state: request.state,
      },
    });
  }

  /** Builds an `openid4vci-proof+jwt` proving control of the holder key. */
  private async buildProofJwt(walletKey: WalletKey, audience: string, nonce?: string): Promise<string> {
    return new SignJWT({
      aud: audience,
      iat: Math.floor(Date.now() / 1000),
      ...(nonce ? { nonce } : {}),
    })
      .setProtectedHeader({
        alg: walletKey.alg,
        typ: 'openid4vci-proof+jwt',
        // Both are supplied: `jwk` lets an issuer verify without resolving
        // anything, `kid` lets one that prefers DID resolution do that instead.
        jwk: walletKey.publicJwk,
        kid: walletKey.kid,
      })
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

  private async buildJsonLdPresentation(
    ctx: RunContext,
    request: PresentationRequest,
    held: HeldCredential,
    walletKey: WalletKey,
  ): Promise<{ vpToken: unknown; submission: PresentationSubmission }> {
    const credential = held.raw as Record<string, unknown>;

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

    let signed: Record<string, unknown>;
    try {
      signed = credentialExpired
        ? await jsigs.sign(presentation, {
            suite: new Ed25519Signature2020({ key: walletKey.suiteKey }),
            purpose: new jsigs.purposes.AuthenticationProofPurpose({
              challenge: request.nonce,
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
            challenge: request.nonce,
            domain: request.authorizationRequest.client_id,
          });
    } catch (error) {
      ctx.fail(
        `Could not sign the Verifiable Presentation: ${error instanceof Error ? error.message : String(error)}`,
        'wallet',
      );
    }

    const definitionId = request.authorizationRequest.presentation_definition?.id ?? 'unknown';
    const descriptorId =
      request.authorizationRequest.presentation_definition?.input_descriptors?.[0]?.id ?? 'unknown';

    return {
      vpToken: signed,
      submission: {
        id: randomUUID(),
        definition_id: definitionId,
        descriptor_map: [
          {
            id: descriptorId,
            format: 'ldp_vp',
            path: '$',
            path_nested: { id: descriptorId, format: 'ldp_vc', path: '$.verifiableCredential[0]' },
          },
        ],
      },
    };
  }

  private async buildSdJwtPresentation(
    ctx: RunContext,
    request: PresentationRequest,
    held: HeldCredential,
    opts: PresentOptions,
    walletKey: WalletKey,
  ): Promise<{ vpToken: string; submission: PresentationSubmission }> {
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

    const vpToken = await presentSdJwt({
      combined: held.raw as string,
      disclose,
      keyBinding:
        opts.walletProofType === 'none'
          ? undefined
          : {
              audience: request.authorizationRequest.client_id,
              nonce: request.nonce,
              signingKey: walletKey.privateKey,
              alg: walletKey.alg,
            },
    });

    const definitionId = request.authorizationRequest.presentation_definition?.id ?? 'unknown';
    const descriptorId =
      request.authorizationRequest.presentation_definition?.input_descriptors?.[0]?.id ?? 'unknown';

    return {
      vpToken,
      submission: {
        id: randomUUID(),
        definition_id: definitionId,
        descriptor_map: [{ id: descriptorId, format: held.format, path: '$' }],
      },
    };
  }
}

/**
 * Extracts the claim names a presentation definition asks for, so an SD-JWT
 * wallet can withhold everything else.
 */
function requestedClaimNames(request: PresentationRequest): string[] {
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
