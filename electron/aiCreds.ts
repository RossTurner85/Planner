import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_MODEL, isKnownModel } from './openai'

/**
 * The OpenAI key is stored the same way as the Plaid secrets: encrypted by
 * Electron's safeStorage (DPAPI on Windows, Keychain on macOS) so the file on
 * disk is useless to anything but this app under this OS account.
 */

type StoredAiCreds = {
  key: string
  model: string
}

function credsFile() {
  return path.join(app.getPath('userData'), 'openai-creds.json')
}

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export type AiCreds = {
  key: string
  model: string
}

export function saveKey(input: { key: string; model?: string }) {
  const existing = loadCreds()
  const payload: StoredAiCreds = {
    key: safeStorage.encryptString(input.key.trim()).toString('base64'),
    model: pickModel(input.model ?? existing?.model),
  }
  fs.writeFileSync(credsFile(), JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export function saveModel(model: string) {
  const existing = loadCreds()
  if (!existing) throw new Error('Add your OpenAI key first.')
  saveKey({ key: existing.key, model })
}

export function loadCreds(): AiCreds | null {
  const file = credsFile()
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredAiCreds
    if (!raw.key) return null
    return {
      key: safeStorage.decryptString(Buffer.from(raw.key, 'base64')),
      model: pickModel(raw.model),
    }
  } catch {
    // A corrupt or undecryptable file behaves like "not configured" so the UI
    // can offer to re-enter the key instead of dead-ending.
    return null
  }
}

export function clearKey() {
  const file = credsFile()
  if (fs.existsSync(file)) fs.rmSync(file)
}

function pickModel(model: string | undefined): string {
  return model && isKnownModel(model) ? model : DEFAULT_MODEL
}

export type AiStatus = {
  configured: boolean
  keyHint: string | null
  model: string
  encryptionAvailable: boolean
}

export function aiStatus(): AiStatus {
  const creds = loadCreds()
  return {
    configured: Boolean(creds),
    // Only the tail is ever shown, which is enough to tell two keys apart.
    keyHint: creds ? `…${creds.key.slice(-4)}` : null,
    model: creds?.model ?? DEFAULT_MODEL,
    encryptionAvailable: encryptionAvailable(),
  }
}

export function requireCreds(): AiCreds {
  const creds = loadCreds()
  if (!creds) throw new Error('Add your OpenAI API key before asking.')
  return creds
}
