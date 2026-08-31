/**
 * Wire-format types for OpenID4VCI and OpenID4VP.
 *
 * Kept separate from the domain model because these mirror the specifications
 * verbatim (snake_case included) — they are what goes on the wire, not what the
 * playground invents.
 */

/* ----------------------------- OpenID4VCI ----------------------------- */

export const PRE_AUTHORIZED_CODE_GRANT =
  'urn:ietf:params:oauth:grant-type:pre-authorized_code';

export interface CredentialOffer {
  credential_issuer: string;
  /** Draft 13 onwards. Earlier drafts used the `credentials` array. */
  credential_configuration_ids?: string[];
  /** Pre-draft-13 spelling, accepted for backwards compatibility. */
  credentials?: unknown[];
  grants?: {
    [PRE_AUTHORIZED_CODE_GRANT]?: {
      'pre-authorized_code': string;
      /** Draft 13+ shape. Older drafts used a boolean `user_pin_required`. */
      tx_code?: { input_mode?: 'numeric' | 'text'; length?: number; description?: string };
      user_pin_required?: boolean;
      interval?: number;
    };
    authorization_code?: { issuer_state?: string; authorization_server?: string };
  };
}

export interface CredentialIssuerMetadata {
  credential_issuer: string;
  credential_endpoint: string;
  authorization_servers?: string[];
  /** Draft 13+ keys credential configurations by id. */
  credential_configurations_supported?: Record<string, CredentialConfiguration>;
  /** Draft 11 used an array under a different key. */
  credentials_supported?: unknown;
  nonce_endpoint?: string;
  batch_credential_endpoint?: string;
  deferred_credential_endpoint?: string;
  display?: Array<Record<string, unknown>>;
}

export interface CredentialConfiguration {
  format: string;
  scope?: string;
  doctype?: string;
  vct?: string;
  cryptographic_binding_methods_supported?: string[];
  credential_signing_alg_values_supported?: string[];
  proof_types_supported?: Record<string, { proof_signing_alg_values_supported?: string[] }>;
  credential_definition?: {
    '@context'?: string[];
    type?: string[];
    credentialSubject?: Record<string, unknown>;
  };
  display?: Array<Record<string, unknown>>;
}

export interface AuthorizationServerMetadata {
  issuer: string;
  token_endpoint: string;
  authorization_endpoint?: string;
  jwks_uri?: string;
  grant_types_supported?: string[];
  'pre-authorized_grant_anonymous_access_supported'?: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
  c_nonce?: string;
  c_nonce_expires_in?: number;
  authorization_details?: unknown;
}

export interface CredentialRequest {
  format?: string;
  vct?: string;
  doctype?: string;
  credential_configuration_id?: string;
  credential_definition?: { '@context'?: string[]; type?: string[] };
  claims?: Record<string, unknown>;
  proof?: { proof_type: 'jwt' | 'cwt'; jwt?: string; cwt?: string };
}

export interface CredentialResponse {
  format?: string;
  credential?: unknown;
  /** OpenID4VCI 1.0 replaced the single `credential` with an array. */
  credentials?: Array<{ credential: unknown }>;
  transaction_id?: string;
  acceptance_token?: string;
  c_nonce?: string;
  c_nonce_expires_in?: number;
  notification_id?: string;
}

/* ------------------------------ OpenID4VP ------------------------------ */

export interface PresentationDefinition {
  id: string;
  name?: string;
  purpose?: string;
  format?: Record<string, unknown>;
  input_descriptors: InputDescriptor[];
}

export interface InputDescriptor {
  id: string;
  name?: string;
  purpose?: string;
  format?: Record<string, unknown>;
  constraints: {
    fields?: Array<{
      path: string[];
      filter?: Record<string, unknown>;
      optional?: boolean;
    }>;
    limit_disclosure?: 'required' | 'preferred';
  };
}

export interface AuthorizationRequest {
  client_id: string;
  response_type: 'vp_token' | 'vp_token id_token';
  response_mode: 'direct_post' | 'direct_post.jwt' | 'fragment' | 'query';
  response_uri?: string;
  redirect_uri?: string;
  nonce: string;
  state?: string;
  presentation_definition?: PresentationDefinition;
  presentation_definition_uri?: string;
  /** OpenID4VP 1.0 replaces Presentation Exchange with DCQL. */
  dcql_query?: Record<string, unknown>;
  client_metadata?: Record<string, unknown>;
}

export interface PresentationSubmission {
  id: string;
  definition_id: string;
  descriptor_map: Array<{
    id: string;
    format: string;
    path: string;
    path_nested?: { id?: string; format: string; path: string };
  }>;
}

/** Body posted to the verifier's `response_uri` in a `direct_post` flow. */
export interface VpTokenSubmission {
  vp_token: string;
  presentation_submission?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/* --------------------------- W3C VC / SD-JWT --------------------------- */

export interface W3CCredential {
  '@context': string[];
  id?: string;
  type: string[];
  issuer: string | { id: string };
  issuanceDate?: string;
  validFrom?: string;
  expirationDate?: string;
  validUntil?: string;
  credentialSubject: Record<string, unknown>;
  credentialStatus?: Record<string, unknown>;
  proof?: DataIntegrityProof | DataIntegrityProof[];
}

export interface DataIntegrityProof {
  type: string;
  created?: string;
  proofPurpose: string;
  verificationMethod: string;
  cryptosuite?: string;
  jws?: string;
  proofValue?: string;
}

export interface VerifiablePresentation {
  '@context': string[];
  type: string[];
  id?: string;
  holder?: string;
  verifiableCredential: unknown[];
  proof?: DataIntegrityProof | DataIntegrityProof[];
}
