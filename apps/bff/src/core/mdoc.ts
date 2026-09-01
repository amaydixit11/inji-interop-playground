import { createHash, randomBytes } from 'node:crypto';
import { Encoder, Tag } from 'cbor-x';
import { importJWK, type JWK, type KeyLike } from 'jose';
import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

/**
 * ISO/IEC 18013-5 mdoc issuance, presentation and verification.
 *
 * Written directly against the specification rather than taken from a library,
 * for the same reason as the SD-JWT implementation: the playground has to be
 * able to emit deliberately malformed documents, and a library that refuses to
 * produce one cannot exercise a verifier's negative paths.
 *
 * Scope: the mdoc data model, the issuer's `MobileSecurityObject` signed as a
 * COSE_Sign1, and the OpenID4VP `DeviceResponse` with device authentication
 * over the OID4VP session transcript. Reader authentication and the BLE/NFC
 * transports of 18013-5 are out of scope — OpenID4VP is the transport here.
 */

/**
 * Deterministic-ish CBOR. `mapsAsObjects: false` keeps maps as `Map`, which
 * preserves insertion order — mdoc digests are taken over exact encoded bytes,
 * so a re-encode that reorders keys would invalidate every digest.
 */
const cbor = new Encoder({
  useRecords: false,
  mapsAsObjects: false,
  tagUint8Array: false,
  variableMapSize: true,
  useFloat32: 0,
});

export const MDL_DOCTYPE = 'org.iso.18013.5.1.mDL';
export const MDL_NAMESPACE = 'org.iso.18013.5.1';

/** COSE header labels and algorithm identifiers used here. */
const COSE_ALG = 1;
const COSE_KID = 4;
const COSE_X5CHAIN = 33;
const ES256 = -7;

function encode(value: unknown): Buffer {
  return Buffer.from(cbor.encode(value));
}

function decode(bytes: Uint8Array): unknown {
  return cbor.decode(Buffer.from(bytes));
}

/** `#6.24(bstr .cbor X)` — an embedded CBOR data item. */
function taggedBytes(value: unknown): Tag {
  return new Tag(encode(value), 24);
}

function sha256(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/* --------------------------------- COSE ---------------------------------- */

export interface CoseSign1 {
  protected: Buffer;
  unprotected: Map<number, unknown>;
  payload: Buffer | null;
  signature: Buffer;
}

function coseSign1ToArray(sign1: CoseSign1): unknown[] {
  return [sign1.protected, sign1.unprotected, sign1.payload, sign1.signature];
}

function coseSign1FromArray(value: unknown): CoseSign1 {
  if (!Array.isArray(value) || value.length !== 4) throw new Error('COSE_Sign1 must be a 4-element array');
  const [protectedHeader, unprotected, payload, signature] = value as [Buffer, Map<number, unknown>, Buffer | null, Buffer];
  return {
    protected: Buffer.from(protectedHeader),
    unprotected: unprotected instanceof Map ? unprotected : new Map(),
    payload: payload === null || payload === undefined ? null : Buffer.from(payload),
    signature: Buffer.from(signature),
  };
}

/**
 * `Sig_structure` for a COSE_Sign1, per RFC 8152 §4.4.
 *
 * The payload passed here may differ from the one embedded in the message:
 * device authentication uses a detached payload, signing over data the verifier
 * reconstructs rather than receives.
 */
function sigStructure(protectedHeader: Buffer, payload: Buffer): Buffer {
  return encode(['Signature1', protectedHeader, Buffer.alloc(0), payload]);
}

async function signCose(
  payload: Buffer,
  key: KeyLike,
  headers: { kid?: string; x5chain?: Buffer[]; detached?: boolean },
): Promise<CoseSign1> {
  const protectedMap = new Map<number, unknown>([[COSE_ALG, ES256]]);
  if (headers.kid) protectedMap.set(COSE_KID, Buffer.from(headers.kid, 'utf8'));
  const protectedHeader = encode(protectedMap);

  const unprotected = new Map<number, unknown>();
  if (headers.x5chain) unprotected.set(COSE_X5CHAIN, headers.x5chain);

  // COSE ES256 signatures are the raw 64-byte r||s concatenation, not DER.
  const signature = cryptoSign(
    'sha256',
    sigStructure(protectedHeader, payload),
    { key: key as never, dsaEncoding: 'ieee-p1363' },
  );

  return {
    protected: protectedHeader,
    unprotected,
    payload: headers.detached ? null : payload,
    signature: Buffer.from(signature),
  };
}

function verifyCose(sign1: CoseSign1, payload: Buffer, publicKey: KeyLike): boolean {
  try {
    return cryptoVerify(
      'sha256',
      sigStructure(sign1.protected, payload),
      { key: publicKey as never, dsaEncoding: 'ieee-p1363' },
      sign1.signature,
    );
  } catch {
    return false;
  }
}

/** Reads the `kid` from a COSE protected header, when present. */
export function coseKid(sign1: CoseSign1): string | undefined {
  const header = decode(sign1.protected);
  if (!(header instanceof Map)) return undefined;
  const kid = header.get(COSE_KID);
  return kid ? Buffer.from(kid as Uint8Array).toString('utf8') : undefined;
}

/* -------------------------------- COSE_Key -------------------------------- */

/** Encodes a P-256 public key as a COSE_Key (RFC 8152 §13). */
export function coseKeyFromJwk(jwk: JWK): Map<number, unknown> {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    throw new Error(`mdoc device keys must be EC P-256; got ${String(jwk.kty)}/${String(jwk.crv)}`);
  }
  return new Map<number, unknown>([
    [1, 2], // kty: EC2
    [-1, 1], // crv: P-256
    [-2, Buffer.from(jwk.x as string, 'base64url')],
    [-3, Buffer.from(jwk.y as string, 'base64url')],
  ]);
}

export function jwkFromCoseKey(coseKey: Map<number, unknown>): JWK {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: Buffer.from(coseKey.get(-2) as Uint8Array).toString('base64url'),
    y: Buffer.from(coseKey.get(-3) as Uint8Array).toString('base64url'),
  };
}

/* -------------------------------- Issuance -------------------------------- */

export interface MdocIssueOptions {
  docType?: string;
  nameSpace?: string;
  claims: Record<string, unknown>;
  /** Issuer's P-256 signing key. */
  signingKey: KeyLike;
  /** Identifier placed in the COSE `kid` so a verifier can resolve the key. */
  kid: string;
  /** Holder's P-256 public key, bound into the MSO as `deviceKey`. */
  deviceKeyJwk: JWK;
  validFrom?: Date;
  validUntil?: Date;
  signedAt?: Date;
  /** Corrupt the issuer signature so the document fails authentication. */
  corruptSignature?: boolean;
  /**
   * Emit a digest that does not match its data element, simulating an issuer
   * that signed over different values than it disclosed.
   */
  corruptDigest?: boolean;
}

export interface MdocIssueResult {
  /** base64url of the CBOR `IssuerSigned`, as OpenID4VCI carries `mso_mdoc`. */
  credential: string;
  docType: string;
  /** Readable view for the inspector. */
  decoded: Record<string, unknown>;
}

export async function issueMdoc(options: MdocIssueOptions): Promise<MdocIssueResult> {
  const docType = options.docType ?? MDL_DOCTYPE;
  const nameSpace = options.nameSpace ?? MDL_NAMESPACE;
  const signedAt = options.signedAt ?? new Date();
  const validFrom = options.validFrom ?? signedAt;
  const validUntil = options.validUntil ?? new Date(signedAt.getTime() + 365 * 864e5);

  // Each data element gets a random salt, so a verifier holding a digest
  // cannot brute-force the element value from the digest alone.
  const entries = Object.entries(options.claims);
  const items = entries.map(([elementIdentifier, elementValue], index) => {
    const item = new Map<string, unknown>([
      ['digestID', index],
      ['random', randomBytes(16)],
      ['elementIdentifier', elementIdentifier],
      ['elementValue', normaliseValue(elementValue)],
    ]);
    return { digestID: index, elementIdentifier, elementValue, tagged: taggedBytes(item) };
  });

  const digests = new Map<number, Buffer>();
  for (const item of items) {
    const bytes = encode(item.tagged);
    const digest = sha256(bytes);
    if (options.corruptDigest && item.digestID === 0) {
      digest[0] ^= 0xff;
    }
    digests.set(item.digestID, digest);
  }

  const mso = new Map<string, unknown>([
    ['version', '1.0'],
    ['digestAlgorithm', 'SHA-256'],
    ['valueDigests', new Map([[nameSpace, digests]])],
    ['deviceKeyInfo', new Map([['deviceKey', coseKeyFromJwk(options.deviceKeyJwk)]])],
    ['docType', docType],
    [
      'validityInfo',
      new Map<string, unknown>([
        ['signed', new Tag(signedAt.toISOString(), 0)],
        ['validFrom', new Tag(validFrom.toISOString(), 0)],
        ['validUntil', new Tag(validUntil.toISOString(), 0)],
      ]),
    ],
  ]);

  const msoBytes = encode(taggedBytes(mso));
  const issuerAuth = await signCose(msoBytes, options.signingKey, { kid: options.kid });

  if (options.corruptSignature) {
    // Flipped in the middle of the signature: the final byte of a raw ECDSA
    // signature is still significant, but corrupting the middle is uniformly
    // safe across encodings.
    issuerAuth.signature[Math.floor(issuerAuth.signature.length / 2)] ^= 0xff;
  }

  const issuerSigned = new Map<string, unknown>([
    ['nameSpaces', new Map([[nameSpace, items.map((item) => item.tagged)]])],
    ['issuerAuth', coseSign1ToArray(issuerAuth)],
  ]);

  return {
    credential: encode(issuerSigned).toString('base64url'),
    docType,
    decoded: {
      docType,
      nameSpace,
      elements: Object.fromEntries(entries),
      mso: {
        version: '1.0',
        digestAlgorithm: 'SHA-256',
        docType,
        validityInfo: {
          signed: signedAt.toISOString(),
          validFrom: validFrom.toISOString(),
          validUntil: validUntil.toISOString(),
        },
        valueDigests: Object.fromEntries(
          [...digests.entries()].map(([id, digest]) => [id, digest.toString('base64url')]),
        ),
      },
      issuerAuth: {
        alg: 'ES256',
        kid: options.kid,
        signature: issuerAuth.signature.toString('base64url'),
      },
    },
  };
}

/** CBOR has no notion of a JS `undefined`; dates get their proper tag. */
function normaliseValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return new Tag(value.toISOString().slice(0, 10), 1004);
  return value;
}

/* ------------------------------ Presentation ------------------------------ */

/**
 * `SessionTranscript` for OpenID4VP, per ISO/IEC 18013-7 Annex B.
 *
 * This is what binds a device signature to one specific presentation request:
 * the client identifier, the response endpoint and the verifier's nonce all
 * feed the hash, so a device signature captured from one exchange cannot be
 * replayed into another.
 */
export function oid4vpSessionTranscript(options: {
  clientId: string;
  responseUri: string;
  nonce: string;
  mdocGeneratedNonce: string;
}): Buffer {
  const clientIdHash = sha256(encode([options.clientId, options.mdocGeneratedNonce]));
  const responseUriHash = sha256(encode([options.responseUri, options.mdocGeneratedNonce]));
  const handover = [clientIdHash, responseUriHash, options.nonce];
  return encode([null, null, handover]);
}

export interface MdocPresentOptions {
  /** base64url `IssuerSigned` as issued. */
  credential: string;
  /** Element identifiers to disclose; others are withheld. */
  disclose?: string[];
  deviceKey: KeyLike;
  clientId: string;
  responseUri: string;
  nonce: string;
  /** Omit device authentication entirely. */
  omitDeviceAuth?: boolean;
  /** Sign over a transcript built from a different nonce. */
  replayNonce?: string;
  /**
   * Holder-generated nonce mixed into the session transcript.
   *
   * ISO/IEC 18013-7 carries this in the `apu` header of an encrypted
   * authorization response. This playground uses unencrypted `direct_post`,
   * where there is nowhere to put it, so both sides use the empty string —
   * which the specification permits for that case. The verifier's nonce still
   * binds the signature to this request.
   */
  mdocGeneratedNonce?: string;
}

export interface MdocPresentResult {
  /** base64url of the CBOR `DeviceResponse`, as OpenID4VP carries `mso_mdoc`. */
  vpToken: string;
  mdocGeneratedNonce: string;
}

export async function presentMdoc(options: MdocPresentOptions): Promise<MdocPresentResult> {
  const issuerSigned = decode(Buffer.from(options.credential, 'base64url'));
  if (!(issuerSigned instanceof Map)) throw new Error('IssuerSigned must be a CBOR map');

  const nameSpaces = issuerSigned.get('nameSpaces') as Map<string, Tag[]>;
  const docType = readDocType(issuerSigned);

  // Selective disclosure in mdoc is subtractive: the holder ships only the
  // IssuerSignedItems it wants to reveal, and the MSO digests cover the rest,
  // so what is withheld remains verifiable as *not* tampered with.
  const filtered = new Map<string, Tag[]>();
  for (const [ns, items] of nameSpaces) {
    const kept = options.disclose
      ? items.filter((item) => options.disclose?.includes(readElementIdentifier(item)))
      : items;
    filtered.set(ns, kept);
  }

  const presentedIssuerSigned = new Map<string, unknown>([
    ['nameSpaces', filtered],
    ['issuerAuth', issuerSigned.get('issuerAuth')],
  ]);

  const mdocGeneratedNonce = options.mdocGeneratedNonce ?? '';
  const document = new Map<string, unknown>([
    ['docType', docType],
    ['issuerSigned', presentedIssuerSigned],
  ]);

  if (!options.omitDeviceAuth) {
    const deviceNameSpacesBytes = taggedBytes(new Map());
    const transcript = oid4vpSessionTranscript({
      clientId: options.clientId,
      responseUri: options.responseUri,
      nonce: options.replayNonce ?? options.nonce,
      mdocGeneratedNonce,
    });

    const deviceAuthentication = [
      'DeviceAuthentication',
      new Tag(transcript, 24),
      docType,
      deviceNameSpacesBytes,
    ];
    // Detached payload: the verifier rebuilds this from the request it sent,
    // which is what makes the signature unusable against any other request.
    const deviceSignature = await signCose(
      encode(taggedBytes(deviceAuthentication)),
      options.deviceKey,
      { detached: true },
    );

    document.set(
      'deviceSigned',
      new Map<string, unknown>([
        ['nameSpaces', deviceNameSpacesBytes],
        ['deviceAuth', new Map([['deviceSignature', coseSign1ToArray(deviceSignature)]])],
      ]),
    );
  }

  const deviceResponse = new Map<string, unknown>([
    ['version', '1.0'],
    ['documents', [document]],
    ['status', 0],
  ]);

  return { vpToken: encode(deviceResponse).toString('base64url'), mdocGeneratedNonce };
}

/* ------------------------------ Verification ------------------------------ */

export interface MdocCheck {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  expiryRelated?: boolean;
}

export interface MdocVerifyOptions {
  vpToken: string;
  clientId: string;
  responseUri: string;
  nonce: string;
  /** Resolves the issuer's public key from the COSE `kid`. */
  resolveIssuerKey: (kid: string | undefined) => Promise<KeyLike>;
  /** See `MdocPresentOptions.mdocGeneratedNonce`; empty for direct_post. */
  mdocGeneratedNonce?: string;
}

export interface MdocVerification {
  checks: MdocCheck[];
  claims: Record<string, unknown>;
  /** Document type from the signed MSO, for constraint evaluation. */
  docType?: string;
  decoded: unknown;
}

export async function verifyMdocPresentation(options: MdocVerifyOptions): Promise<MdocVerification> {
  const checks: MdocCheck[] = [];
  const claims: Record<string, unknown> = {};

  const response = decode(Buffer.from(options.vpToken, 'base64url'));
  if (!(response instanceof Map)) {
    return {
      checks: [{ id: 'mdoc.parse', title: 'DeviceResponse parses as CBOR', ok: false, detail: 'Token is not a CBOR map.' }],
      claims,
      decoded: undefined,
    };
  }

  const status = response.get('status');
  checks.push({
    id: 'mdoc.status',
    title: 'DeviceResponse reports success status',
    ok: status === 0,
    detail: status === 0 ? 'status is 0 (OK).' : `status is ${String(status)}.`,
  });

  const documents = response.get('documents');
  const document = Array.isArray(documents) ? (documents[0] as Map<string, unknown>) : undefined;
  if (!document) {
    checks.push({ id: 'mdoc.document', title: 'DeviceResponse contains a document', ok: false, detail: 'No documents present.' });
    return { checks, claims, decoded: response };
  }

  const docType = document.get('docType') as string;
  const issuerSigned = document.get('issuerSigned') as Map<string, unknown>;
  const issuerAuth = coseSign1FromArray(issuerSigned.get('issuerAuth'));

  // --- Issuer authentication -------------------------------------------
  const kid = coseKid(issuerAuth);
  let msoMap: Map<string, unknown> | undefined;

  try {
    const issuerKey = await options.resolveIssuerKey(kid);
    const payload = issuerAuth.payload;
    if (!payload) throw new Error('issuerAuth has no payload');

    const ok = verifyCose(issuerAuth, payload, issuerKey);
    checks.push({
      id: 'mdoc.issuer-auth',
      title: 'Issuer authentication verifies',
      ok,
      detail: ok
        ? `COSE_Sign1 over the MobileSecurityObject verified against ${kid ?? 'the resolved issuer key'}.`
        : 'The issuerAuth signature did not verify.',
    });

    const tagged = decode(payload);
    const inner = tagged instanceof Tag ? tagged.value : tagged;
    msoMap = decode(inner as Uint8Array) as Map<string, unknown>;
  } catch (error) {
    checks.push({
      id: 'mdoc.issuer-auth',
      title: 'Issuer authentication verifies',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (!msoMap) return { checks, claims, decoded: response };

  checks.push({
    id: 'mdoc.doctype',
    title: 'Document type matches the signed MobileSecurityObject',
    ok: msoMap.get('docType') === docType,
    detail:
      msoMap.get('docType') === docType
        ? `docType is ${docType}.`
        : `Document says ${docType} but the MSO says ${String(msoMap.get('docType'))}.`,
  });

  // --- Data element digests ---------------------------------------------
  const valueDigests = msoMap.get('valueDigests') as Map<string, Map<number, Uint8Array>>;
  const nameSpaces = (issuerSigned.get('nameSpaces') as Map<string, Tag[]>) ?? new Map();
  const mismatched: string[] = [];
  let disclosedCount = 0;

  for (const [ns, items] of nameSpaces) {
    const namespaceDigests = valueDigests?.get(ns);
    for (const item of items) {
      disclosedCount += 1;
      const itemMap = decode(item.value as Uint8Array) as Map<string, unknown>;
      const identifier = itemMap.get('elementIdentifier') as string;
      const digestId = itemMap.get('digestID') as number;
      const expected = namespaceDigests?.get(digestId);
      const actual = sha256(encode(item));

      if (!expected || !Buffer.from(expected).equals(actual)) {
        mismatched.push(identifier);
      } else {
        claims[identifier] = unwrapValue(itemMap.get('elementValue'));
      }
    }
  }

  checks.push({
    id: 'mdoc.value-digests',
    title: 'Disclosed elements match the signed digests',
    ok: mismatched.length === 0,
    detail:
      mismatched.length === 0
        ? `All ${disclosedCount} disclosed element(s) match their digest in the MSO.`
        : `Digest mismatch for: ${mismatched.join(', ')}. The issuer signed over different values than were disclosed.`,
  });

  // --- Validity ----------------------------------------------------------
  const validity = msoMap.get('validityInfo') as Map<string, unknown>;
  const validUntil = readDate(validity?.get('validUntil'));
  const validFrom = readDate(validity?.get('validFrom'));
  const now = Date.now();
  const expired = validUntil !== undefined && validUntil.getTime() < now;
  const notYetValid = validFrom !== undefined && validFrom.getTime() > now;

  checks.push({
    id: 'mdoc.validity',
    title: 'Document is within its validity window',
    ok: !expired && !notYetValid,
    detail: expired
      ? `validUntil was ${validUntil?.toISOString()}.`
      : notYetValid
        ? `validFrom is ${validFrom?.toISOString()}.`
        : 'Within validity.',
    expiryRelated: true,
  });

  // --- Device authentication ---------------------------------------------
  const deviceSigned = document.get('deviceSigned') as Map<string, unknown> | undefined;
  if (!deviceSigned) {
    checks.push({
      id: 'mdoc.device-auth-present',
      title: 'Document includes device authentication',
      ok: false,
      detail: 'No deviceSigned block: the response proves issuance but not possession by this device.',
    });
  } else {
    const deviceAuth = deviceSigned.get('deviceAuth') as Map<string, unknown>;
    const signatureArray = deviceAuth?.get('deviceSignature');

    if (!signatureArray) {
      checks.push({
        id: 'mdoc.device-auth-present',
        title: 'Document includes device authentication',
        ok: false,
        detail: 'deviceAuth carries no deviceSignature (deviceMac is not supported by this verifier).',
      });
    } else {
      const deviceSignature = coseSign1FromArray(signatureArray);
      const deviceKeyInfo = msoMap.get('deviceKeyInfo') as Map<string, unknown>;
      const deviceKeyCose = deviceKeyInfo?.get('deviceKey') as Map<number, unknown>;

      try {
        const deviceKey = (await importJWK(jwkFromCoseKey(deviceKeyCose), 'ES256')) as KeyLike;
        const deviceNameSpacesBytes = deviceSigned.get('nameSpaces');

        // Rebuilt from the request this verifier issued, which is exactly what
        // makes a captured response unusable against a different one.
        const transcript = oid4vpSessionTranscript({
          clientId: options.clientId,
          responseUri: options.responseUri,
          nonce: options.nonce,
          mdocGeneratedNonce: options.mdocGeneratedNonce ?? '',
        });
        const deviceAuthentication = [
          'DeviceAuthentication',
          new Tag(transcript, 24),
          docType,
          deviceNameSpacesBytes,
        ];
        const verified = verifyCose(
          deviceSignature,
          encode(taggedBytes(deviceAuthentication)),
          deviceKey,
        );

        checks.push({
          id: 'mdoc.device-auth',
          title: 'Device authentication verifies against the session transcript',
          ok: verified,
          detail: verified
            ? 'The device signature covers this verifier’s client id, response URI and nonce.'
            : 'The device signature does not match a transcript built from this request. Either the response was captured from a different exchange, or the holder signed over a different nonce.',
        });
      } catch (error) {
        checks.push({
          id: 'mdoc.device-auth',
          title: 'Device authentication verifies against the session transcript',
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { checks, claims, docType, decoded: describe(response) };
}

function readDocType(issuerSigned: Map<string, unknown>): string {
  const issuerAuth = coseSign1FromArray(issuerSigned.get('issuerAuth'));
  if (!issuerAuth.payload) return MDL_DOCTYPE;
  const tagged = decode(issuerAuth.payload);
  const inner = tagged instanceof Tag ? tagged.value : tagged;
  const mso = decode(inner as Uint8Array) as Map<string, unknown>;
  return (mso.get('docType') as string) ?? MDL_DOCTYPE;
}

function readElementIdentifier(item: Tag): string {
  const map = decode(item.value as Uint8Array) as Map<string, unknown>;
  return map.get('elementIdentifier') as string;
}

/**
 * Reads a `tdate`.
 *
 * cbor-x decodes CBOR tag 0 natively into a `Date`, so the tagged form never
 * reaches here in practice — but an encoder that leaves the tag intact, or one
 * that emits a bare string, both have to keep working, and silently returning
 * undefined would turn a missed expiry into a passing check.
 */
function readDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (value instanceof Tag) return new Date(String(value.value));
  if (typeof value === 'string') return new Date(value);
  if (typeof value === 'number') return new Date(value * 1000);
  return undefined;
}

function unwrapValue(value: unknown): unknown {
  if (value instanceof Tag) return value.value;
  if (Buffer.isBuffer(value)) return value.toString('base64url');
  return value;
}

/** Converts the decoded CBOR into something JSON-serialisable for the UI. */
export function describe(value: unknown): unknown {
  if (value instanceof Tag) {
    return value.tag === 24
      ? { '#6.24': describe(decode(value.value as Uint8Array)) }
      : { [`#6.${value.tag}`]: describe(value.value) };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    return buffer.length > 48
      ? `<${buffer.length} bytes> ${buffer.subarray(0, 16).toString('base64url')}…`
      : buffer.toString('base64url');
  }
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, entry]) => [String(key), describe(entry)]));
  }
  if (Array.isArray(value)) return value.map(describe);
  return value;
}

export { encode as encodeCbor, decode as decodeCbor };
