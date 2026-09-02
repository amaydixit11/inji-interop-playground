import { useState } from 'react';
import { OpenID4VPVerification } from '@injistack/react-inji-verify-sdk';
import type { DcqlQuery } from '@injistack/react-inji-verify-sdk';
import { formatPayload, Panel, Badge } from './primitives.js';

/**
 * Verification driven by MOSIP's own React SDK, rather than by this project's
 * adapter.
 *
 * Every other finding here rests on our client reading verify-service
 * correctly, and finding 22 is what happens when it does not. This view removes
 * us from the loop: the official component talks to verify-service straight from
 * the browser, so a result here is evidence about verify-service and its own
 * SDK, with nothing of ours in between.
 *
 * The exchange happens in the browser, so the playground cannot capture it —
 * the same `endpoint-only` honesty that applies to a phone wallet applies here.
 */
export function OfficialSdk({ verifyServiceUrl }: { verifyServiceUrl: string }) {
  // Defaults to the playground's same-origin proxy, because verify-service
  // sends no CORS headers and answers preflight with 403 — so the SDK cannot
  // reach it directly from any page but one served from its own origin.
  const [serviceUrl, setServiceUrl] = useState('/proxy/verify');
  const [result, setResult] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [started, setStarted] = useState(false);
  // Cross-device by default: the SDK's same-device path needs a web wallet URL
  // and refuses to start on desktop without one, which is a configuration
  // question rather than something worth failing a first run over.
  const [sameDevice, setSameDevice] = useState(false);
  const [webWalletBaseUrl, setWebWalletBaseUrl] = useState('https://injiweb.collab.mosip.net');

  // DCQL, not Presentation Exchange. The SDK is built to OpenID4VP 1.0 and
  // takes a `dcqlQuery`; verify-service 0.18.2 takes a `presentationDefinition`.
  // Whether the pair actually agree is the thing this view tests.
  const dcqlQuery: DcqlQuery = {
    credentials: [
      {
        id: 'interop-test-credential',
        format: 'ldp_vc',
        meta: { type_values: [['VerifiableCredential', 'InteropTestCredential']] },
        claims: [{ path: ['credentialSubject', 'fullName'] }],
      },
    ],
  };

  return (
    <div className="space-y-3 pb-2">
      <Panel
        title="Verify with MOSIP's own SDK"
        subtitle="@injistack/react-inji-verify-sdk driving verify-service directly"
      >
        <div className="space-y-3 p-3">
          <p className="text-[12px] leading-relaxed text-muted">
            Everywhere else, a result depends on our adapter reading verify-service correctly — and
            finding 22 records what happened when it did not. Here the official component talks to
            verify-service from the browser with nothing of ours in between, so the outcome is
            evidence about their client and their service.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warn">endpoint only</Badge>
            <span className="text-[11px] text-muted">
              The exchange happens in your browser, so the protocol inspector cannot capture it.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-ink">
              <input
                type="checkbox"
                checked={sameDevice}
                onChange={(event) => {
                  setSameDevice(event.target.checked);
                  setStarted(false);
                  setResult(undefined);
                  setError(undefined);
                }}
              />
              Same-device flow
            </label>
            <span className="text-[10.5px] text-muted">
              {sameDevice
                ? 'Redirects to a web wallet. The SDK refuses to start on desktop without one.'
                : 'Cross-device: the SDK renders its own OpenID4VP QR code and polls for the response.'}
            </span>
          </div>

          {sameDevice && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-ink">Web wallet URL</span>
              <input
                value={webWalletBaseUrl}
                onChange={(event) => setWebWalletBaseUrl(event.target.value)}
                className="payload w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-ink outline-none focus:border-accent"
              />
            </label>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink">verify-service URL</span>
            <input
              value={serviceUrl}
              onChange={(event) => setServiceUrl(event.target.value)}
              className="payload w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-ink outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[10px] leading-snug text-muted">
              Defaults to <code>/proxy/verify</code>, this playground's same-origin passthrough to{' '}
              <code>{verifyServiceUrl}</code>. Pointing the SDK straight at verify-service fails: it
              sends no CORS headers and answers preflight with 403, so a browser cannot call it from
              anywhere but a page on its own origin.
            </span>
          </label>

          <div>
            <div className="mb-1 text-[10.5px] uppercase tracking-wider text-muted">
              DCQL query sent by the SDK
            </div>
            <pre className="payload max-h-40 overflow-auto rounded-md border border-line bg-canvas px-2.5 py-2 text-muted">
              {formatPayload(dcqlQuery)}
            </pre>
          </div>

          {/* Rendered only once started: the component begins its flow on mount. */}
          {started ? (
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <OpenID4VPVerification
                verifyServiceUrl={serviceUrl}
                clientId={serviceUrl}
                dcqlQuery={dcqlQuery}
                isSameDeviceFlowEnabled={sameDevice}
                {...(sameDevice ? { webWalletBaseUrl } : {})}
                onVPProcessed={(vpResult) => setResult(vpResult)}
                onQrCodeExpired={() => setError('The SDK reports its QR code expired before a wallet responded.')}
                // The SDK's own error shape, not an Error instance, and not
                // re-exported from the package root — hence the inline type.
                onError={(sdkError: { errorCode?: string; errorMessage: string }) =>
                  setError(`${sdkError.errorCode ?? 'error'}: ${sdkError.errorMessage}`)
                }
                triggerElement={
                  <button
                    type="button"
                    className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-canvas"
                  >
                    Start SDK verification
                  </button>
                }
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(undefined);
                setResult(undefined);
                setStarted(true);
              }}
              className="rounded-md bg-accent px-4 py-1.5 text-[12px] font-semibold text-canvas transition hover:brightness-110"
            >
              Load the SDK component
            </button>
          )}

          {error && (
            <p className="rounded-md border border-fail/40 bg-fail/10 px-2.5 py-2 text-[11px] text-fail">{error}</p>
          )}
        </div>
      </Panel>

      {result !== undefined && (
        <Panel title="What the SDK reported" subtitle="Verbatim, unmediated by this project">
          <pre className="payload max-h-96 overflow-auto whitespace-pre-wrap break-all p-3 text-muted">
            {formatPayload(result)}
          </pre>
        </Panel>
      )}
    </div>
  );
}
