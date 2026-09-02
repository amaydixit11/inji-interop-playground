import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { JWK } from 'jose';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, type KeyLike } from 'jose';
import type {
  CredentialFormat,
  GrantType,
  IssuerKeyReference,
  ProofType,
  TamperMode,
  VcVersion,
} from '@interop/shared';
import { AUTHORIZATION_CODE_GRANT, PRE_AUTHORIZED_CODE_GRANT } from '@interop/shared';
import { mintCredential, CREDENTIAL_TYPE, VCT, DEFAULT_CLAIMS } from '../core/credentials.js';
import { MDL_DOCTYPE } from '../core/mdoc.js';
import { DEFAULT_STATUS_LIST_LENGTH, StatusList } from '../core/statuslist.js';
import { signStatusListCredential, signTokenStatusList } from '../core/credentials.js';
import { PLAYGROUND_CONTEXT_PATH, type DocumentLoader } from '../core/jsonld.js';
import type { IssuerKey } from '../core/keys.js';

/**
 * A standards-compliant OpenID4VCI issuer, served over real HTTP.
 *
 * Implemented as an actual endpoint rather than an in-process stub for two
 * reasons: every exchange then appears in the protocol inspector as genuine
 * traffic, and a third-party wallet can be pointed at it to test the other
 * direction of interoperability.
 *
 * Supports the pre-authorized code grant only. That is deliberate — it is the
 * one grant that needs no interactive user authentication, which is what lets
 * the playground run an unattended end-to-end test.
 */

interface PendingOffer {
  id: string;
  preAuthorizedCode: string;
  configurationId: string;
  format: CredentialFormat;
  claims: Record<string, unknown>;
  /** Data Integrity suite to sign with, for JSON-LD credentials. */
  proofType: ProofType;
  /** W3C data model revision for JSON-LD credentials. */
  vcVersion: VcVersion;
  /** How an SD-JWT names its issuer key. */
  issuerKeyReference: IssuerKeyReference;
  /** Which grant this offer advertises. */
  grantType: GrantType;
  /** Deliberate corruption to apply when this offer is redeemed. */
  tamper: TamperMode;
  txCode?: string;
  createdAt: number;
  expiresIn: number;
}

interface IssuedToken {
  accessToken: string;
  cNonce: string;
  offer: PendingOffer;
  expiresAt: number;
}

/** An authorization request awaiting the code exchange. */
interface PendingAuthorization {
  code: string;
  offer: PendingOffer;
  redirectUri: string;
  /** PKCE challenge; the verifier of it must hash to this. */
  codeChallenge?: string;
  codeChallengeMethod?: string;
  createdAt: number;
  used: boolean;
}

export interface MockIssuerDeps {
  publicUrl: string;
  basePath: string;
  issuerKey: () => Promise<IssuerKey>;
  documentLoader: () => DocumentLoader;
}

/** Credential configurations advertised in `.well-known/openid-credential-issuer`. */
export function credentialConfigurations(publicUrl: string): Record<string, unknown> {
  const contextUrl = new URL(PLAYGROUND_CONTEXT_PATH, publicUrl).toString();
  return {
    InteropTestCredential_ldp_vc: {
      format: 'ldp_vc',
      scope: 'InteropTestCredential',
      cryptographic_binding_methods_supported: ['did:web', 'did:jwk'],
      credential_signing_alg_values_supported: ['Ed25519Signature2020', 'Ed25519Signature2018', 'RsaSignature2018'],
      proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256', 'EdDSA'] } },
      credential_definition: {
        '@context': ['https://www.w3.org/2018/credentials/v1', contextUrl],
        type: ['VerifiableCredential', CREDENTIAL_TYPE],
      },
      display: [{ name: 'Interop Test Credential', locale: 'en', background_color: '#0f172a', text_color: '#f8fafc' }],
    },
    InteropTestCredential_sd_jwt: {
      format: 'vc+sd-jwt',
      scope: 'InteropTestCredential',
      vct: VCT,
      cryptographic_binding_methods_supported: ['jwk', 'did:web'],
      credential_signing_alg_values_supported: ['EdDSA'],
      proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256', 'EdDSA'] } },
      display: [{ name: 'Interop Test Credential (SD-JWT)', locale: 'en' }],
    },
    InteropTestCredential_mdoc: {
      format: 'mso_mdoc',
      scope: 'InteropTestCredential',
      doctype: MDL_DOCTYPE,
      // The MobileSecurityObject binds a COSE_Key, so the holder key has to be
      // supplied as a raw JWK rather than referenced by a DID.
      cryptographic_binding_methods_supported: ['jwk'],
      credential_signing_alg_values_supported: ['ES256'],
      proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
      display: [{ name: 'Interop Test mDL (ISO 18013-5)', locale: 'en' }],
    },
    InteropTestCredential_dc_sd_jwt: {
      format: 'dc+sd-jwt',
      scope: 'InteropTestCredential',
      vct: VCT,
      cryptographic_binding_methods_supported: ['jwk', 'did:web'],
      credential_signing_alg_values_supported: ['EdDSA'],
      proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256', 'EdDSA'] } },
      display: [{ name: 'Interop Test Credential (dc+sd-jwt)', locale: 'en' }],
    },
  };
}

/** Maps a requested format onto the configuration id that provides it. */
export function configurationIdForFormat(format: CredentialFormat): string {
  switch (format) {
    case 'ldp_vc':
      return 'InteropTestCredential_ldp_vc';
    case 'vc+sd-jwt':
      return 'InteropTestCredential_sd_jwt';
    case 'dc+sd-jwt':
      return 'InteropTestCredential_dc_sd_jwt';
    case 'mso_mdoc':
      return 'InteropTestCredential_mdoc';
    default:
      throw new Error(`The built-in issuer does not support ${format}`);
  }
}

export const STATUS_LIST_ID = 'revocation-1';

export function createMockIssuer(deps: MockIssuerDeps): Router {
  const router = Router();

  // One revocation list for every credential this issuer mints. Indices are
  // handed out sequentially; a real issuer would allocate them from a database
  // and shard across several lists.
  const statusList = new StatusList(DEFAULT_STATUS_LIST_LENGTH);
  let nextStatusIndex = 0;
  let reusedStatusIndices = false;
  const offers = new Map<string, PendingOffer>();
  const tokensByCode = new Map<string, PendingOffer>();
  const authorizations = new Map<string, PendingAuthorization>();
  const tokens = new Map<string, IssuedToken>();
  const issuedNonces = new Set<string>();

  const base = () => new URL(deps.basePath, deps.publicUrl).toString().replace(/\/$/, '');

  router.get('/.well-known/openid-credential-issuer', (_req, res) => {
    res.json({
      credential_issuer: base(),
      credential_endpoint: `${base()}/credential`,
      nonce_endpoint: `${base()}/nonce`,
      authorization_servers: [base()],
      display: [{ name: 'Playground Reference Issuer', locale: 'en' }],
      credential_configurations_supported: credentialConfigurations(deps.publicUrl),
    });
  });

  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer: base(),
      token_endpoint: `${base()}/token`,
      authorization_endpoint: `${base()}/authorize`,
      jwks_uri: `${base()}/.well-known/jwks.json`,
      grant_types_supported: [PRE_AUTHORIZED_CODE_GRANT, AUTHORIZATION_CODE_GRANT],
      code_challenge_methods_supported: ['S256'],
      response_types_supported: ['code'],
      'pre-authorized_grant_anonymous_access_supported': true,
    });
  });

  /**
   * Authorization endpoint.
   *
   * A real deployment shows a login and a consent screen here. This one grants
   * immediately, so the grant can be exercised unattended — the interop surface
   * being tested is the request parameters, the redirect and the PKCE binding,
   * none of which depends on who is looking at the screen. The run records that
   * consent was automatic so nobody reads it as a tested login.
   */
  router.get('/authorize', (req, res) => {
    const offerId = req.query.issuer_state as string | undefined;
    const redirectUri = req.query.redirect_uri as string | undefined;
    const responseType = req.query.response_type as string | undefined;
    const state = req.query.state as string | undefined;

    const offer = offerId ? offers.get(offerId) : undefined;
    if (!offer) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'issuer_state does not identify a pending credential offer',
      });
      return;
    }
    if (responseType !== 'code') {
      res.status(400).json({ error: 'unsupported_response_type', error_description: 'Only "code" is supported' });
      return;
    }
    if (!redirectUri) {
      res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is required' });
      return;
    }

    const authorization: PendingAuthorization = {
      code: randomBytes(24).toString('base64url'),
      offer,
      redirectUri,
      codeChallenge: req.query.code_challenge as string | undefined,
      codeChallengeMethod: req.query.code_challenge_method as string | undefined,
      createdAt: Date.now(),
      used: false,
    };
    authorizations.set(authorization.code, authorization);

    // A redirect, as the specification requires — not a JSON body. A wallet
    // following the redirect is the behaviour under test.
    const target = new URL(redirectUri);
    target.searchParams.set('code', authorization.code);
    if (state) target.searchParams.set('state', state);
    res.redirect(302, target.toString());
  });

  router.get('/.well-known/jwks.json', async (_req, res) => {
    const key = await deps.issuerKey();
    res.json({ keys: [key.publicJwk, { ...key.mdocPublicJwk, kid: key.mdocKid }] });
  });

  // Published at the issuer identifier as well as at the did:web path, because
  // a Data Integrity verifier resolves key material from the issuer identifier
  // and should not have to know the DID method to find it.
  router.get('/.well-known/did.json', async (_req, res) => {
    res.json((await deps.issuerKey()).didDocument);
  });

  /**
   * Playground-internal: mints an offer. Not part of OpenID4VCI — real issuers
   * create offers from their own business flows.
   */
  router.post('/offers', (req, res) => {
    const format = (req.body?.format ?? 'ldp_vc') as CredentialFormat;
    let configurationId: string;
    try {
      configurationId = configurationIdForFormat(format);
    } catch (error) {
      res.status(400).json({ error: 'unsupported_credential_format', error_description: String(error) });
      return;
    }

    const offer: PendingOffer = {
      id: randomUUID(),
      preAuthorizedCode: randomBytes(24).toString('base64url'),
      configurationId,
      format,
      claims: (req.body?.claims as Record<string, unknown>) ?? DEFAULT_CLAIMS,
      // Carried on the offer rather than read from the credential request, so
      // the wallet driving the flow stays a plain protocol client.
      proofType: (req.body?.proofType as ProofType) ?? 'Ed25519Signature2020',
      vcVersion: (req.body?.vcVersion as VcVersion) ?? '1.1',
      issuerKeyReference: (req.body?.issuerKeyReference as IssuerKeyReference) ?? 'did',
      grantType: (req.body?.grantType as GrantType) ?? 'pre-authorized_code',
      tamper: (req.body?.tamper as TamperMode) ?? 'none',
      txCode: req.body?.txCode,
      createdAt: Date.now(),
      expiresIn: 600,
    };
    offers.set(offer.id, offer);
    tokensByCode.set(offer.preAuthorizedCode, offer);

    const offerObject = buildOffer(offer, base());
    res.status(201).json({
      offer_id: offer.id,
      credential_offer: offerObject,
      credential_offer_uri: `${base()}/credential-offer/${offer.id}`,
      // Both spellings are produced: `openid-credential-offer://` is what the
      // OpenID4VCI examples use, and it is what Inji Wallet registers for.
      offer_deeplink: `openid-credential-offer://?credential_offer=${encodeURIComponent(JSON.stringify(offerObject))}`,
      offer_by_reference: `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(`${base()}/credential-offer/${offer.id}`)}`,
    });
  });

  /**
   * The revocation list, published as an ordinary signed Verifiable Credential.
   *
   * Served with no-store because a verifier caching it would keep honouring a
   * credential the issuer has already revoked.
   */
  router.get('/status-list/:id', async (req, res) => {
    try {
      const credential = await signStatusListCredential({
        id: `${base()}/status-list/${req.params.id}`,
        issuerKey: await deps.issuerKey(),
        encodedList: statusList.encode(),
        documentLoader: deps.documentLoader(),
      });
      res.set('cache-control', 'no-store').type('application/ld+json').json(credential);
    } catch (error) {
      res.status(500).json({ error: 'status_list_unavailable', error_description: String(error) });
    }
  });

  /**
   * The same revocation list as a Token Status List JWT, for SD-JWT credentials.
   *
   * One list, two representations, because the two format families reference
   * status differently and a credential can only point at the one its own
   * specification defines.
   */
  router.get('/token-status-list/:id', async (req, res) => {
    try {
      const jwt = await signTokenStatusList({
        uri: `${base()}/token-status-list/${req.params.id}`,
        issuerKey: await deps.issuerKey(),
        encodedList: statusList.encode(),
      });
      res.set('cache-control', 'no-store').type('application/statuslist+jwt').send(jwt);
    } catch (error) {
      res.status(500).json({ error: 'status_list_unavailable', error_description: String(error) });
    }
  });

  /** Playground-internal: flips a credential's revocation bit. */
  router.post('/status-list/:id/revoke', (req, res) => {
    const index = Number(req.body?.index);
    if (!Number.isInteger(index)) {
      res.status(400).json({ error: 'invalid_request', error_description: 'index must be an integer' });
      return;
    }
    statusList.set(index, true);
    res.json({ status: 'revoked', index });
  });

  router.get('/credential-offer/:id', (req, res) => {
    const offer = offers.get(req.params.id);
    if (!offer) {
      res.status(404).json({ error: 'not_found', error_description: 'Unknown credential offer' });
      return;
    }
    res.json(buildOffer(offer, base()));
  });

  router.post('/token', (req, res) => {
    const grantType = req.body?.grant_type;
    const offer =
      grantType === AUTHORIZATION_CODE_GRANT
        ? redeemAuthorizationCode(req, res)
        : redeemPreAuthorizedCode(req, res);

    // The helpers answer the response themselves on failure.
    if (!offer) return;

    const issued: IssuedToken = {
      accessToken: randomBytes(32).toString('base64url'),
      cNonce: randomBytes(16).toString('base64url'),
      offer,
      expiresAt: Date.now() + 300_000,
    };
    tokens.set(issued.accessToken, issued);
    issuedNonces.add(issued.cNonce);

    res.json({
      access_token: issued.accessToken,
      token_type: 'Bearer',
      expires_in: 300,
      c_nonce: issued.cNonce,
      c_nonce_expires_in: 300,
      authorization_details: [
        { type: 'openid_credential', credential_configuration_id: offer.configurationId },
      ],
    });
  });

  /** Pre-authorized code: single use, short-lived, optionally PIN-bound. */
  function redeemPreAuthorizedCode(
    req: { body?: Record<string, string> },
    res: { status(code: number): { json(body: unknown): void } },
  ): PendingOffer | undefined {
    const grantType = req.body?.grant_type;
    if (grantType !== PRE_AUTHORIZED_CODE_GRANT) {
      res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: `Supported grants: ${PRE_AUTHORIZED_CODE_GRANT}, ${AUTHORIZATION_CODE_GRANT}`,
      });
      return undefined;
    }

    const code = req.body?.['pre-authorized_code'];
    const offer = code ? tokensByCode.get(code) : undefined;
    if (!offer) {
      res
        .status(400)
        .json({ error: 'invalid_grant', error_description: 'Unknown or already-redeemed pre-authorized code' });
      return undefined;
    }
    if (Date.now() - offer.createdAt > offer.expiresIn * 1000) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Pre-authorized code has expired' });
      return undefined;
    }
    if (offer.txCode && req.body?.tx_code !== offer.txCode) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'tx_code does not match' });
      return undefined;
    }

    // Single use: a replayed pre-authorized code must not yield a second token.
    if (code) tokensByCode.delete(code);
    return offer;
  }

  /**
   * Authorization code: single use, and bound to the PKCE challenge.
   *
   * The PKCE check is the point of the grant. Without it an intercepted
   * authorization code can be redeemed by whoever intercepted it, which is
   * precisely the attack PKCE exists to stop — so a verifier that does not
   * enforce it has the grant without its protection.
   */
  function redeemAuthorizationCode(
    req: { body?: Record<string, string> },
    res: { status(code: number): { json(body: unknown): void } },
  ): PendingOffer | undefined {
    const code = req.body?.code;
    const authorization = code ? authorizations.get(code) : undefined;

    if (!authorization) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown authorization code' });
      return undefined;
    }
    if (authorization.used) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code has already been redeemed' });
      return undefined;
    }
    if (Date.now() - authorization.createdAt > 600_000) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code has expired' });
      return undefined;
    }
    if (req.body?.redirect_uri && req.body.redirect_uri !== authorization.redirectUri) {
      res.status(400).json({
        error: 'invalid_grant',
        error_description: 'redirect_uri does not match the one the code was issued for',
      });
      return undefined;
    }

    if (authorization.codeChallenge) {
      const verifier = req.body?.code_verifier;
      if (!verifier) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier is required for this code' });
        return undefined;
      }
      const expected =
        authorization.codeChallengeMethod === 'plain'
          ? verifier
          : createHash('sha256').update(verifier, 'ascii').digest('base64url');

      if (expected !== authorization.codeChallenge) {
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'code_verifier does not match the code_challenge',
        });
        return undefined;
      }
    }

    authorization.used = true;
    return authorization.offer;
  }

  router.post('/nonce', (_req, res) => {
    const nonce = randomBytes(16).toString('base64url');
    issuedNonces.add(nonce);
    res.set('cache-control', 'no-store').json({ c_nonce: nonce, c_nonce_expires_in: 300 });
  });

  // Draft 11 and 12 carried the credential at a distinct path and echoed the
  // requested `format` in the response; draft 13 dropped the echo and 1.0
  // replaced the single `credential` with an array. Serving all three lets a
  // wallet be tested against the revision it actually implements.
  router.post('/vd11/credential', (req, res) => issueCredential(req, res, 'draft-11'));
  router.post('/vd12/credential', (req, res) => issueCredential(req, res, 'draft-12'));
  router.post('/credential', (req, res) => issueCredential(req, res, 'draft-13'));

  async function issueCredential(
    req: Parameters<Parameters<typeof router.post>[1]>[0],
    res: Parameters<Parameters<typeof router.post>[1]>[1],
    draft: 'draft-11' | 'draft-12' | 'draft-13',
  ): Promise<void> {
    const authorization = req.header('authorization') ?? '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const token = accessToken ? tokens.get(accessToken) : undefined;

    if (!token) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Missing or unknown access token' });
      return;
    }
    if (Date.now() > token.expiresAt) {
      res.status(401).json({ error: 'invalid_token', error_description: 'Access token has expired' });
      return;
    }

    const proof = req.body?.proof;
    let holderJwk: JWK | undefined;
    let holderDid: string | undefined;

    if (proof) {
      const verified = await verifyHolderProof(proof, issuedNonces, base());
      if ('error' in verified) {
        res.status(400).json({
          error: verified.error,
          error_description: verified.description,
          c_nonce: token.cNonce,
          c_nonce_expires_in: 300,
        });
        return;
      }
      holderJwk = verified.jwk;
      holderDid = verified.did;
    }

    const requestedFormat = (req.body?.format ?? token.offer.format) as CredentialFormat;
    if (requestedFormat !== token.offer.format) {
      res.status(400).json({
        error: 'unsupported_credential_format',
        error_description: `Offer was for ${token.offer.format} but the request asked for ${requestedFormat}`,
      });
      return;
    }

    try {
      // Allocated per issuance so each credential can be revoked individually.
      // Wraps rather than throwing at the end of the list. A long-lived
      // playground would otherwise stop issuing entirely once it had minted
      // 131,072 credentials, which is a worse failure than reusing an index
      // whose credential is long gone.
      const statusIndex = nextStatusIndex % DEFAULT_STATUS_LIST_LENGTH;
      nextStatusIndex = statusIndex + 1;
      if (statusIndex === 0 && nextStatusIndex === 1 && reusedStatusIndices) {
        console.warn('Status list indices have wrapped; earlier credentials now share an index.');
      }
      if (nextStatusIndex >= DEFAULT_STATUS_LIST_LENGTH) reusedStatusIndices = true;

      const minted = await mintCredential({
        format: token.offer.format,
        proofType: token.offer.proofType,
        vcVersion: token.offer.vcVersion,
        issuerKeyReference: token.offer.issuerKeyReference,
        claims: token.offer.claims,
        // JSON-LD points at a Verifiable Credential; SD-JWT at a JWT. mdoc has
        // no equivalent mechanism in 18013-5, so it gets none.
        status:
          token.offer.format === 'mso_mdoc'
            ? undefined
            : {
                id: `${base()}/status-list/${STATUS_LIST_ID}#${statusIndex}`,
                statusListCredential:
                  token.offer.format === 'ldp_vc'
                    ? `${base()}/status-list/${STATUS_LIST_ID}`
                    : `${base()}/token-status-list/${STATUS_LIST_ID}`,
                statusListIndex: String(statusIndex),
              },
        issuerKey: await deps.issuerKey(),
        publicUrl: deps.publicUrl,
        documentLoader: deps.documentLoader(),
        holderJwk,
        holderDid,
        tamper: token.offer.tamper,
      });

      // Access tokens are single use at the credential endpoint.
      tokens.delete(token.accessToken);

      // Revoked immediately after issuing, so the verifier meets a credential
      // that is cryptographically perfect and no longer valid.
      if (token.offer.tamper === 'revoke-credential') {
        statusList.set(statusIndex, true);
      }

      const body: Record<string, unknown> = {
        c_nonce: randomBytes(16).toString('base64url'),
        c_nonce_expires_in: 300,
      };

      if (draft === 'draft-11' || draft === 'draft-12') {
        // Pre-13 responses echo the format alongside the credential.
        body.format = token.offer.format;
        body.credential = minted.raw;
      } else {
        // Draft 13 dropped the format echo. The 1.0 `credentials` array is sent
        // alongside so a wallet on either revision can read the response; a
        // strict 1.0 wallet reads the array and ignores the scalar.
        body.credential = minted.raw;
        body.credentials = [{ credential: minted.raw }];
      }

      res.json(body);
    } catch (error) {
      res.status(500).json({
        error: 'credential_request_denied',
        error_description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return router;
}

/**
 * Builds the offer.
 *
 * Only the grant the run selected is advertised. An offer carrying both would
 * be realistic, but it would also let a wallet quietly use the other one — and
 * then the run would not be testing what it claims to.
 */
function buildOffer(offer: PendingOffer, issuer: string): Record<string, unknown> {
  const grants =
    offer.grantType === 'authorization_code'
      ? {
          authorization_code: {
            // Ties the authorization request back to this offer, so the issuer
            // knows which credential the user is consenting to.
            issuer_state: offer.id,
            authorization_server: issuer,
          },
        }
      : {
          [PRE_AUTHORIZED_CODE_GRANT]: {
            'pre-authorized_code': offer.preAuthorizedCode,
            ...(offer.txCode
              ? { tx_code: { input_mode: 'numeric', length: offer.txCode.length, description: 'Transaction code' } }
              : {}),
          },
        };

  return {
    credential_issuer: issuer,
    credential_configuration_ids: [offer.configurationId],
    grants,
  };
}

type ProofResult = { jwk?: JWK; did?: string } | { error: string; description: string };

/**
 * Validates a wallet's key-binding proof.
 *
 * The nonce check is the important one: without it an attacker could replay a
 * proof captured from another session, which is exactly the failure mode the
 * `c_nonce` mechanism exists to prevent.
 */
async function verifyHolderProof(
  proof: { proof_type?: string; jwt?: string },
  issuedNonces: Set<string>,
  audience: string,
): Promise<ProofResult> {
  if (proof.proof_type !== 'jwt' || !proof.jwt) {
    return { error: 'invalid_proof', description: 'Only proof_type "jwt" is supported' };
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(proof.jwt) as Record<string, unknown>;
    payload = decodeJwt(proof.jwt) as Record<string, unknown>;
  } catch {
    return { error: 'invalid_proof', description: 'Proof JWT could not be decoded' };
  }

  if (header.typ !== 'openid4vci-proof+jwt') {
    return { error: 'invalid_proof', description: `Expected typ "openid4vci-proof+jwt", got "${String(header.typ)}"` };
  }

  const nonce = payload.nonce;
  if (typeof nonce !== 'string' || !issuedNonces.has(nonce)) {
    return { error: 'invalid_proof', description: 'Proof nonce was not issued by this issuer or has already been used' };
  }
  issuedNonces.delete(nonce);

  if (payload.aud !== audience) {
    return { error: 'invalid_proof', description: `Proof audience "${String(payload.aud)}" does not match issuer "${audience}"` };
  }

  const jwk = header.jwk as JWK | undefined;
  const kid = header.kid as string | undefined;
  if (!jwk && !kid) {
    return { error: 'invalid_proof', description: 'Proof header must carry either a jwk or a kid' };
  }

  if (jwk) {
    try {
      const key = (await importJWK(jwk, header.alg as string)) as KeyLike;
      await jwtVerify(proof.jwt, key, { audience });
    } catch (error) {
      return { error: 'invalid_proof', description: `Proof signature did not verify: ${String(error)}` };
    }
  }

  // A `did:jwk` carries the key in the identifier itself, so holder binding
  // still works when the wallet chose a DID reference over a bare `jwk`.
  const resolved = jwk ?? decodeDidJwk(kid);
  if (!resolved) {
    return {
      error: 'invalid_proof',
      description: `Proof header carries kid "${String(kid)}", whose key cannot be resolved without a DID lookup this issuer does not perform.`,
    };
  }

  return { jwk: resolved, did: kid?.split('#')[0] };
}

/** Extracts the embedded public key from a `did:jwk` identifier. */
function decodeDidJwk(kid: string | undefined): JWK | undefined {
  if (!kid?.startsWith('did:jwk:')) return undefined;
  const encoded = kid.slice('did:jwk:'.length).split('#')[0];
  try {
    return JSON.parse(Buffer.from(encoded ?? '', 'base64url').toString('utf8')) as JWK;
  } catch {
    return undefined;
  }
}
