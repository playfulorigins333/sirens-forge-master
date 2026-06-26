import "server-only"
import crypto from "crypto"

const TOKEN_PREFIX = "v1"

function base64UrlEncode(value: Buffer) {
  return value.toString("base64url")
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url")
}

function getTokenEncryptionKey() {
  const encodedKey = process.env.AUTOPOST_TOKEN_ENCRYPTION_KEY
  if (!encodedKey) {
    throw new Error("AUTOPOST_TOKEN_ENCRYPTION_KEY_NOT_CONFIGURED")
  }

  const key = Buffer.from(encodedKey, "base64")
  if (key.length !== 32) {
    throw new Error("AUTOPOST_TOKEN_ENCRYPTION_KEY_INVALID")
  }

  return key
}

export function getAutopostTokenKeyVersion() {
  const version = Number.parseInt(process.env.AUTOPOST_TOKEN_KEY_VERSION ?? "1", 10)
  if (!Number.isFinite(version) || version < 1) return 1
  return version
}

export function encryptAutopostToken(token: string) {
  if (!token) {
    throw new Error("TOKEN_ENCRYPTION_INPUT_EMPTY")
  }

  const key = getTokenEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    TOKEN_PREFIX,
    base64UrlEncode(iv),
    base64UrlEncode(authTag),
    base64UrlEncode(ciphertext),
  ].join(":")
}

export function decryptAutopostToken(encryptedToken: string) {
  if (!encryptedToken) {
    throw new Error("TOKEN_DECRYPTION_INPUT_EMPTY")
  }

  const [version, iv, authTag, ciphertext] = encryptedToken.split(":")
  if (version !== TOKEN_PREFIX || !iv || !authTag || !ciphertext) {
    throw new Error("TOKEN_DECRYPTION_FORMAT_INVALID")
  }

  const key = getTokenEncryptionKey()
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, base64UrlDecode(iv))
  decipher.setAuthTag(base64UrlDecode(authTag))

  return Buffer.concat([
    decipher.update(base64UrlDecode(ciphertext)),
    decipher.final(),
  ]).toString("utf8")
}
