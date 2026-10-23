import securityContext from '@digitalbazaar/security-context';
import { securityLoader } from '@digitalbazaar/security-document-loader';
import ed25519Signature2018Context from 'ed25519-signature-2018-context';
import { JWS_2020_V1, JWS_2020_V1_URL, STATUS_LIST_2021_V1, STATUS_LIST_2021_V1_URL } from '../contexts/vendored.js';
import { didWebUrl } from './keys.js';

/**
 * JSON-LD context published by the playground for its test credential type.
 *
 * Every claim the playground issues has to be a defined term: JSON-LD safe mode
 * refuses to canonicalise a document containing properties that do not expand
 * to an absolute IRI, and silently dropping them would mean signing over less
 * data than the credential appears to carry.
 */
export const PLAYGROUND_CONTEXT_PATH = '/contexts/interop/v1';

export const PLAYGROUND_CONTEXT = {
  '@context': {
    '@protected': true,
    vocab: 'https://inji-interop-playground.dev/vocab#',
    InteropTestCredential: 'vocab:InteropTestCredential',
    // Defined so the `wrong-type` negative test produces a credential that is
    // structurally valid but fails the verifier's type constraint. Without a
    // term here it would fail at canonicalisation instead, testing nothing.
    UnrelatedCredential: 'vocab:UnrelatedCredential',
    fullName: 'vocab:fullName',
    givenName: 'vocab:givenName',
    familyName: 'vocab:familyName',
    dateOfBirth: 'vocab:dateOfBirth',
    gender: 'vocab:gender',
    nationality: 'vocab:nationality',
    idNumber: 'vocab:idNumber',
    email: 'vocab:email',
    phone: 'vocab:phone',
    issuedTo: 'vocab:issuedTo',
  },
} as const;

export type DocumentLoader = (url: string) => Promise<{ document: unknown; documentUrl: string }>;

interface LoaderOptions {
  /** Absolute base URL the playground is reachable at. */
  publicUrl: string;
  /** Documents served without a network round trip, keyed by URL or DID. */
  statics: Record<string, unknown>;
}

/**
 * Builds a document loader that resolves bundled contexts, the playground's own
 * context and DIDs, and `did:web` identifiers belonging to anyone else.
 *
 * Fragment dereferencing is handled explicitly because Data Integrity suites
 * resolve a verification method by its full `did:...#key` URL and expect the
 * *key* back, not the DID document that contains it.
 */
export function buildDocumentLoader({ publicUrl, statics }: LoaderOptions): DocumentLoader {
  const loader = securityLoader();
  // The security loader bundles neither these nor the two vendored ones, and
  // every one of them is in a credential or DID document the playground signs.
  for (const [url, document] of [...securityContext.contexts, ...ed25519Signature2018Context.contexts]) {
    loader.addStatic(url, document);
  }
  loader.addStatic(JWS_2020_V1_URL, JWS_2020_V1);
  loader.addStatic(STATUS_LIST_2021_V1_URL, STATUS_LIST_2021_V1);
  loader.addStatic(new URL(PLAYGROUND_CONTEXT_PATH, publicUrl).toString(), PLAYGROUND_CONTEXT);
  for (const [url, document] of Object.entries(statics)) loader.addStatic(url, document);

  const base = loader.build();
  const cache = new Map<string, unknown>();

  return async (url: string) => {
    try {
      const result = await base(url);
      return { document: result.document, documentUrl: result.documentUrl ?? url };
    } catch (error) {
      if (url.startsWith('did:web:')) {
        return { document: await resolveDidWeb(url, cache), documentUrl: url };
      }
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return { document: await resolveRemoteContext(url, cache), documentUrl: url };
      }
      throw error;
    }
  };
}

/**
 * Fetches a context the bundled set does not carry.
 *
 * Remote fetching is deliberate rather than incidental: the playground asserts
 * that an issuer's `@context` entries actually dereference, and an allowlist
 * would make that check report on its own contents instead of on reality. The
 * result is cached, and anything that is not a JSON-LD context document is
 * rejected — a URL that returns an HTML page is exactly the defect being
 * looked for.
 */
async function resolveRemoteContext(url: string, cache: Map<string, unknown>): Promise<unknown> {
  const cached = cache.get(url);
  if (cached) return cached;

  const response = await fetch(url, { headers: { accept: 'application/ld+json, application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);

  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();

  if (!contentType.includes('json')) {
    throw new Error(`${url} returned ${contentType || 'an unknown content type'}, not a JSON-LD context`);
  }

  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    throw new Error(`${url} did not return parseable JSON`);
  }

  if (!document || typeof document !== 'object' || !('@context' in document)) {
    throw new Error(`${url} returned JSON with no @context member`);
  }

  cache.set(url, document);
  return document;
}

async function resolveDidWeb(url: string, cache: Map<string, unknown>): Promise<unknown> {
  const [did, fragment] = url.split('#');
  if (!did) throw new Error(`Malformed DID URL: ${url}`);

  let document = cache.get(did);
  if (!document) {
    const response = await fetch(didWebUrl(did), { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`Could not resolve ${did}: HTTP ${response.status} from ${didWebUrl(did)}`);
    }
    document = await response.json();
    cache.set(did, document);
  }

  if (!fragment) return document;
  const method = findVerificationMethod(document, url);
  if (!method) throw new Error(`DID document ${did} has no verification method ${url}`);
  return method;
}

/** Locates a verification method by id, following embedded and referenced forms. */
export function findVerificationMethod(didDocument: unknown, id: string): unknown {
  if (!didDocument || typeof didDocument !== 'object') return undefined;
  const doc = didDocument as Record<string, unknown>;
  const pools = ['verificationMethod', 'assertionMethod', 'authentication'] as const;

  for (const pool of pools) {
    const entries = doc[pool];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === 'object' && (entry as Record<string, unknown>).id === id) {
        return entry;
      }
    }
  }
  return undefined;
}
