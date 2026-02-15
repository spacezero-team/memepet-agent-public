/**
 * Encrypt any plaintext app_passwords in bluesky_bot_config.
 * Only encrypts values that don't match the encrypted format (hex:hex:hex).
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
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

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? ''
const isEncryptedPattern = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/

function encryptSecret(plaintext: string): string {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

const sb = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  if (!ENCRYPTION_KEY) {
    console.error('ENCRYPTION_KEY not set')
    process.exit(1)
  }

  const { data: configs } = await sb
    .from('bluesky_bot_config')
    .select('id, handle, app_password')

  let encrypted = 0
  for (const config of configs ?? []) {
    if (!config.app_password) continue
    if (isEncryptedPattern.test(config.app_password)) continue

    // Plaintext password found — encrypt it
    const encryptedPw = encryptSecret(config.app_password)
    const { error } = await sb
      .from('bluesky_bot_config')
      .update({ app_password: encryptedPw })
      .eq('id', config.id)

    if (error) {
      console.log(`FAIL: ${config.handle} — ${error.message}`)
    } else {
      console.log(`Encrypted: ${config.handle}`)
      encrypted++
    }
  }

  console.log(`\nDone. Encrypted ${encrypted} password(s).`)
}

main().catch(console.error)
