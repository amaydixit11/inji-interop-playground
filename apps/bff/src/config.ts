/** Runtime configuration, all overridable by environment variable. */
export interface AppConfig {
  port: number;
  /**
   * The URL the playground is reachable at from *other* machines.
   *
   * This matters more than it looks: it becomes the issuer's `did:web`, the
   * `credential_issuer` in every offer, and the host in every QR code. A phone
   * scanning a QR that says `localhost` will fail, so this must be set to a
   * tunnel URL whenever a handheld wallet is in the run.
   */
  publicUrl: string;
  certifyBaseUrl: string;
  certifyConfigurationId: string;
  verifyBaseUrl: string;
  injiWebUrl: string;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 8787);
  return {
    port,
    publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    certifyBaseUrl: process.env.CERTIFY_BASE_URL ?? 'http://localhost:8090/v1/certify',
    certifyConfigurationId: process.env.CERTIFY_CREDENTIAL_CONFIG_ID ?? '',
    verifyBaseUrl: process.env.VERIFY_BASE_URL ?? 'http://localhost:8000/v1/verify',
    injiWebUrl: process.env.INJI_WEB_URL ?? 'https://injiweb.collab.mosip.net',
  };
}
