import type { StepId } from './domain.js';

/**
 * Plain-language explanations of what the protocols are doing and why.
 *
 * The playground's first stated purpose is helping people understand and trust
 * the stack, and a wall of raw JSON does not do that on its own. Every payload
 * in the inspector can be paired with a sentence saying what it is for and what
 * would go wrong without it — which is the difference between a tool that
 * proves something to an expert and one that teaches somebody else.
 *
 * Kept as data in the shared package rather than as prose in components, so the
 * same wording is reused by the timeline, the inspector and any report.
 */

export interface Explanation {
  /** One sentence: what this is. */
  what: string;
  /** Why the protocol has it at all — the failure it prevents. */
  why: string;
  /** What an experienced reader checks when looking at it. */
  lookFor?: string;
}

export const STEP_EXPLANATIONS: Record<StepId, Explanation> = {
  discover: {
    what: 'The wallet reads the issuer’s published metadata to learn where its endpoints are and what it can issue.',
    why: 'Nothing about an issuer is hard-coded into a wallet. Discovery is what lets a wallet it has never seen before work out how to talk to it — the whole basis of the "any wallet, any issuer" claim.',
    lookFor:
      'Whether the advertised formats and proof types match what the issuer actually produces later. A mismatch here is a promise the issuer does not keep.',
  },
  offer: {
    what: 'The issuer mints a credential offer: a short-lived token saying "come and collect this specific credential".',
    why: 'The offer is the only part of issuance the specification does not define, because it comes out of each issuer’s own business process. Everything after it is standard, which is why an offer can be handed to any conformant wallet.',
    lookFor:
      'A pre-authorized code means the wallet can proceed unattended. Only an authorization code means a human has to log in first.',
  },
  issue: {
    what: 'The wallet redeems the offer for an access token, proves it controls a key, and receives the signed credential.',
    why: 'The key binding proof is what stops a stolen offer being redeemed by somebody else: the issuer binds the credential to the key that asked for it, so possession of the credential alone is not enough to use it.',
    lookFor:
      'That the proof carries exactly one key identifier, and that the issuer bound that key into the credential — an SD-JWT without a `cnf` claim is not bound to anyone.',
  },
  present: {
    what: 'The verifier states what it needs, and the wallet builds a presentation containing only that.',
    why: 'A presentation is not the credential. It is a fresh, signed statement made to one verifier, for one request, bound to that verifier’s nonce — so it cannot be captured and reused elsewhere.',
    lookFor:
      'That the wallet echoed the verifier’s nonce, and disclosed only the claims that were asked for rather than everything it holds.',
  },
  verify: {
    what: 'The verifier checks the presentation and decides whether to trust it.',
    why: 'A signature only proves someone authentic signed something. A verifier also has to establish that the credential has not expired or been revoked, that it is the kind of credential requested, and that the presenter is its subject.',
    lookFor:
      'Whether every one of those was actually checked. A verifier that reports "valid" without checking status will accept a credential the issuer has already revoked.',
  },
};

/**
 * Explanations keyed by the label the adapters give each exchange.
 *
 * Matched on a prefix, so a label carrying extra detail — the protocol revision,
 * say — still resolves.
 */
export const EXCHANGE_EXPLANATIONS: Array<{ prefix: string; explanation: Explanation }> = [
  {
    prefix: 'Issuer Metadata Discovery',
    explanation: {
      what: 'A GET of `/.well-known/openid-credential-issuer`, the document every OpenID4VCI issuer must publish.',
      why: 'It is the entry point: without it a wallet has no way to find the credential endpoint or learn which formats are on offer.',
      lookFor: '`credential_configurations_supported` — the draft-13 shape. Older issuers use `credentials_supported`, which newer wallets do not read.',
    },
  },
  {
    prefix: 'Authorization Server Metadata Discovery',
    explanation: {
      what: 'RFC 8414 metadata describing the server that issues access tokens.',
      why: 'The issuer and its authorization server need not be the same party. This is how a wallet finds the token endpoint rather than guessing.',
      lookFor:
        'That the token endpoint is somewhere that can actually redeem this issuer’s codes. Pointing at a different origin is a common misconfiguration.',
    },
  },
  {
    prefix: 'Create Credential Offer',
    explanation: {
      what: 'A playground-internal call asking the issuer to mint an offer. Not part of OpenID4VCI.',
      why: 'Every issuer exposes its own API for this, because what makes someone eligible for a credential is business logic, not protocol.',
    },
  },
  {
    prefix: 'Create Pre-Authorized Offer',
    explanation: {
      what: 'Inji Certify’s own endpoint for minting an offer against a set of claims.',
      why: 'The pre-authorized code grant lets issuance complete without an interactive login, which is what makes an unattended test possible at all.',
    },
  },
  {
    prefix: 'Authorization Request (PKCE)',
    explanation: {
      what: 'The wallet sends the browser to the authorization server to log the holder in, carrying a PKCE `code_challenge`.',
      why: 'Issuance behind a login is how most real deployments work. PKCE binds the code that comes back to this wallet, so an intercepted code is useless to anyone else.',
      lookFor: '`code_challenge_method=S256`. `plain`, or no challenge at all, leaves the code redeemable by whoever sees it.',
    },
  },
  {
    prefix: 'eSignet:',
    explanation: {
      what: 'eSignet’s own login steps: fetch the client’s details, authenticate the holder, confirm the claims, issue the code.',
      why: 'eSignet is MOSIP’s authorization server; these are its API rather than OpenID4VCI, and they end in the authorization code the wallet redeems.',
    },
  },
  {
    prefix: 'Token + Credential Request',
    explanation: {
      what: 'Inji Web’s backend, Mimoto, redeems the authorization code with the PKCE verifier and fetches the credential from Certify on the wallet’s behalf.',
      why: 'The browser never holds the access token. Mimoto does the OpenID4VCI token and credential requests server-side and returns the result, here as a PDF with a QR code.',
      lookFor: 'That `code_verifier` is sent: it is what proves the redeemer is the wallet that started the login.',
    },
  },
  {
    prefix: 'Authorization Request (INJI_OVP)',
    explanation: {
      what: 'Inji Verify sends the browser to Inji Web with an OpenID4VP request, from the online-sharing QR on the credential.',
      why: 'The QR names where the credential can be fetched, not the credential itself, so it stays small and the wallet can refuse a second use.',
    },
  },
  {
    prefix: 'Token Request',
    explanation: {
      what: 'The wallet exchanges the pre-authorized code from the offer for an access token.',
      why: 'The code is single-use and short-lived, so an offer that leaks is only briefly useful and only once.',
      lookFor: 'A `c_nonce` in the response — the value the wallet must sign into its key binding proof to make it replay-proof.',
    },
  },
  {
    prefix: 'Nonce Request',
    explanation: {
      what: 'A call to the dedicated nonce endpoint introduced in OpenID4VCI 1.0.',
      why: 'Earlier drafts returned the nonce with the access token. 1.0 separated them, so a wallet has to support both to work across revisions.',
    },
  },
  {
    prefix: 'Credential Request',
    explanation: {
      what: 'The wallet presents its access token and key binding proof, and receives the credential.',
      why: 'The proof is a JWT signed by the holder’s key over the issuer’s nonce. It proves the requester controls the key the credential will be bound to.',
      lookFor:
        'Exactly one of `jwk`, `kid` or `x5c` in the proof header — OpenID4VCI §7.2.1 requires one and only one, and real issuers reject a proof carrying two.',
    },
  },
  {
    prefix: 'Direct Credential Verification',
    explanation: {
      what: 'The credential submitted to the verifier on its own, with no presentation involved.',
      why: 'It separates two questions an end-to-end result conflates: whether the verifier can read this credential at all, and whether the exchange works. When something fails, this says which.',
    },
  },
  {
    prefix: 'Create Authorization Request',
    explanation: {
      what: 'The verifier states what it wants, as an OpenID4VP authorization request.',
      why: 'It carries the presentation definition — the machine-readable statement of which credential and which claims — plus a nonce that binds any response to this request.',
      lookFor: 'The nonce, and whether the request is passed by value or by reference. By value can exceed what a QR code can carry.',
    },
  },
  {
    prefix: 'Create VP Request',
    explanation: {
      what: 'Inji Verify’s own API for creating a presentation request.',
      why: 'A verifier-facing convenience layer rather than a protocol surface; the conformant request object is served separately at the request URI.',
    },
  },
  {
    prefix: 'Fetch Request Object',
    explanation: {
      what: 'The signed request object a wallet retrieves when the request is passed by reference.',
      why: 'Signing it is what lets a wallet establish the request genuinely came from the client it names — which matters most in the cross-device flow, where the user cannot see the verifier’s address bar.',
    },
  },
  {
    prefix: 'Authorization Response',
    explanation: {
      what: 'The wallet posts the `vp_token` — the presentation — straight to the verifier.',
      why: '`direct_post` sends the response server-to-server rather than through the browser, so the presentation never appears in a URL, a redirect chain or browser history.',
      lookFor: 'The `presentation_submission`, which tells the verifier where inside the token to find each thing it asked for.',
    },
  },
  {
    prefix: 'Follow Same-Device Redirect',
    explanation: {
      what: 'The wallet redeems the one-time response code the verifier handed back.',
      why: 'On one device the verifier cannot poll — it has to hand control back. The code is what stops anyone who observes that redirect from reading the result.',
    },
  },
  {
    prefix: 'Poll Verification Result',
    explanation: {
      what: 'The verifier being asked whether a presentation has arrived yet.',
      why: 'In a cross-device flow the response arrives on a different device, so the page the user is looking at has no other way to learn the outcome.',
    },
  },
  {
    prefix: 'Fetch Verification Result',
    explanation: {
      what: 'The verifier’s full verdict, with its individual checks.',
      why: 'The interesting part is never the verdict on its own — it is which checks ran and which did not.',
    },
  },
];

/** Finds the explanation for an exchange label, if there is one. */
export function explainExchange(label: string): Explanation | undefined {
  return EXCHANGE_EXPLANATIONS.find((entry) => label.startsWith(entry.prefix))?.explanation;
}
