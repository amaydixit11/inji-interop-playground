import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * W3C Bitstring Status List, and the older StatusList2021 it grew out of.
 *
 * A verifier that checks signatures but not status will happily accept a
 * credential the issuer has since revoked. That is the one failure mode where
 * everything is cryptographically perfect and the answer is still wrong, which
 * makes it easy to leave out and important not to.
 *
 * Both encodings are the same idea: a bitstring, one bit per credential, gzipped
 * and base64-encoded, published inside an ordinary Verifiable Credential.
 */

/** Default size: 131,072 bits, the minimum the specification requires. */
export const DEFAULT_STATUS_LIST_LENGTH = 16 * 1024 * 8;

export type StatusPurpose = 'revocation' | 'suspension';

export class StatusList {
  private readonly bits: Uint8Array;

  constructor(readonly length: number = DEFAULT_STATUS_LIST_LENGTH) {
    this.bits = new Uint8Array(Math.ceil(length / 8));
  }

  /** Rebuilds a list from the `encodedList` of a status list credential. */
  static decode(encodedList: string, length = DEFAULT_STATUS_LIST_LENGTH): StatusList {
    const list = new StatusList(length);
    // Both base64url and standard base64 appear in the wild; Buffer's base64
    // decoder accepts either, so no sniffing is needed.
    const inflated = gunzipSync(Buffer.from(encodedList, 'base64'));
    list.bits.set(inflated.subarray(0, list.bits.length));
    return list;
  }

  set(index: number, value: boolean): void {
    this.assertIndex(index);
    const byte = index >>> 3;
    // Bit 0 is the most significant bit of the first byte, per the spec.
    const mask = 0x80 >> (index & 7);
    if (value) {
      (this.bits as Uint8Array)[byte] |= mask;
    } else {
      (this.bits as Uint8Array)[byte] &= ~mask;
    }
  }

  get(index: number): boolean {
    this.assertIndex(index);
    const byte = this.bits[index >>> 3] ?? 0;
    return (byte & (0x80 >> (index & 7))) !== 0;
  }

  encode(): string {
    return gzipSync(Buffer.from(this.bits)).toString('base64');
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`Status list index ${index} is outside 0..${this.length - 1}`);
    }
  }
}

/** The `credentialStatus` entry embedded in an issued credential. */
export interface StatusEntry {
  id: string;
  type: 'BitstringStatusListEntry' | 'StatusList2021Entry';
  statusPurpose: StatusPurpose;
  statusListIndex: string;
  statusListCredential: string;
}

export interface StatusCheckResult {
  checked: boolean;
  revoked: boolean;
  purpose?: StatusPurpose;
  detail: string;
}

/**
 * Resolves a credential's status.
 *
 * Deliberately reports "not checked" as distinct from "not revoked": a status
 * list that cannot be fetched means the verifier does not know, and reporting
 * that as good standing is how revocation quietly stops working.
 */
export async function checkCredentialStatus(
  credential: Record<string, unknown>,
  /** Maps a published URL onto one this process can dial; see RunContext. */
  resolveUrl: (url: string) => string = (url) => url,
): Promise<StatusCheckResult> {
  const raw = credential.credentialStatus;
  const entries = (Array.isArray(raw) ? raw : raw ? [raw] : []) as StatusEntry[];

  if (entries.length === 0) {
    return {
      checked: false,
      revoked: false,
      detail: 'The credential carries no credentialStatus, so it can never be revoked once issued.',
    };
  }

  for (const entry of entries) {
    const index = Number(entry.statusListIndex);
    if (!entry.statusListCredential || !Number.isInteger(index)) {
      return {
        checked: false,
        revoked: false,
        detail: `credentialStatus is malformed: statusListCredential=${String(entry.statusListCredential)}, statusListIndex=${String(entry.statusListIndex)}.`,
      };
    }

    let statusCredential: Record<string, unknown>;
    try {
      // Fetched directly rather than through the JSON-LD document loader: that
      // loader caches, and a cached status list would keep reporting a revoked
      // credential as valid for the lifetime of the process.
      const response = await fetch(resolveUrl(entry.statusListCredential), {
        headers: { accept: 'application/ld+json, application/json' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      statusCredential = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      return {
        checked: false,
        revoked: false,
        purpose: entry.statusPurpose,
        detail: `Could not fetch the status list at ${entry.statusListCredential}: ${
          error instanceof Error ? error.message : String(error)
        }. Status is unknown, which is not the same as good standing.`,
      };
    }

    const subject = statusCredential.credentialSubject as Record<string, unknown> | undefined;
    const encodedList = subject?.encodedList;
    if (typeof encodedList !== 'string') {
      return {
        checked: false,
        revoked: false,
        purpose: entry.statusPurpose,
        detail: 'The status list credential carries no encodedList.',
      };
    }

    try {
      const list = StatusList.decode(encodedList);
      if (list.get(index)) {
        return {
          checked: true,
          revoked: true,
          purpose: entry.statusPurpose,
          detail: `Bit ${index} is set in the ${entry.statusPurpose} list at ${entry.statusListCredential}.`,
        };
      }
    } catch (error) {
      return {
        checked: false,
        revoked: false,
        purpose: entry.statusPurpose,
        detail: `Could not read the status list: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    checked: true,
    revoked: false,
    purpose: entries[0]?.statusPurpose,
    detail: `Checked ${entries.length} status list entry/entries; none of the bits are set.`,
  };
}

/* ------------------------- IETF Token Status List ------------------------- */

/**
 * The status mechanism SD-JWT VC references.
 *
 * The same bitstring idea as the W3C list, reached differently: the credential
 * carries a `status.status_list` object naming a URI and an index, and the list
 * itself is a JWT rather than a Verifiable Credential. Supporting both is what
 * lets revocation be tested on every format rather than only JSON-LD.
 */
export interface TokenStatusReference {
  idx: number;
  uri: string;
}

export function tokenStatusReference(claims: Record<string, unknown>): TokenStatusReference | undefined {
  const status = claims.status as { status_list?: { idx?: number; uri?: string } } | undefined;
  const list = status?.status_list;
  if (!list || typeof list.idx !== 'number' || typeof list.uri !== 'string') return undefined;
  return { idx: list.idx, uri: list.uri };
}

/**
 * Resolves an SD-JWT credential's status.
 *
 * Reports "not checked" distinctly from "not revoked", for the same reason as
 * the W3C path: a list that cannot be fetched means the verifier does not know,
 * and treating unknown as good standing is how revocation stops working.
 */
export async function checkTokenStatus(
  claims: Record<string, unknown>,
  resolveUrl: (url: string) => string = (url) => url,
): Promise<StatusCheckResult> {
  const reference = tokenStatusReference(claims);
  if (!reference) {
    return {
      checked: false,
      revoked: false,
      detail: 'The credential carries no `status.status_list`, so it can never be revoked once issued.',
    };
  }

  try {
    const response = await fetch(resolveUrl(reference.uri), {
      headers: { accept: 'application/statuslist+jwt, application/jwt' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    // Only the payload is needed to read a bit. A production verifier would
    // additionally verify the JWT against the issuer's key before trusting it.
    const jwt = (await response.text()).trim();
    const segment = jwt.split('.')[1];
    if (!segment) throw new Error('Status list is not a JWT');

    const payload = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as {
      status_list?: { lst?: string; bits?: number };
    };
    const encoded = payload.status_list?.lst;
    if (typeof encoded !== 'string') throw new Error('Status list JWT carries no `lst`');

    const list = StatusList.decode(encoded);
    const revoked = list.get(reference.idx);
    return {
      checked: true,
      revoked,
      purpose: 'revocation',
      detail: revoked
        ? `Bit ${reference.idx} is set in the status list at ${reference.uri}.`
        : `Bit ${reference.idx} is clear in the status list at ${reference.uri}.`,
    };
  } catch (error) {
    return {
      checked: false,
      revoked: false,
      detail: `Could not read the status list at ${reference.uri}: ${
        error instanceof Error ? error.message : String(error)
      }. Status is unknown, which is not the same as good standing.`,
    };
  }
}
