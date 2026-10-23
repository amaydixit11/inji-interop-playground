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
  /**
   * Loopback address this process can always reach itself on, regardless of
   * how the public URL is published or mapped.
   */
  internalUrl: string;
  /**
   * Prefix rewrites applied to every outbound request, as `from=to` pairs.
   *
   * For a playground in a container talking to Inji services that advertise
   * `localhost` URLs: the protocol names `http://localhost:8091`, which from
   * inside the container is the container itself. The inspector still shows
   * the URL the protocol used; only the dial target changes.
   */
  dialRewrites: Array<[from: string, to: string]>;
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
    internalUrl: `http://127.0.0.1:${port}`,
    dialRewrites: (process.env.DIAL_REWRITES ?? '')
      .split(',')
      .map((pair) => pair.trim().split('='))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0] !== '' && pair[1] !== ''),
    certifyBaseUrl: process.env.CERTIFY_BASE_URL ?? 'http://localhost:8091',
    certifyConfigurationId: process.env.CERTIFY_CREDENTIAL_CONFIG_ID ?? '',
    verifyBaseUrl: process.env.VERIFY_BASE_URL ?? 'http://localhost:8010/v1/verify',
    injiWebUrl: process.env.INJI_WEB_URL ?? 'https://injiweb.collab.mosip.net',
  };
}
