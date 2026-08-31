import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { UserAction } from '@interop/shared';

/**
 * Shown when a run needs a human — scanning a QR with a phone wallet, or
 * following a deep link in another tab.
 *
 * The URI is offered as text as well as a QR code: the QR is unusable on the
 * same device, and a long OpenID4VP request by value can exceed what a phone
 * camera will reliably decode, in which case copying the link is the way through.
 */
export function UserActionPrompt({
  action,
  onComplete,
  onAbort,
}: {
  action: UserAction;
  onComplete: () => void;
  onAbort: () => void;
}) {
  const [dataUrl, setDataUrl] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(action.uri, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => active && setDataUrl(url))
      .catch((caught: Error) => {
        if (!active) return;
        // Over ~2.9KB a QR cannot be produced at all. Saying so is more useful
        // than an empty box, and the size limit is itself a real finding.
        setError(
          `This payload is ${action.uri.length} characters, which is too large to encode as a QR code. Use the link below, and note that a verifier passing the request by value rather than by reference is an interoperability problem for cross-device flows.`,
        );
      });
    return () => {
      active = false;
    };
  }, [action.uri]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-5 shadow-2xl">
        <h2 className="text-[15px] font-semibold text-ink">{action.title}</h2>
        <p className="mt-1 text-[12px] leading-snug text-muted">{action.instructions}</p>

        <div className="my-4 flex justify-center">
          {dataUrl ? (
            <img src={dataUrl} alt="QR code" className="rounded-md bg-white p-2" width={280} height={280} />
          ) : error ? (
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] leading-snug text-warn">
              {error}
            </p>
          ) : (
            <div className="h-[280px] w-[280px] animate-pulse rounded-md bg-surface-2" />
          )}
        </div>

        <div className="rounded-md border border-line bg-canvas p-2">
          <div className="payload max-h-24 overflow-auto break-all text-muted">{action.uri}</div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(action.uri);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="mt-2 w-full rounded border border-line py-1 text-[11px] text-muted transition hover:border-accent hover:text-accent"
          >
            {copied ? 'copied' : 'copy link'}
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onComplete}
            className="flex-1 rounded-md bg-accent py-2 text-[12px] font-semibold text-canvas transition hover:brightness-110"
          >
            I have completed this step
          </button>
          <button
            type="button"
            onClick={onAbort}
            className="rounded-md border border-line px-3 text-[12px] text-muted transition hover:border-fail hover:text-fail"
          >
            Abort
          </button>
        </div>
      </div>
    </div>
  );
}
