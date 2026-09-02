import type { RunConfig } from './domain.js';

/**
 * Guided starting points.
 *
 * Nine selectable participants across six dimensions is a lot to face with no
 * idea which combination is worth trying. Each scenario is a question worth
 * asking, phrased as a question, with the configuration that answers it and an
 * honest statement of what it will show — including the ones that fail, because
 * those are the ones that taught us the most.
 */
export interface Scenario {
  id: string;
  title: string;
  /** The question this run answers. */
  question: string;
  /** What actually happens, stated up front — including expected failures. */
  expect: string;
  /** Roughly how long, so nobody waits on a run that needs a phone. */
  duration: 'seconds' | 'needs-a-phone';
  /** Participants that must be reachable; used to grey out what cannot run. */
  requires: string[];
  config: Partial<RunConfig> & Pick<RunConfig, 'issuerId' | 'walletId' | 'verifierId' | 'format'>;
  /** Ordering hint for the UI; lower comes first. */
  order: number;
  /**
   * Which group the scenario belongs to in the UI. Thirteen equally-weighted
   * cards is a wall; three named groups say what kind of question each one is.
   * Not derivable from `requires` — the Collab audit needs no local
   * participant but is still a run against somebody else's software.
   */
  track: ScenarioTrack;
}

export type ScenarioTrack = 'core' | 'negative' | 'real';

export const SCENARIO_TRACKS: Array<{ id: ScenarioTrack; title: string; blurb: string }> = [
  {
    id: 'core',
    title: 'The core loop',
    blurb: 'Issue, hold, present, verify — and the format and protocol variations of it that should all pass.',
  },
  {
    id: 'negative',
    title: 'Does it catch what it should?',
    blurb: 'Faults injected on purpose. These runs succeed by being rejected; they fail if the forgery gets through.',
  },
  {
    id: 'real',
    title: 'Against real implementations',
    blurb: 'The reference parts swapped for live Inji services and public sandboxes. This is where the findings come from.',
  },
];

const REFERENCE = {
  issuerId: 'reference-issuer',
  walletId: 'reference-wallet',
  verifierId: 'reference-verifier',
} as const;

export const SCENARIOS: Scenario[] = [
  {
    id: 'happy-path',
    title: 'Does the whole cycle work?',
    question: 'Issue a W3C JSON-LD credential, hold it, present it, verify it — end to end.',
    expect:
      'Passes, with around 25 conformance checks. Start here: it is the shape every other run is a variation on.',
    duration: 'seconds',
    requires: [],
    order: 1,
    track: 'core',
    config: { ...REFERENCE, format: 'ldp_vc', proofType: 'Ed25519Signature2020', tamper: 'none' },
  },
  {
    id: 'selective-disclosure',
    title: 'Can the holder reveal only part of a credential?',
    question: 'Issue an SD-JWT VC with five claims and present only the two the verifier asked for.',
    expect:
      'Passes. The inspector shows the withheld claims are still committed to by the issuer’s signature — the verifier can tell nothing was tampered with, without learning what it was.',
    duration: 'seconds',
    requires: [],
    order: 2,
    track: 'core',
    config: { ...REFERENCE, format: 'vc+sd-jwt', tamper: 'none' },
  },
  {
    id: 'forged-signature',
    title: 'Does the verifier catch a forged credential?',
    question: 'Corrupt a byte of the issuer’s signature after signing, then present it as normal.',
    expect:
      'Passes — because the verifier rejects it. A tampered run succeeds when the fault is caught; it fails only if the forgery gets through.',
    duration: 'seconds',
    requires: [],
    order: 3,
    track: 'negative',
    config: { ...REFERENCE, format: 'ldp_vc', tamper: 'break-signature' },
  },
  {
    id: 'revoked',
    title: 'Is a revoked credential still accepted?',
    question:
      'Issue a credential, revoke it through the issuer’s status list, then present it. The signature is still perfectly valid.',
    expect:
      'Passes — the verifier rejects on status. This is the one failure mode where everything is cryptographically correct and the answer is still no.',
    duration: 'seconds',
    requires: [],
    order: 4,
    track: 'negative',
    config: { ...REFERENCE, format: 'ldp_vc', tamper: 'revoke-credential' },
  },
  {
    id: 'mdoc',
    title: 'Does an ISO mobile driving licence work?',
    question: 'Issue an ISO/IEC 18013-5 mdoc and present it over OpenID4VP with device binding.',
    expect:
      'Passes. A completely different technology stack from the others — CBOR and COSE rather than JSON and JOSE — through the same playground.',
    duration: 'seconds',
    requires: [],
    order: 5,
    track: 'core',
    config: { ...REFERENCE, format: 'mso_mdoc', proofType: 'ES256', tamper: 'none' },
  },
  {
    id: 'replay',
    title: 'Can a captured presentation be replayed?',
    question: 'Sign the presentation over a nonce from a different exchange and send it anyway.',
    expect:
      'Passes — the verifier rejects it. This is what the nonce is for, and the check that proves it is doing its job.',
    duration: 'seconds',
    requires: [],
    order: 6,
    track: 'negative',
    config: { ...REFERENCE, format: 'ldp_vc', tamper: 'replay-nonce' },
  },
  {
    id: 'same-device',
    title: 'What changes in a same-device flow?',
    question:
      'Run the presentation as a redirect on one device rather than a QR code scanned by another, and try to redeem the response code twice.',
    expect:
      'Passes. The verifier hands back a one-time code instead of being polled, and refuses the second redemption.',
    duration: 'seconds',
    requires: [],
    order: 7,
    track: 'core',
    config: {
      ...REFERENCE,
      format: 'ldp_vc',
      flowMode: 'same-device',
      tamper: 'replay-response-code',
    },
  },
  {
    id: 'old-draft',
    title: 'Does a wallet on an older draft still work?',
    question: 'Speak OpenID4VCI draft 11 — a different endpoint, and a response that echoes the format.',
    expect:
      'Passes. The response shape is asserted against draft 11’s rules rather than draft 13’s, which is how revision drift gets caught instead of silently tolerated.',
    duration: 'seconds',
    requires: [],
    order: 8,
    track: 'core',
    config: { ...REFERENCE, format: 'ldp_vc', vciDraft: 'draft-11', tamper: 'none' },
  },
  {
    id: 'certify-real',
    title: 'What happens against real Inji Certify?',
    question: 'Swap the reference issuer for a live Inji Certify and change nothing else.',
    expect:
      'Fails, and that is the point. Around ten findings: a context that will not dereference, a placeholder issuer DID, a verification method pointing at a key set rather than a key. Needs the Inji stack running.',
    duration: 'seconds',
    requires: ['inji-certify'],
    order: 9,
    track: 'real',
    config: {
      issuerId: 'inji-certify',
      walletId: 'reference-wallet',
      verifierId: 'reference-verifier',
      format: 'ldp_vc',
      tamper: 'none',
    },
  },
  {
    id: 'verify-real',
    title: 'What happens against real Inji Verify?',
    question: 'Send a conformant credential from the reference issuer to a live Inji Verify.',
    expect:
      'Fails at verification. Direct credential verification isolates it to the credential rather than the exchange — the JSON-LD context cannot be loaded. Needs the Inji stack running.',
    duration: 'seconds',
    requires: ['inji-verify'],
    order: 10,
    track: 'real',
    config: {
      issuerId: 'reference-issuer',
      walletId: 'reference-wallet',
      verifierId: 'inji-verify',
      format: 'ldp_vc',
      tamper: 'none',
    },
  },
  {
    id: 'x5c-vs-did',
    title: 'Why does Inji Verify reject our SD-JWT?',
    question:
      'Send the same SD-JWT to a live Inji Verify twice — once naming the issuer key by DID, once with a certificate chain embedded.',
    expect:
      'The x5c run passes end to end; the DID run is rejected. Same credential, same issuer, one difference. Needs the Inji stack running.',
    duration: 'seconds',
    requires: ['inji-verify'],
    order: 11,
    track: 'real',
    config: {
      issuerId: 'reference-issuer',
      walletId: 'reference-wallet',
      verifierId: 'inji-verify',
      format: 'vc+sd-jwt',
      issuerKeyReference: 'x5c',
      tamper: 'none',
    },
  },
  {
    id: 'collab-audit',
    title: 'Is the public MOSIP Collab sandbox conformant?',
    question:
      "Audit the metadata of MOSIP's own hosted Certify — discovery only, since issuance there needs an interactive eSignet login.",
    expect:
      'Fails on metadata conformance, and independently confirms the local findings: the authorization server metadata and JWKS are both absent from the credential issuer identifier. Needs internet access, not the local stack.',
    duration: 'seconds',
    requires: [],
    order: 12,
    track: 'real',
    config: {
      issuerId: 'inji-certify',
      walletId: 'reference-wallet',
      verifierId: 'reference-verifier',
      format: 'ldp_vc',
      // Discovery only: Collab's Certify delegates authorization to eSignet and
      // exposes no working pre-authorized code grant, so nothing can be issued
      // without a person logging in. The metadata is still worth checking.
      stopAfter: 'discover',
      tamper: 'none',
      overrides: {
        'inji-certify': {
          baseUrl: 'https://injicertify-mock.collab.mosip.net',
          apiBaseUrl: 'https://injicertify-mock.collab.mosip.net/v1/certify',
          credentialConfigurationId: 'MockVerifiableCredential',
          version: 'collab',
        },
      },
    },
  },
  {
    id: 'certify-admin',
    title: "Can a new credential type be registered over Certify's API?",
    question:
      "Round-trip a credential configuration through Certify's admin API, then ask whether the new type is offerable — and drive the issuance authorization endpoint that asks for a credential before it will issue one.",
    expect:
      'Mixed, and both halves are worth knowing. Registration works and reaches discovery immediately, which is the good news. The rejection paths do not: a JSON body gets 403 rather than 415, and a missing parameter answers with a leaked Java controller signature. Writes and deletes a temporary configuration, so point it at a deployment you own. Needs the Inji stack running.',
    duration: 'seconds',
    requires: ['inji-certify'],
    order: 13,
    track: 'real',
    config: {
      ...REFERENCE,
      issuerId: 'inji-certify',
      format: 'ldp_vc',
      stopAfter: 'discover',
      overrides: { 'inji-certify': { auditAdminApi: 'on' } },
    },
  },
  {
    id: 'phone-wallet',
    title: 'Does it work with a real phone wallet?',
    question: 'Show a QR code, scan it with Inji Wallet, and let the phone talk to the issuer directly.',
    expect:
      'Needs a phone, and PUBLIC_URL set to something it can reach. The run is marked endpoint-only: the wallet’s own traffic is not captured, so it is weaker evidence than the others.',
    duration: 'needs-a-phone',
    requires: [],
    order: 14,
    track: 'real',
    config: {
      issuerId: 'reference-issuer',
      walletId: 'inji-wallet',
      verifierId: 'reference-verifier',
      format: 'ldp_vc',
      tamper: 'none',
    },
  },
];

/** Fills a scenario out into a complete run configuration. */
export function scenarioConfig(scenario: Scenario): RunConfig {
  return {
    proofType: 'Ed25519Signature2020',
    walletProofType: 'jwt',
    vciDraft: 'draft-13',
    flowMode: 'cross-device',
    tamper: 'none',
    ...scenario.config,
  };
}
