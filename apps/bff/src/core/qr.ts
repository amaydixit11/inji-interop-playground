import pixelpass from '@mosip/pixelpass';

/**
 * How well a payload will survive being put on a screen and scanned.
 *
 * The problem statement names "QR size limits" as an interoperability gap to
 * surface, and it is a real one: an OpenID4VP request passed by value carries
 * the whole presentation definition, and a verifier that has never tested it on
 * a phone will ship something that cannot be scanned. A specification-legal
 * request can be unusable in the flow it exists for.
 *
 * The thresholds are about scanning, not encoding. A QR code can hold 2,953
 * bytes at the lowest error correction, but the module size at that density is
 * beyond what a phone camera resolves reliably from a laptop screen at arm's
 * length. The bands below are the practical ones.
 */

/** Most a single QR code can carry: version 40, error correction level L. */
export const QR_ABSOLUTE_MAX_BYTES = 2953;

/** Scans reliably at modest on-screen sizes. */
export const QR_COMFORTABLE_BYTES = 512;

/** Scans on a good display at close range; marginal on a phone-to-phone hand-off. */
export const QR_WORKABLE_BYTES = 1200;

export type QrVerdict = 'comfortable' | 'workable' | 'unreliable' | 'impossible';

export interface QrAssessment {
  bytes: number;
  verdict: QrVerdict;
  /** Size after PixelPass compression, when it helps. */
  compressedBytes?: number;
  /** Proportion of a single QR code's absolute capacity used. */
  capacityUsed: number;
  summary: string;
}

export function assessQrPayload(payload: string): QrAssessment {
  const bytes = Buffer.byteLength(payload, 'utf8');
  const compressedBytes = compressedSize(payload);

  const verdict: QrVerdict =
    bytes > QR_ABSOLUTE_MAX_BYTES
      ? 'impossible'
      : bytes > QR_WORKABLE_BYTES
        ? 'unreliable'
        : bytes > QR_COMFORTABLE_BYTES
          ? 'workable'
          : 'comfortable';

  const capacityUsed = bytes / QR_ABSOLUTE_MAX_BYTES;

  const wording: Record<QrVerdict, string> = {
    comfortable: `${bytes} bytes — scans reliably at modest sizes.`,
    workable: `${bytes} bytes (${Math.round(capacityUsed * 100)}% of a single QR code) — scans on a good display at close range, marginal on a phone held at arm's length.`,
    unreliable: `${bytes} bytes (${Math.round(capacityUsed * 100)}% of a single QR code) — encodable, but at a module density most phone cameras will not resolve reliably. Pass the request by reference instead.`,
    impossible: `${bytes} bytes exceeds the ${QR_ABSOLUTE_MAX_BYTES}-byte capacity of a single QR code, so it cannot be encoded at all.`,
  };

  const compressionNote =
    compressedBytes !== undefined && compressedBytes < bytes
      ? ` PixelPass would reduce it to ${compressedBytes} bytes (${Math.round((1 - compressedBytes / bytes) * 100)}% smaller).`
      : '';

  return { bytes, verdict, compressedBytes, capacityUsed, summary: wording[verdict] + compressionNote };
}

/**
 * Size after PixelPass compression.
 *
 * Reported rather than applied: compressing changes what a scanning wallet has
 * to understand, and a wallet that does not know PixelPass cannot read the
 * result. It belongs in the report as a remedy, not silently in the payload.
 */
function compressedSize(payload: string): number | undefined {
  try {
    const packed = pixelpass.generateQRData(payload);
    return typeof packed === 'string' ? Buffer.byteLength(packed, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}
