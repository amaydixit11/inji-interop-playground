import type { CredentialIssuerMetadata } from '@interop/shared';
import type { RunContext } from './context.js';

/**
 * Certify's administrative API surface, exercised for real.
 *
 * Two endpoints sit outside the OpenID4VCI loop but decide whether the
 * playground's central promise — "issue any credential type" — is actually
 * achievable against Certify:
 *
 * - `/credential-configurations` (POST/GET/PUT/DELETE) is how a credential type
 *   comes into existence. The question worth asking is not whether the four
 *   verbs return 200, but whether a type registered through them becomes
 *   *offerable* — whether it shows up in the discovery metadata a wallet reads.
 * - `/oauth/iar` is the Issuance Authorization Request: the wallet asks to be
 *   authorized and Certify may answer `require_interaction`, demanding a
 *   credential presentation over OpenID4VP before it will issue one. A
 *   credential-for-a-credential exchange, and the newest part of Certify's API.
 *
 * The CRUD probe writes, so it creates a configuration under its own reserved
 * key and deletes it again. It is opt-in for that reason: it must not run
 * against a shared deployment nobody asked us to mutate.
 */

/** Reserved key for the configuration this probe creates and removes. */
const PROBE_KEY = 'PlaygroundProbeCredential';

/** A complete ldp_vc configuration — the minimum Certify actually accepts. */
function probeConfiguration(scope: string) {
  return {
    credentialConfigKeyId: PROBE_KEY,
    credentialFormat: 'ldp_vc',
    scope,
    metaDataDisplay: [{ name: 'Playground Probe Credential', locale: 'en' }],
    contextURLs: ['https://www.w3.org/2018/credentials/v1'],
    credentialTypes: ['VerifiableCredential', 'PlaygroundProbeCredential'],
    signatureCryptoSuite: 'Ed25519Signature2020',
    signatureAlgo: 'EdDSA',
    keyManagerAppId: 'CERTIFY_VC_SIGN_ED25519',
    keyManagerRefId: 'ED25519_SIGN',
    displayOrder: ['name'],
  };
}

interface ConfigEnvelope {
  response?: { id?: string; status?: string } | null;
  errors?: Array<{ errorCode?: string; errorMessage?: string }>;
  id?: string;
  status?: string;
}

/** Reads Certify's response envelope, which differs per operation. */
function envelopeError(body: unknown): string | undefined {
  const envelope = body as ConfigEnvelope | undefined;
  const first = envelope?.errors?.[0];
  return first ? `${first.errorCode}: ${first.errorMessage}` : undefined;
}

/**
 * Round-trips a credential configuration and checks it becomes issuable.
 *
 * Cleans up after itself even when an assertion in the middle fails, because a
 * probe that leaves a half-registered credential type behind has broken the
 * deployment it was measuring.
 */
export async function auditCredentialConfigurations(
  ctx: RunContext,
  apiBase: string,
  metadataUrl: string,
): Promise<void> {
  const base = apiBase.replace(/\/$/, '');
  const scope = 'playground_probe_vc_ldp';
  let created = false;

  try {
    const create = await ctx.http<ConfigEnvelope>({
      label: 'Register Credential Configuration',
      from: 'Playground',
      to: 'Inji Certify',
      method: 'POST',
      url: `${base}/credential-configurations`,
      json: probeConfiguration(scope),
      allowNonOk: true,
    });

    const createError = envelopeError(create.body);
    created = create.status === 201 && !createError;

    ctx.expect(created, {
      id: 'certify.config.create',
      title: 'A credential configuration can be registered through the API',
      spec: 'Inji Certify credential-configurations API',
      pass: `POST returned ${create.status} and the configuration is active, so a credential type can be defined without editing configuration files and restarting.`,
      fail: `POST returned ${create.status}${createError ? ` — ${createError}` : ''}. A credential type cannot be registered through the API.`,
      attributedTo: 'issuer',
    });

    // A rejection has to be provoked to be measured. Asserting the error shape
    // only when the happy path happens to fail would pass vacuously on every
    // healthy deployment — reporting "errors carry the right status" on a run
    // where nothing was ever rejected.
    await checkRejectionShape(ctx, base);

    if (!created) return;

    // The question that matters: is the new type now offerable? A registration
    // API that does not reach discovery is a database write, not a feature.
    const metadata = await ctx.http<CredentialIssuerMetadata>({
      label: 'Issuer Metadata Discovery (after registration)',
      from: 'Playground',
      to: 'Inji Certify',
      url: metadataUrl,
      allowNonOk: true,
    });
    const advertised = Object.keys(metadata.body?.credential_configurations_supported ?? {});

    ctx.expect(advertised.includes(PROBE_KEY), {
      id: 'certify.config.advertised',
      title: 'A configuration registered through the API is advertised to wallets',
      spec: 'OpenID4VCI §11.2.3',
      pass: `${PROBE_KEY} appears in credential_configurations_supported immediately, alongside ${
        advertised.length - 1
      } pre-existing configuration(s). A credential type registered over the API is immediately issuable.`,
      fail: `${PROBE_KEY} was registered but is not in credential_configurations_supported (${advertised.join(', ')}). No wallet can request it.`,
      attributedTo: 'issuer',
    });

    const read = await ctx.http<Record<string, unknown>>({
      label: 'Read Credential Configuration',
      from: 'Playground',
      to: 'Inji Certify',
      url: `${base}/credential-configurations/${PROBE_KEY}`,
      allowNonOk: true,
    });

    ctx.expect(read.ok && read.body?.scope === scope, {
      id: 'certify.config.read',
      title: 'A configuration reads back as it was written',
      spec: 'Inji Certify credential-configurations API',
      pass: `GET returns the configuration with scope "${scope}".`,
      fail: `GET returned ${read.status} with scope ${JSON.stringify(read.body?.scope)}, not "${scope}".`,
      attributedTo: 'issuer',
    });

    const updatedScope = `${scope}_updated`;
    const update = await ctx.http<ConfigEnvelope>({
      label: 'Update Credential Configuration',
      from: 'Playground',
      to: 'Inji Certify',
      method: 'PUT',
      url: `${base}/credential-configurations/${PROBE_KEY}`,
      json: { ...probeConfiguration(updatedScope) },
      allowNonOk: true,
    });
    const reread = await ctx.http<Record<string, unknown>>({
      label: 'Read Credential Configuration (after update)',
      from: 'Playground',
      to: 'Inji Certify',
      url: `${base}/credential-configurations/${PROBE_KEY}`,
      allowNonOk: true,
    });

    ctx.expect(update.ok && reread.body?.scope === updatedScope, {
      id: 'certify.config.update',
      title: 'A configuration can be updated in place',
      spec: 'Inji Certify credential-configurations API',
      pass: `PUT returned ${update.status} and the scope now reads "${updatedScope}".`,
      fail: `PUT returned ${update.status} and the scope reads ${JSON.stringify(reread.body?.scope)}.`,
      attributedTo: 'issuer',
    });
  } finally {
    if (created) {
      const removed = await ctx.http<unknown>({
        label: 'Delete Credential Configuration',
        from: 'Playground',
        to: 'Inji Certify',
        method: 'DELETE',
        url: `${base}/credential-configurations/${PROBE_KEY}`,
        allowNonOk: true,
      });

      const gone = await ctx.http<ConfigEnvelope>({
        label: 'Read Credential Configuration (after delete)',
        from: 'Playground',
        to: 'Inji Certify',
        url: `${base}/credential-configurations/${PROBE_KEY}`,
        allowNonOk: true,
      });

      ctx.expect(removed.ok && gone.status === 404, {
        id: 'certify.config.delete',
        title: 'A configuration can be deleted, and is then gone',
        spec: 'Inji Certify credential-configurations API',
        pass: `DELETE returned ${removed.status} and a subsequent read returns 404.`,
        fail: `DELETE returned ${removed.status} and a subsequent read returns ${gone.status}. The probe configuration may still be registered on this deployment.`,
        attributedTo: 'issuer',
      });
    }
  }
}

/**
 * Posts a configuration Certify must refuse, and checks how it says no.
 *
 * `credentialConfigKeyId` is not in the DTO's `required` list, so omitting it
 * looks legitimate from the published schema.
 */
async function checkRejectionShape(ctx: RunContext, base: string): Promise<void> {
  const rejected = await ctx.http<ConfigEnvelope>({
    label: 'Register Credential Configuration (deliberately incomplete)',
    from: 'Playground',
    to: 'Inji Certify',
    method: 'POST',
    url: `${base}/credential-configurations`,
    json: {
      credentialFormat: 'ldp_vc',
      scope: 'playground_rejection_probe',
      metaDataDisplay: [{ name: 'Rejection probe', locale: 'en' }],
      contextURLs: ['https://www.w3.org/2018/credentials/v1'],
      credentialTypes: ['VerifiableCredential', 'PlaygroundRejectionProbe'],
      signatureCryptoSuite: 'Ed25519Signature2020',
    },
    allowNonOk: true,
  });

  const error = envelopeError(rejected.body);

  ctx.expect(Boolean(error) && rejected.status >= 400, {
    id: 'certify.config.error-status',
    title: 'A rejected configuration is reported with a non-2xx status',
    spec: 'RFC 9110 §15',
    pass: `Rejected with HTTP ${rejected.status}.`,
    fail: error
      ? `The configuration was rejected (${error}) but answered with HTTP ${rejected.status}. Every client that branches on the status code reads this as success, then fails on a null response body.`
      : `Expected a rejection and got HTTP ${rejected.status} with no error. The probe cannot tell how this deployment reports a bad configuration.`,
    attributedTo: 'issuer',
  });

  // A persistence-layer message means the request reached the database with no
  // validation in front of it, and says nothing about which field was wrong.
  const raw = /JPA|transaction|constraint|SQL|Hibernate/i.test(error ?? '');
  ctx.expect(!raw, {
    id: 'certify.config.error-message',
    title: 'A rejection names the offending field',
    spec: 'Inji Certify credential-configurations API',
    pass: `The rejection is actionable: "${error}".`,
    fail: `Omitting credentialConfigKeyId — which the published DTO does not mark required — surfaces a persistence error rather than a validation message: "${error}". The equivalent ldp_vc field check does name its fields, so validation exists; this path simply is not covered by it.`,
    attributedTo: 'issuer',
  });
}

interface IarResponse {
  status?: string;
  type?: string;
  auth_session?: string;
  openid4vp_request?: {
    response_uri?: string;
    response_type?: string;
    nonce?: string;
    client_id?: string;
    response_mode?: string;
    presentation_definition?: { id?: string; input_descriptors?: unknown[] };
  };
}

/**
 * Exercises the Issuance Authorization Request endpoint.
 *
 * Three questions: does it work, does it enforce PKCE properly, and does it
 * refuse a malformed request in a way a developer can act on.
 */
export async function auditIarEndpoint(
  ctx: RunContext,
  apiBase: string,
  configurationId: string,
): Promise<void> {
  const url = `${apiBase.replace(/\/$/, '')}/oauth/iar`;
  const authorizationDetails = JSON.stringify([
    { type: 'openid_credential', credential_configuration_id: configurationId },
  ]);
  // A real S256 challenge: the endpoint rejects `plain`, so a placeholder that
  // is not a digest would not distinguish a working request from a broken one.
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

  const accepted = await ctx.http<IarResponse>({
    label: 'Issuance Authorization Request',
    from: 'Playground',
    to: 'Inji Certify',
    method: 'POST',
    url,
    form: {
      response_type: 'code',
      client_id: 'inji-interop-playground',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      authorization_details: authorizationDetails,
    },
    allowNonOk: true,
  });

  const body = accepted.body;
  const request = body?.openid4vp_request;

  ctx.expect(accepted.ok && Boolean(body?.status), {
    id: 'certify.iar.accepts-request',
    title: 'The issuance authorization endpoint accepts a form-encoded request',
    spec: 'OpenID4VCI issuance authorization request',
    pass: `Returned "${body?.status}"${body?.type ? ` of type "${body.type}"` : ''}.`,
    fail: `Returned ${accepted.status}. The endpoint cannot be driven at all.`,
    attributedTo: 'issuer',
  });

  if (accepted.ok && body?.status === 'require_interaction') {
    ctx.artifact({ label: 'Issuance authorization request response', kind: 'json', value: body });

    // require_interaction means the issuer wants a credential before it will
    // issue one, so the request it hands back has to be answerable.
    const descriptors = request?.presentation_definition?.input_descriptors ?? [];
    ctx.expect(
      Boolean(request?.nonce && request?.response_uri && descriptors.length > 0 && body.auth_session),
      {
        id: 'certify.iar.interaction-request',
        title: 'An interaction demand carries a presentation request the wallet can answer',
        spec: 'OpenID4VP §5',
        pass: `Certify asks for a presentation before it will issue: ${descriptors.length} input descriptor(s) against "${request?.presentation_definition?.id}", with a nonce, a response_uri and an auth_session to correlate the answer. A credential is required to obtain a credential.`,
        fail: `The interaction demand is incomplete: nonce ${request?.nonce ? 'present' : 'missing'}, response_uri ${request?.response_uri ? 'present' : 'missing'}, ${descriptors.length} input descriptor(s), auth_session ${body.auth_session ? 'present' : 'missing'}.`,
        attributedTo: 'issuer',
      },
    );

    // response_mode: iar-post is not an OpenID4VP-registered value; a wallet
    // that only implements the registered modes will not know what to do.
    if (request?.response_mode && !['direct_post', 'direct_post.jwt'].includes(request.response_mode)) {
      ctx.check({
        id: 'certify.iar.response-mode',
        title: 'The presentation request uses a registered response mode',
        status: 'warn',
        spec: 'OpenID4VP §6.2',
        detail: `response_mode is "${request.response_mode}", which is not one of the registered OpenID4VP values (direct_post, direct_post.jwt). A wallet implementing only the registered modes cannot answer this request.`,
        attributedTo: 'issuer',
      });
    }
  }

  // PKCE downgrade: the whole point of a code challenge is that it is a digest.
  const plain = await ctx.http<{ error?: string; error_description?: string }>({
    label: 'Issuance Authorization Request (code_challenge_method=plain)',
    from: 'Playground',
    to: 'Inji Certify',
    method: 'POST',
    url,
    form: {
      response_type: 'code',
      client_id: 'inji-interop-playground',
      code_challenge: 'not-a-digest',
      code_challenge_method: 'plain',
      authorization_details: authorizationDetails,
    },
    allowNonOk: true,
  });

  ctx.expect(plain.status === 400, {
    id: 'certify.iar.pkce-s256-required',
    title: 'A PKCE downgrade to `plain` is refused',
    spec: 'RFC 7636 §4.2, OpenID4VCI §3.4',
    pass: `Rejected with ${plain.status}: ${plain.body?.error_description ?? plain.body?.error}. A challenge sent in the clear is no challenge at all, and Certify says so.`,
    fail: `Answered ${plain.status}. A wallet could send its verifier as the challenge and PKCE would protect nothing.`,
    attributedTo: 'issuer',
  });

  // A rejection has to be actionable, and must not describe the server's insides.
  const incomplete = await ctx.http<{ error?: string; error_description?: string }>({
    label: 'Issuance Authorization Request (no code_challenge)',
    from: 'Playground',
    to: 'Inji Certify',
    method: 'POST',
    url,
    form: {
      response_type: 'code',
      client_id: 'inji-interop-playground',
      authorization_details: authorizationDetails,
    },
    allowNonOk: true,
  });

  const description = incomplete.body?.error_description ?? '';
  const leaks = /org\.springframework|io\.mosip|java\.|ResponseEntity|Validation failed for argument/.test(
    description,
  );

  ctx.expect(!leaks, {
    id: 'certify.iar.error-description-clean',
    title: 'A rejection describes the request, not the server',
    spec: 'RFC 6749 §5.2',
    pass: `Rejected with an error_description a client can act on: "${description.slice(0, 120)}".`,
    fail: `The error_description exposes internal types and the controller signature rather than naming the missing parameter: "${description.slice(0, 220)}…". Compare the clean "code_challenge_method must be S256" from the same endpoint — one path is hand-written, the other is a leaked bean-validation message.`,
    attributedTo: 'issuer',
  });

  // The published OpenAPI document declares `iarRequest` as a query parameter
  // with an object schema, which reads as "send JSON". That gets a 403.
  const asDocumented = await ctx.http<unknown>({
    label: 'Issuance Authorization Request (as its OpenAPI document declares)',
    from: 'Playground',
    to: 'Inji Certify',
    method: 'POST',
    url,
    json: {
      response_type: 'code',
      client_id: 'inji-interop-playground',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      authorization_details: JSON.parse(authorizationDetails),
    },
    allowNonOk: true,
  });

  ctx.expect(asDocumented.status !== 403, {
    id: 'certify.iar.media-type-status',
    title: 'An unsupported media type is reported as one',
    spec: 'RFC 9110 §15.5.16',
    pass: `A JSON body is answered with ${asDocumented.status}, not a blanket 403.`,
    fail: `The endpoint only reads application/x-www-form-urlencoded, and answers a JSON body with 403 Forbidden instead of 415 Unsupported Media Type. 403 sends a developer to look at authentication; the actual problem is the content type. Certify's own OpenAPI document describes this parameter as an object, which is what makes JSON the natural first attempt.`,
    attributedTo: 'issuer',
  });
}
