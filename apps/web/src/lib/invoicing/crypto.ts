import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifra a chave da API do InvoiceXpress de cada cliente (AES-256-GCM). A chave mestra (32 bytes em base64)
 * fica só nas variáveis de ambiente do servidor (INVOICING_ENCRYPTION_KEY); a base de dados guarda só o texto cifrado.
 * Formato: v1.<iv>.<tag>.<dados> (base64url).
 */
function masterKey(): Buffer {
  const raw = process.env.INVOICING_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("INVOICING_ENCRYPTION_KEY em falta");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("INVOICING_ENCRYPTION_KEY tem de ter 32 bytes (base64)");
  return key;
}

export function encryptionConfigured(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(token: string): string {
  const [version, iv, tag, data] = token.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("formato inválido");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
