import type { Participant, Role } from '@interop/shared';
import { ExternalIssuer, ExternalVerifier } from '../adapters/external.js';
import { HandheldWallet } from '../adapters/handheld-wallet.js';
import { InjiCertifyIssuer } from '../adapters/inji-certify.js';
import { InjiVerifyVerifier } from '../adapters/inji-verify.js';
import { ReferenceIssuer } from '../adapters/reference-issuer.js';
import { ReferenceVerifier } from '../adapters/reference-verifier.js';
import { ReferenceWallet } from '../adapters/reference-wallet.js';
import type { IssuerAdapter, VerifierAdapter, WalletAdapter } from '../adapters/types.js';
import type { DocumentLoader } from './jsonld.js';
import type { WalletKey } from './keys.js';

export interface RegistryDeps {
  publicUrl: string;
  walletKey: () => Promise<WalletKey>;
  documentLoader: () => DocumentLoader;
  env: {
    certifyBaseUrl: string;
    certifyConfigurationId: string;
    verifyBaseUrl: string;
    injiWebUrl: string;
  };
}

/**
 * The selectable implementations for each role.
 *
 * Adapters are constructed once and are stateless across runs; everything
 * run-specific lives on the RunContext, so two runs can execute concurrently
 * without interfering.
 */
export class Registry {
  readonly issuers: IssuerAdapter[];
  readonly wallets: WalletAdapter[];
  readonly verifiers: VerifierAdapter[];

  constructor(deps: RegistryDeps) {
    this.issuers = [
      new ReferenceIssuer(deps.publicUrl),
      new InjiCertifyIssuer({
        baseUrl: deps.env.certifyBaseUrl,
        credentialConfigurationId: deps.env.certifyConfigurationId,
      }),
      new ExternalIssuer(),
    ];

    this.wallets = [
      new ReferenceWallet({ walletKey: deps.walletKey, documentLoader: deps.documentLoader }),
      new HandheldWallet({
        id: 'inji-wallet',
        label: 'Inji Wallet (mobile)',
        kind: 'inji',
        summary:
          'The Inji Wallet app on a phone, driven by scanning QR codes. Exercises the real cross-device flow; wallet-side payloads are not captured.',
        constraints: [
          'Requires PUBLIC_URL to be an address the phone can reach; a localhost QR code cannot resolve.',
        ],
      }),
      new HandheldWallet({
        id: 'inji-web',
        label: 'Inji Web',
        kind: 'inji',
        summary:
          'The browser-based Inji wallet. Downloads only from issuers pre-registered in its Mimoto backend, so it cannot be paired with an arbitrary issuer.',
        launchUrl: deps.env.injiWebUrl,
        constraints: [
          'Its Mimoto backend takes an issuer_id from mimoto-issuers-config.json, not a credential offer, so the issuer must be registered there in advance.',
          'Credential download requires an authorization code, so an interactive user login is unavoidable.',
        ],
      }),
    ];

    this.verifiers = [
      new ReferenceVerifier(deps.publicUrl),
      new InjiVerifyVerifier({ baseUrl: deps.env.verifyBaseUrl }),
      new ExternalVerifier(),
    ];
  }

  participants(): Participant[] {
    return [
      ...this.issuers.map((a) => a.manifest),
      ...this.wallets.map((a) => a.manifest),
      ...this.verifiers.map((a) => a.manifest),
    ];
  }

  issuer(id: string): IssuerAdapter {
    return findOrThrow(this.issuers, id, 'issuer');
  }

  wallet(id: string): WalletAdapter {
    return findOrThrow(this.wallets, id, 'wallet');
  }

  verifier(id: string): VerifierAdapter {
    return findOrThrow(this.verifiers, id, 'verifier');
  }
}

function findOrThrow<T extends { manifest: Participant }>(items: T[], id: string, role: Role): T {
  const found = items.find((item) => item.manifest.id === id);
  if (!found) {
    throw new Error(`No ${role} registered with id "${id}". Available: ${items.map((i) => i.manifest.id).join(', ')}`);
  }
  return found;
}
