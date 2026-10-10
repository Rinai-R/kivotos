/**
 * A member's identity towards other members: a P-256 key and a self-signed
 * certificate for it. Nobody validates the certificate's contents; members
 * identify each other by its SHA-256 (the node id) and by the federation
 * proof, so the certificate only has to be well formed.
 */
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";

/** PEM key and certificate, plus the certificate's DER for fingerprinting. */
export interface Identity {
  keyPem: string;
  certPem: string;
  certDer: Buffer;
}

function tlv(tag: number, ...parts: Uint8Array[]): Buffer {
  const body = Buffer.concat(parts);
  if (body.length < 0x80) return Buffer.concat([Buffer.from([tag, body.length]), body]);
  const size: number[] = [];
  for (let rest = body.length; rest > 0; rest >>= 8) size.unshift(rest & 0xff);
  return Buffer.concat([Buffer.from([tag, 0x80 | size.length, ...size]), body]);
}

const SEQUENCE = 0x30;
const SET = 0x31;
const INTEGER = 0x02;
const BIT_STRING = 0x03;
const UTF8_STRING = 0x0c;
const UTC_TIME = 0x17;
const GENERALIZED_TIME = 0x18;
const CONTEXT_0 = 0xa0;
/** ecdsa-with-SHA256, 1.2.840.10045.4.3.2 */
const ECDSA_SHA256 = Buffer.from("06082a8648ce3d040302", "hex");
/** commonName, 2.5.4.3 */
const COMMON_NAME = Buffer.from("0603550403", "hex");

/** @returns a fresh key and a self-signed certificate that does not expire in practice. */
export function createIdentity(): Identity {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const algorithm = tlv(SEQUENCE, ECDSA_SHA256);
  const name = tlv(
    SEQUENCE,
    tlv(SET, tlv(SEQUENCE, COMMON_NAME, tlv(UTF8_STRING, Buffer.from("kivotos")))),
  );
  // A positive serial: clear the top bit so the INTEGER needs no padding byte.
  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x7f) | 0x01;
  const tbs = tlv(
    SEQUENCE,
    tlv(CONTEXT_0, tlv(INTEGER, Buffer.from([2]))), // v3
    tlv(INTEGER, serial),
    algorithm,
    name,
    tlv(
      SEQUENCE,
      tlv(UTC_TIME, Buffer.from("200101000000Z")),
      // Dates from 2050 on must be GeneralizedTime.
      tlv(GENERALIZED_TIME, Buffer.from("20991231235959Z")),
    ),
    name,
    publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = sign("sha256", tbs, privateKey);
  const certDer = tlv(SEQUENCE, tbs, algorithm, tlv(BIT_STRING, Buffer.from([0]), signature));
  return {
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    certPem: new X509Certificate(certDer).toString(),
    certDer,
  };
}

/**
 * @param keyPem - stored private key.
 * @param certPem - stored certificate.
 * @returns the identity; throws when the certificate does not parse.
 */
export function loadIdentity(keyPem: string, certPem: string): Identity {
  return { keyPem, certPem, certDer: new X509Certificate(certPem).raw };
}
