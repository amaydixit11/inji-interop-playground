import type { Participant } from '@interop/shared';
import type { RunContext } from '../core/context.js';
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
 * Adapter for a real wallet held by a real person — Inji Wallet on a phone, or
 * Inji Web in another browser tab.
 *
 * The orchestrator cannot see any of this wallet's traffic: it scans a QR code
 * and talks to the issuer and verifier directly. Rather than pretend otherwise,
 * the adapter declares itself `endpoint-only`, places the unobserved exchanges
 * on the timeline as explicit gaps, and lets the report caveat the result.
 *
 * That honesty matters: a green run here proves the issuer and verifier
 * endpoints interoperated with *something*, which is a weaker claim than a
 * fully-traced run, and the two should not be reported identically.
 */
export class HandheldWallet implements WalletAdapter {
  readonly manifest: Participant;

  constructor(
    private readonly variant: {
      id: string;
      label: string;
      summary: string;
      kind: Participant['kind'];
      /** Base URL of a companion web wallet, when there is one to open. */
      launchUrl?: string;
    },
  ) {
    this.manifest = {
      id: variant.id,
      role: 'wallet',
      label: variant.label,
      kind: variant.kind,
      summary: variant.summary,
      traceability: 'endpoint-only',
      formats: ['ldp_vc', 'vc+sd-jwt', 'mso_mdoc'],
      specs: ['openid4vci-draft-13', 'openid4vp-draft-21', 'openid4vp-draft-23'],
      interactive: true,
      config: variant.launchUrl
        ? [{ key: 'launchUrl', label: 'Wallet URL', value: variant.launchUrl, required: false }]
        : [],
    };
  }

  async acceptOffer(
    ctx: RunContext,
    offer: OfferResult,
    endpoints: IssuerEndpoints,
    opts: IssueOptions,
  ): Promise<HeldCredential> {
    ctx.log(
      'info',
      `Handing the credential offer to ${this.manifest.label}. The exchanges that follow happen directly between the wallet and the issuer and are not visible to the playground.`,
    );

    await ctx.awaitUserAction({
      step: 'issue',
      title: `Scan the offer with ${this.manifest.label}`,
      instructions:
        this.manifest.id === 'inji-web'
          ? 'Open Inji Web, paste the credential offer link, and complete the download. Then confirm below.'
          : 'Scan this QR code with Inji Wallet on your phone and accept the credential. Then confirm below.',
      uri: offer.offerUri,
    });

    // Place the unobservable exchanges on the timeline so the sequence diagram
    // shows what happened, clearly marked as not captured.
    for (const [label, url] of [
      ['Token Request (not captured)', endpoints.tokenEndpoint],
      ['Credential Request (not captured)', endpoints.credentialEndpoint],
    ] as const) {
      ctx.recordExternalExchange({
        label,
        from: this.manifest.label,
        to: 'Issuer',
        method: 'POST',
        url,
        requestHeaders: {},
        error: 'Performed on the wallet device; the playground is not in the path and cannot capture the payload.',
      });
    }

    ctx.check({
      id: 'wallet.traceability',
      title: 'Wallet exchanges were captured',
      status: 'warn',
      spec: 'Playground observability',
      detail: `${this.manifest.label} talks to the issuer and verifier directly, so the OpenID4VCI token and credential payloads are not in this report. Endpoint behaviour is still verified, but the wallet's own conformance is not.`,
    });

    return {
      // The credential lives on the device; downstream steps drive the wallet
      // through the verifier rather than handling the credential themselves.
      format: opts.format,
      raw: null,
      decoded: undefined,
    };
  }

  async present(
    ctx: RunContext,
    request: PresentationRequest,
    _held: HeldCredential,
    _opts: PresentOptions,
  ): Promise<void> {
    await ctx.awaitUserAction({
      step: 'present',
      title: `Share the credential from ${this.manifest.label}`,
      instructions:
        'Scan this OpenID4VP request with the same wallet and approve sharing. The verifier will report the result automatically once it arrives.',
      uri: request.requestUri,
    });

    ctx.recordExternalExchange({
      label: 'Authorization Response (not captured)',
      from: this.manifest.label,
      to: 'Verifier',
      method: 'POST',
      url: request.responseUri,
      requestHeaders: {},
      error: 'Posted by the wallet device directly to the verifier; payload visible only in the verifier result.',
    });
  }
}
