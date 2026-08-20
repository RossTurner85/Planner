import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { PlaidCreds, PlaidEnv } from './plaid'

/**
 * Plaid API keys and bank access tokens live here. Everything sensitive is run
 * through Electron's safeStorage (DPAPI on Windows, Keychain on macOS) so the
 * secrets on disk are useless to anything but this app under this OS account.
 */

type StoredCreds = {
  env: PlaidEnv
  clientId: string
  secret: string
}

function credsFile() {
  return path.join(app.getPath('userData'), 'plaid-creds.json')
}

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

function seal(value: string): string {
  return safeStorage.encryptString(value).toString('base64')
}

function unseal(value: string): string {
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}

/** Wraps a bank access token for storage in the database. */
export function sealToken(token: string): string {
  return seal(token)
}

export function unsealToken(token: string): string {
  return unseal(token)
}

export function saveCreds(input: {
  clientId: string
  secret: string
  env: PlaidEnv
}) {
  const payload = {
    env: input.env,
    clientId: seal(input.clientId.trim()),
    secret: seal(input.secret.trim()),
  }
  fs.writeFileSync(credsFile(), JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export function loadCreds(): PlaidCreds | null {
  const file = credsFile()
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredCreds
    if (!raw.clientId || !raw.secret) return null
    return {
      clientId: unseal(raw.clientId),
      secret: unseal(raw.secret),
      env: raw.env === 'production' ? 'production' : 'sandbox',
    }
  } catch {
    // A corrupt or undecryptable file behaves like "not configured" so the UI
    // can offer to re-enter the keys instead of dead-ending.
    return null
  }
}

export function clearCreds() {
  const file = credsFile()
  if (fs.existsSync(file)) fs.rmSync(file)
}

export type PlaidCredStatus = {
  configured: boolean
  env: PlaidEnv
  clientIdHint: string | null
  encryptionAvailable: boolean
}

export function credStatus(): PlaidCredStatus {
  const creds = loadCreds()
  return {
    configured: Boolean(creds),
    env: creds?.env ?? 'sandbox',
    clientIdHint: creds ? `…${creds.clientId.slice(-4)}` : null,
    encryptionAvailable: encryptionAvailable(),
  }
}

export function requireCreds(): PlaidCreds {
  const creds = loadCreds()
  if (!creds) {
    throw new Error('Add your Plaid client ID and secret before connecting.')
  }
  return creds
}
