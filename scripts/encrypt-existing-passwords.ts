/**
 * One-time migration: encrypt existing plaintext app_passwords in bluesky_bot_config.
 * Only encrypts values that are NOT already in encrypted format (iv:authTag:ciphertext).
 */
import { readFileSync } from 'node:fs'
import { createCipheriv, randomBytes } from 'node:crypto'

const envContent = readFileSync('.env.local', 'utf-8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  let value = trimmed.slice(eqIdx + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  if (!process.env[key]) process.env[key] = value
}

import { createClient } from '@supabase/supabase-js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const ENCRYPTED_PATTERN = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY not set or invalid')
  }
  return Buffer.from(hex, 'hex')
}

function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

function isEncrypted(value: string): boolean {
  return ENCRYPTED_PATTERN.test(value) && value.split(':').length === 3
}

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  // Verify key works
  const testPlain = 'test-1234-abcd-efgh'
  const testEnc = encrypt(testPlain)
  console.log(`Key test: "${testPlain}" -> "${testEnc.slice(0, 30)}..." (${testEnc.length} chars)`)

  const { data: bots, error } = await supabase
    .from('bluesky_bot_config')
    .select('id, pet_id, handle, app_password')

  if (error || !bots) {
    console.error('Failed to load bots:', error)
    return
  }

  let encrypted = 0
  let skipped = 0

  for (const bot of bots) {
    const pw = String(bot.app_password ?? '')

    if (!pw) {
      console.log(`SKIP @${bot.handle}: no password`)
      skipped++
      continue
    }

    if (isEncrypted(pw)) {
      console.log(`SKIP @${bot.handle}: already encrypted`)
      skipped++
      continue
    }

    const encryptedPw = encrypt(pw)

    const { error: updateErr } = await supabase
      .from('bluesky_bot_config')
      .update({ app_password: encryptedPw, updated_at: new Date().toISOString() })
      .eq('id', bot.id)

    if (updateErr) {
      console.error(`FAIL @${bot.handle}: ${updateErr.message}`)
    } else {
      console.log(`OK   @${bot.handle}: encrypted (${pw.length} -> ${encryptedPw.length} chars)`)
      encrypted++
    }
  }

  console.log(`\nDone: ${encrypted} encrypted, ${skipped} skipped, ${bots.length} total`)

  // Verification: read back and try decrypting one
  if (encrypted > 0) {
    console.log('\n=== Verification ===')
    const { data: verify } = await supabase
      .from('bluesky_bot_config')
      .select('handle, app_password')
      .eq('is_active', true)
      .limit(1)

    if (verify?.[0]) {
      const stored = String(verify[0].app_password)
      console.log(`@${verify[0].handle}: stored=${stored.slice(0, 30)}... encrypted=${isEncrypted(stored)}`)

      // Test decryptIfNeeded logic
      const { decryptIfNeeded } = await import('../lib/utils/encrypt.js')
      const decrypted = decryptIfNeeded(stored)
      const looksLikePw = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(decrypted)
      console.log(`Decrypted: ${decrypted.slice(0, 4)}... looksLikePassword=${looksLikePw}`)
    }
  }
}

main().catch(console.error)
