import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Transparent envelope encryption for medical text columns.
 *
 * The on-disk shape is identical with or without a key:
 *   - encrypted  : `iv(12) || tag(16) || ciphertext`
 *   - plaintext  : `utf8(text)`
 *
 * We pick between the two via the `MedicalCrypto` interface. The boot path
 * picks the implementation based on whether `MEDICAL_ENCRYPTION_KEY` is
 * present in the env. A one-time `medical_unencrypted_warning` log
 * announces the plaintext fallback; production deployments should always
 * supply a key.
 *
 * The key is consumed as either:
 *   - 32-byte raw, supplied as base64 (recommended), or
 *   - hex (64 chars).
 *
 * A leading "base64:" / "hex:" prefix is accepted; otherwise we try
 * base64 first and fall back to hex.
 */

const AES_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface MedicalCrypto {
  readonly encrypted: boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

/** Plaintext fallback. Used when `MEDICAL_ENCRYPTION_KEY` is unset. */
export class PlaintextMedicalCrypto implements MedicalCrypto {
  public readonly encrypted = false;
  encrypt(plaintext: string): Buffer {
    return Buffer.from(plaintext, "utf8");
  }
  decrypt(ciphertext: Buffer): string {
    return ciphertext.toString("utf8");
  }
}

/** AES-256-GCM, fresh 12-byte IV per record. */
export class AesGcmMedicalCrypto implements MedicalCrypto {
  public readonly encrypted = true;
  constructor(private readonly key: Buffer) {
    if (this.key.length !== AES_KEY_BYTES) {
      throw new Error(
        `MEDICAL_ENCRYPTION_KEY must decode to exactly ${String(AES_KEY_BYTES)} bytes (got ${String(this.key.length)})`,
      );
    }
  }
  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]);
  }
  decrypt(blob: Buffer): string {
    if (blob.length < IV_BYTES + TAG_BYTES) {
      // Best-effort: this looks like a plaintext row written when the
      // key was absent. Surface as utf8 so reads keep working across
      // the deploy-with-no-key → deploy-with-key transition.
      return blob.toString("utf8");
    }
    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const enc = blob.subarray(IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
      return dec.toString("utf8");
    } catch {
      // Same fallback as the short-blob case — older rows may predate
      // the key and were stored as raw utf8.
      return blob.toString("utf8");
    }
  }
}

/** Boot helper. Returns the appropriate crypto plus a boolean indicating
 *  whether the caller should log the unencrypted warning. */
export function loadMedicalCrypto(envValue: string | undefined): {
  crypto: MedicalCrypto;
  unencrypted: boolean;
} {
  if (envValue === undefined || envValue.length === 0) {
    return { crypto: new PlaintextMedicalCrypto(), unencrypted: true };
  }
  let raw = envValue.trim();
  let key: Buffer | null = null;
  if (raw.startsWith("base64:")) {
    raw = raw.slice("base64:".length);
    key = Buffer.from(raw, "base64");
  } else if (raw.startsWith("hex:")) {
    raw = raw.slice("hex:".length);
    key = Buffer.from(raw, "hex");
  } else {
    // Try base64, fall back to hex.
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === AES_KEY_BYTES) {
      key = b64;
    } else {
      const hx = Buffer.from(raw, "hex");
      if (hx.length === AES_KEY_BYTES) key = hx;
    }
  }
  if (key?.length !== AES_KEY_BYTES) {
    throw new Error(
      "MEDICAL_ENCRYPTION_KEY did not decode to 32 bytes (use base64 or hex)",
    );
  }
  return { crypto: new AesGcmMedicalCrypto(key), unencrypted: false };
}
