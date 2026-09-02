import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import forge from 'node-forge';
import { importPKCS8, type KeyLike } from 'jose';

/**
 * A self-signed X.509 certificate for the issuer, and the RSA key under it.
 *
 * Exists for one reason: Inji Verify appears to resolve an SD-JWT issuer key
 * only from an embedded `x5c` chain, rejecting a `kid` with
 * "getX509CertChain(...) must not be null". That was a diagnosis rather than a
 * confirmed finding, and the only way to settle it is to issue a credential
 * that *does* carry a chain and see whether it verifies.
 *
 * RSA rather than Ed25519 because the certificate has to be usable with an
 * algorithm the verifier accepts, and RS256 is the intersection of what
 * node-forge signs and what SD-JWT implementations here support.
 */
export interface IssuerCertificate {
  /** DER certificate, base64 (not base64url) — the encoding `x5c` requires. */
  x5c: string[];
  /** Matching private key, for signing with RS256. */
  privateKey: KeyLike;
  /** PEM certificate, for anything that wants to inspect it. */
  certificatePem: string;
  subject: string;
}

const KEY_DIR = resolve(process.cwd(), '.keys');

/**
 * Loads or creates the certificate.
 *
 * Persisted like the other keys so a credential issued in one session still
 * verifies in the next, and so a verifier that pinned the certificate does not
 * start failing across a restart.
 */
export async function getIssuerCertificate(subject = 'inji-interop-playground'): Promise<IssuerCertificate> {
  const path = resolve(KEY_DIR, 'issuer-x509.json');

  let stored: { certificatePem: string; privateKeyPem: string } | undefined;
  try {
    stored = JSON.parse(await readFile(path, 'utf8')) as typeof stored;
  } catch {
    stored = undefined;
  }

  if (!stored) {
    stored = generate(subject);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(stored, null, 2), 'utf8');
  }

  const certificate = forge.pki.certificateFromPem(stored.certificatePem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();

  return {
    // `x5c` is standard base64 of the DER, one entry per certificate, leaf
    // first. Not base64url — a common and silent mistake.
    x5c: [forge.util.encode64(der)],
    privateKey: (await importPKCS8(toPkcs8(stored.privateKeyPem), 'RS256')) as KeyLike,
    certificatePem: stored.certificatePem,
    subject,
  };
}

function generate(subject: string): { certificatePem: string; privateKeyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();

  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date();
  certificate.validity.notAfter = new Date(Date.now() + 3650 * 864e5);

  const attrs = [{ name: 'commonName', value: subject }, { name: 'organizationName', value: 'Inji Interop Playground' }];
  certificate.setSubject(attrs);
  // Self-signed: issuer and subject are the same party. A production issuer
  // would present a chain to a CA the verifier already trusts.
  certificate.setIssuer(attrs);
  certificate.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', digitalSignature: true, keyCertSign: true }]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());

  return {
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/** node-forge emits PKCS#1; JOSE wants PKCS#8. */
function toPkcs8(pkcs1Pem: string): string {
  const privateKey = forge.pki.privateKeyFromPem(pkcs1Pem);
  const asn1 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(privateKey));
  return forge.pki.privateKeyInfoToPem(asn1);
}
