import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";

const DOMAIN = "quorate-proof-attestation-v1\n";
const MAX_BYTES = 16 * 1024 * 1024;

function readBounded(path: string, privateKey = false): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) throw new Error("Expected a bounded regular file.");
  if (privateKey && process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("Signing key must be owner-readable only.");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > MAX_BYTES) throw new Error("File changed during verification.");
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

/** Keys are supplied explicitly; repository configuration cannot establish trust. */
export function generateProofKeyPair(privatePath: string, publicPath: string): void {
  const pair = generateKeyPairSync("ed25519");
  writeFileSync(privatePath, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  writeFileSync(publicPath, pair.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644, flag: "wx" });
}

export function exportPortableProof(artifact: unknown, privatePath: string, output: string): void {
  const key = createPrivateKey(readBounded(privatePath, true));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Proof signer must be Ed25519.");
  const payload = JSON.stringify(artifact);
  const signature = sign(null, Buffer.from(DOMAIN + payload), key).toString("base64");
  writeFileSync(output, JSON.stringify({ kind: "quorate-proof-attestation-v1", payload, signature }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

/** No embedded key, network lookup, or auto-trust. The caller pins the signer's key. */
export function readPortableProof(path: string, trustedKeyPath: string): unknown {
  const envelope = JSON.parse(readBounded(path).toString("utf8"));
  if (envelope?.kind !== "quorate-proof-attestation-v1" || typeof envelope.payload !== "string" ||
      typeof envelope.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw new Error("Invalid proof attestation envelope.");
  const key = createPublicKey(readBounded(trustedKeyPath));
  if (key.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(DOMAIN + envelope.payload), key, Buffer.from(envelope.signature, "base64"))) {
    throw new Error("Proof attestation does not match the explicitly trusted signing key.");
  }
  return JSON.parse(envelope.payload);
}
