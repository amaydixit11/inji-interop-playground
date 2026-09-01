import { randomUUID, randomBytes } from 'node:crypto';
import { Router } from 'express';
import type { CredentialFormat, PresentationDefinition } from '@interop/shared';
import type { DocumentLoader } from '../core/jsonld.js';
import { verifyPresentation, type PresentationVerification } from '../core/presentation.js';
import { CREDENTIAL_TYPE, VCT, verifyJsonLdCredential } from '../core/credentials.js';
import { MDL_DOCTYPE } from '../core/mdoc.js';

/**
 * A standards-compliant OpenID4VP relying party, served over real HTTP.
 *
 * Uses `response_mode=direct_post`, which is the mode every wallet in this
 * ecosystem supports and the only one that works for a cross-device QR flow
 * without a browser redirect back to the verifier.
 */

interface VerificationSession {
  transactionId: string;
  requestId: string;
  nonce: string;
  state: string;
  clientId: string;
  format: CredentialFormat;
  presentationDefinition: PresentationDefinition;
  createdAt: number;
  submission?: {
    vpToken: string;
    presentationSubmission?: unknown;
    receivedAt: number;
  };
  /** Same-device only: one-time code the wallet returns through the redirect. */
  responseCode?: string;
  responseCodeUsed?: boolean;
  sameDevice?: boolean;
  result?: PresentationVerification;
  error?: { error: string; description?: string };
}

export interface MockVerifierDeps {
  publicUrl: string;
  basePath: string;
  documentLoader: () => DocumentLoader;
  /** Maps a published URL onto one this process can dial. */
  resolveUrl?: (url: string) => string;
}

/** Builds a Presentation Exchange definition constraining to our test type. */
export function buildPresentationDefinition(format: CredentialFormat): PresentationDefinition {
  const isSdJwt = format === 'vc+sd-jwt' || format === 'dc+sd-jwt';

  if (format === 'mso_mdoc') {
    return {
      id: 'interop-playground-mso-mdoc',
      name: 'Interop Playground mDL Verification',
      purpose: 'Demonstrate an end-to-end OpenID4VP exchange with an ISO 18013-5 mdoc.',
      input_descriptors: [
        {
          id: 'interop-test-mdl',
          name: 'Interop Test mDL',
          // mdoc constraints address data elements inside a namespace rather
          // than JSON paths into a credential document.
          format: { mso_mdoc: { alg: ['ES256'] } },
          constraints: {
            fields: [
              // Constrains the document type as well as the elements. Without
              // this a reader would accept any correctly signed mdoc, of any
              // kind, as satisfying a request for a driving licence.
              { path: ['$.docType'], filter: { type: 'string', const: MDL_DOCTYPE } },
              { path: ['$.given_name'] },
              { path: ['$.birth_date'] },
            ],
            limit_disclosure: 'required',
          },
        },
      ],
    };
  }

  return {
    id: `interop-playground-${format.replace(/\W+/g, '-')}`,
    name: 'Interop Playground Verification',
    purpose: 'Demonstrate an end-to-end OpenID4VP exchange with the selected credential format.',
    input_descriptors: [
      {
        id: 'interop-test-credential',
        name: 'Interop Test Credential',
        purpose: 'Prove possession of a credential issued during this playground run.',
        format: isSdJwt
          ? { [format]: { 'sd-jwt_alg_values': ['EdDSA', 'ES256'], 'kb-jwt_alg_values': ['ES256', 'EdDSA'] } }
          : { ldp_vc: { proof_type: ['Ed25519Signature2020', 'Ed25519Signature2018', 'RsaSignature2018'] } },
        constraints: {
          fields: isSdJwt
            ? [
                { path: ['$.vct'], filter: { type: 'string', const: VCT } },
                // Named explicitly so the wallet can withhold everything else.
                // `limit_disclosure` on its own only says "send the minimum" —
                // without naming fields there is no minimum to compute, and a
                // conformant wallet has no choice but to send the lot.
                { path: ['$.fullName'] },
                { path: ['$.dateOfBirth'] },
              ]
            : [{ path: ['$.type'], filter: { type: 'array', contains: { const: CREDENTIAL_TYPE } } }],
          // Selective disclosure is the point of SD-JWT; ask for it explicitly
          // so a wallet that ignores the hint shows up as a finding.
          ...(isSdJwt ? { limit_disclosure: 'required' as const } : {}),
        },
      },
    ],
  };
}

export function createMockVerifier(deps: MockVerifierDeps): Router {
  const router = Router();
  const sessions = new Map<string, VerificationSession>();
  const byRequestId = new Map<string, VerificationSession>();
  const byState = new Map<string, VerificationSession>();

  const base = () => new URL(deps.basePath, deps.publicUrl).toString().replace(/\/$/, '');

  router.post('/requests', (req, res) => {
    const format = (req.body?.format ?? 'ldp_vc') as CredentialFormat;
    const session: VerificationSession = {
      transactionId: `txn-${randomUUID()}`,
      requestId: `req-${randomUUID()}`,
      nonce: randomBytes(16).toString('base64url'),
      state: randomBytes(12).toString('base64url'),
      // client_id identifies the relying party to the wallet. Using the
      // response URI itself follows the `redirect_uri` client-id scheme, which
      // needs no pre-registration — appropriate for a sandbox.
      clientId: req.body?.clientId ?? `${base()}/response`,
      format,
      presentationDefinition: req.body?.presentationDefinition ?? buildPresentationDefinition(format),
      createdAt: Date.now(),
      sameDevice: req.body?.sameDevice === true,
    };

    sessions.set(session.transactionId, session);
    byRequestId.set(session.requestId, session);
    byState.set(session.state, session);

    const authorizationRequest = buildAuthorizationRequest(session, base());
    const requestUri = `${base()}/request/${session.requestId}`;

    res.status(201).json({
      transaction_id: session.transactionId,
      request_id: session.requestId,
      request_uri: requestUri,
      authorization_request: authorizationRequest,
      nonce: session.nonce,
      state: session.state,
      response_uri: `${base()}/response`,
      // Passing the request by reference keeps the QR small; a fully inlined
      // presentation_definition frequently exceeds what a phone camera can
      // reliably decode, which is itself a real interoperability constraint.
      deeplink: `openid4vp://authorize?client_id=${encodeURIComponent(session.clientId)}&request_uri=${encodeURIComponent(requestUri)}`,
      deeplink_by_value: `openid4vp://authorize?${new URLSearchParams(
        flattenAuthorizationRequest(authorizationRequest),
      ).toString()}`,
    });
  });

  router.get('/request/:requestId', (req, res) => {
    const session = byRequestId.get(req.params.requestId);
    if (!session) {
      res.status(404).json({ error: 'invalid_request', error_description: 'Unknown request id' });
      return;
    }
    res.json(buildAuthorizationRequest(session, base()));
  });

  router.get('/presentation-definition/:requestId', (req, res) => {
    const session = byRequestId.get(req.params.requestId);
    if (!session) {
      res.status(404).json({ error: 'invalid_request', error_description: 'Unknown request id' });
      return;
    }
    res.json(session.presentationDefinition);
  });

  /** OpenID4VP `direct_post` response endpoint. */
  router.post('/response', async (req, res) => {
    const state = req.body?.state as string | undefined;
    const session = state ? byState.get(state) : undefined;

    if (!session) {
      res.status(404).json({ error: 'invalid_request', error_description: 'Unknown or expired state' });
      return;
    }

    if (req.body?.error) {
      session.error = { error: String(req.body.error), description: req.body.error_description };
      res.json({ status: 'received' });
      return;
    }

    const vpToken = req.body?.vp_token as string | undefined;
    if (!vpToken) {
      res.status(400).json({ error: 'invalid_request', error_description: 'vp_token is required' });
      return;
    }

    let presentationSubmission: unknown;
    if (typeof req.body?.presentation_submission === 'string') {
      try {
        presentationSubmission = JSON.parse(req.body.presentation_submission);
      } catch {
        presentationSubmission = req.body.presentation_submission;
      }
    } else {
      presentationSubmission = req.body?.presentation_submission;
    }

    session.submission = { vpToken, presentationSubmission, receivedAt: Date.now() };

    try {
      session.result = await verifyPresentation({
        vpToken,
        nonce: session.nonce,
        audience: session.clientId,
        presentationDefinition: session.presentationDefinition,
        responseUri: `${base()}/response`,
        resolveUrl: deps.resolveUrl,
        documentLoader: deps.documentLoader(),
      });
    } catch (error) {
      session.error = {
        error: 'verification_failed',
        description: error instanceof Error ? error.message : String(error),
      };
    }

    // Same-device: the wallet is on the device the user is looking at, so the
    // verifier hands back a URL to return to rather than expecting to be
    // polled. The response code is what stops anyone who observes that
    // redirect from reading the result themselves.
    if (session.sameDevice) {
      session.responseCode = randomBytes(24).toString('base64url');
      session.responseCodeUsed = false;
      res.json({
        status: 'received',
        transaction_id: session.transactionId,
        redirect_uri: `${base()}/return?response_code=${session.responseCode}`,
      });
      return;
    }

    res.json({ status: 'received', transaction_id: session.transactionId });
  });

  /**
   * Redeems a same-device response code.
   *
   * Single use by design: a code that still works the second time turns the
   * redirect into a replayable handle on somebody else's presentation.
   */
  router.get('/return', (req, res) => {
    const code = req.query.response_code as string | undefined;
    const session = [...sessions.values()].find((entry) => entry.responseCode && entry.responseCode === code);

    if (!session) {
      res.status(404).json({ error: 'invalid_request', error_description: 'Unknown response code' });
      return;
    }
    if (session.responseCodeUsed) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'This response code has already been redeemed.',
      });
      return;
    }

    session.responseCodeUsed = true;
    res.json({ status: 'complete', transaction_id: session.transactionId });
  });

  /**
   * Verifies a credential on its own, with no presentation involved.
   *
   * Mirrors what Inji Verify exposes at /v2/vc-verification, so the two can be
   * compared directly on the same credential.
   */
  router.post('/verify-credential', async (req, res) => {
    const format = req.body?.format as CredentialFormat | undefined;
    const credential = req.body?.credential;

    if (format !== 'ldp_vc' || !credential || typeof credential !== 'object') {
      res.json({
        valid: true,
        expired: false,
        errors: [],
        skipped: `Direct verification is implemented for ldp_vc only; ${String(format)} was not checked.`,
      });
      return;
    }

    try {
      const result = await verifyJsonLdCredential(
        credential as Record<string, unknown>,
        deps.documentLoader(),
      );
      res.json({ valid: result.verified, expired: result.expired, errors: result.errors });
    } catch (error) {
      res.json({ valid: false, expired: false, errors: [error instanceof Error ? error.message : String(error)] });
    }
  });

  router.get('/result/:transactionId', (req, res) => {
    const session = sessions.get(req.params.transactionId);
    if (!session) {
      res.status(404).json({ error: 'invalid_request', error_description: 'Unknown transaction id' });
      return;
    }

    if (session.error) {
      res.json({ transaction_id: session.transactionId, status: 'error', ...session.error });
      return;
    }
    if (!session.submission || !session.result) {
      res.json({ transaction_id: session.transactionId, status: 'pending' });
      return;
    }

    res.json({
      transaction_id: session.transactionId,
      status: 'complete',
      verdict: session.result.verdict,
      checks: session.result.checks,
      claims: session.result.claims,
      presentation_submission: session.submission.presentationSubmission,
      vp_token: session.submission.vpToken,
    });
  });

  return router;
}

function buildAuthorizationRequest(session: VerificationSession, base: string): Record<string, unknown> {
  return {
    client_id: session.clientId,
    response_type: 'vp_token',
    response_mode: 'direct_post',
    response_uri: `${base}/response`,
    nonce: session.nonce,
    state: session.state,
    presentation_definition: session.presentationDefinition,
    client_metadata: {
      client_name: 'Playground Reference Verifier',
      vp_formats: {
        ldp_vp: { proof_type: ['Ed25519Signature2020', 'Ed25519Signature2018', 'RsaSignature2018'] },
        'vc+sd-jwt': { 'sd-jwt_alg_values': ['EdDSA', 'ES256'], 'kb-jwt_alg_values': ['ES256', 'EdDSA'] },
        'dc+sd-jwt': { 'sd-jwt_alg_values': ['EdDSA', 'ES256'], 'kb-jwt_alg_values': ['ES256', 'EdDSA'] },
      },
    },
  };
}

/** Flattens an authorization request into query parameters for by-value URIs. */
function flattenAuthorizationRequest(request: Record<string, unknown>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(request)) {
    flat[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return flat;
}
