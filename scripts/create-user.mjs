// Usage: node scripts/create-user.mjs <username> [display_name] [department]
//        department: servers_bus | hostess_bar | all (defaults to "all")

import { createClient } from '@supabase/supabase-js'
import { randomBytes, scrypt } from 'crypto'
import { promisify } from 'util'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const scryptAsync = promisify(scrypt)

function loadEnvLocal() {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const envPath = path.join(dir, '..', '.env.local')
  if (!existsSync(envPath)) return
  const content = readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const derived = await scryptAsync(password, salt, 64)
  return `${salt}:${derived.toString('hex')}`
}

function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(12)
  let out = ''
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length]
  return out
}

loadEnvLocal()

const [, , usernameArg, displayNameArg, departmentArg] = process.argv

if (!usernameArg) {
  console.error('Usage: node scripts/create-user.mjs <username> [display_name] [department]')
  process.exit(1)
}

const allowedDepartments = ['servers_bus', 'hostess_bar', 'all']
const department =
  departmentArg && allowedDepartments.includes(departmentArg) ? departmentArg : 'all'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local or your shell.'
  )
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const tempPassword = generateTempPassword()
const password_hash = await hashPassword(tempPassword)

const { data, error } = await supabase
  .from('users')
  .insert({
    username: usernameArg,
    password_hash,
    display_name: displayNameArg ?? null,
    department,
    must_set_password: true,
  })
  .select('id, username')
  .single()

if (error) {
  console.error('Failed to create user:', error.message)
  process.exit(1)
}

console.log('User created:')
console.log(`  username: ${data.username}`)
console.log(`  temporary password: ${tempPassword}`)
console.log('Relay this temporary password to the employee — they will be forced to set a new one on first login.')
