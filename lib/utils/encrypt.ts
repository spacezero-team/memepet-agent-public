/**
 * AES-256-GCM encryption utility for sensitive data at rest.
 * Key is sourced from ENCRYPTION_KEY environment variable (64-char hex = 32 bytes).
 *
 * Compatible with ig-memepet-pipeline encrypt.ts.
 */

import { createDecipheriv } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const AUTH_TAG_LENGTH = 16

/** Encrypted format: "iv:authTag:ciphertext" (all hex) */
const ENCRYPTED_PATTERN = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'ENCRYPTION_KEY environment variable must be a 64-character hex string (32 bytes)',
    )
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Decrypt a string encrypted by AES-256-GCM encrypt().
 * @param encoded - String in format "iv:authTag:ciphertext" (all hex)
 * @returns Original plaintext
 */
export function decrypt(encoded: string): string {
  const parts = encoded.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected "iv:authTag:ciphertext"')
  }

  const key = getKey()
  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const ciphertext = Buffer.from(parts[2], 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

/**
 * Check if a string looks like it was encrypted (iv:authTag:ciphertext hex format).
 */
export function isEncrypted(value: string): boolean {
  return ENCRYPTED_PATTERN.test(value) && value.split(':').length === 3
}

/**
 * Decrypt if encrypted, otherwise return plaintext as-is.
 * If ENCRYPTION_KEY is missing, returns the raw value to avoid crashing the cron.
 */
export function decryptIfNeeded(value: string): string {
  if (!isEncrypted(value)) {
    return value
  }
  try {
    return decrypt(value)
  } catch {
    // ENCRYPTION_KEY missing or invalid — return raw value so auth can at least attempt.
    // Login will fail, but the cron won't crash with a 500.
    return value
  }
}
