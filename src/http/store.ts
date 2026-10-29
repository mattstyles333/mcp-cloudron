/**
 * Persistent state for the Cloudron app: settings, client keys and the
 * activity log, kept under /app/data (included in Cloudron backups).
 *
 * Client keys are stored as SHA-256 hashes; the plain key is shown once.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { ACCESS_LEVELS, type AccessLevel } from "../config.js"

export const KEY_PREFIX = "mcpc_"
const ACTIVITY_LIMIT = 500

export interface ClientKey {
  id: string
  name: string
  hash: string
  hint: string // first characters of the key, for recognising it in the UI
  access: AccessLevel
  createdAt: string
  createdBy: string
  lastUsedAt: string | null
}

export interface TokenStatus {
  checkedAt: string
  ok: boolean
  writable: boolean | null // null when the probe could not tell
  cloudronVersion: string | null
  error: string | null
}

export interface Settings {
  maxAccess: AccessLevel
  cloudronToken: string | null
  tokenStatus: TokenStatus | null
}

export interface ActivityEntry {
  at: string
  key: string // key name
  tool: string
  ok: boolean
  summary: string // short, secret-free description of the call or error
}

interface StoreFile {
  version: 1
  settings: Settings
  keys: ClientKey[]
}

const DEFAULT_SETTINGS: Settings = {
  maxAccess: "write",
  cloudronToken: null,
  tokenStatus: null,
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}

export function generateKey(): string {
  return `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`
}

/**
 * The lower of two access levels
 */
export function minAccess(a: AccessLevel, b: AccessLevel): AccessLevel {
  return ACCESS_LEVELS.indexOf(a) <= ACCESS_LEVELS.indexOf(b) ? a : b
}

export class Store {
  private readonly statePath: string
  private readonly activityPath: string
  private data: StoreFile
  private activity: ActivityEntry[]
  private saveTimer: NodeJS.Timeout | null = null
  private appendsSinceRewrite = 0

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    this.statePath = join(dir, "state.json")
    this.activityPath = join(dir, "activity.jsonl")
    this.data = this.loadState()
    this.activity = this.loadActivity()
  }

  private loadState(): StoreFile {
    if (!existsSync(this.statePath)) {
      return { version: 1, settings: { ...DEFAULT_SETTINGS }, keys: [] }
    }
    const parsed = JSON.parse(readFileSync(this.statePath, "utf8")) as StoreFile
    return {
      version: 1,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
      keys: parsed.keys ?? [],
    }
  }

  private loadActivity(): ActivityEntry[] {
    if (!existsSync(this.activityPath)) return []
    const lines = readFileSync(this.activityPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-ACTIVITY_LIMIT)
    const entries: ActivityEntry[] = []
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line))
      } catch {
        // skip a torn line
      }
    }
    this.rewriteActivity(entries)
    return entries
  }

  /**
   * Keep the activity file at the last ACTIVITY_LIMIT entries
   */
  private rewriteActivity(entries: ActivityEntry[]): void {
    const tmp = `${this.activityPath}.tmp`
    writeFileSync(tmp, entries.map(e => `${JSON.stringify(e)}\n`).join(""), {
      mode: 0o600,
    })
    renameSync(tmp, this.activityPath)
    this.appendsSinceRewrite = 0
  }

  /**
   * Write state atomically (temp file + rename)
   */
  save(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const tmp = `${this.statePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.statePath)
  }

  private saveSoon(): void {
    this.saveTimer ??= setTimeout(() => this.save(), 5000)
    this.saveTimer.unref()
  }

  // ==================== Settings ====================

  getSettings(): Settings {
    return this.data.settings
  }

  setMaxAccess(level: AccessLevel): void {
    this.data.settings.maxAccess = level
    this.save()
  }

  setToken(token: string | null, status: TokenStatus | null): void {
    this.data.settings.cloudronToken = token
    this.data.settings.tokenStatus = status
    this.save()
  }

  setTokenStatus(status: TokenStatus): void {
    this.data.settings.tokenStatus = status
    this.save()
  }

  // ==================== Client keys ====================

  listKeys(): ClientKey[] {
    return this.data.keys
  }

  createKey(
    name: string,
    access: AccessLevel,
    createdBy: string,
  ): { key: ClientKey; secret: string } {
    const secret = generateKey()
    const key: ClientKey = {
      id: randomUUID(),
      name,
      hash: hashKey(secret),
      hint: secret.slice(0, KEY_PREFIX.length + 4),
      access,
      createdAt: new Date().toISOString(),
      createdBy,
      lastUsedAt: null,
    }
    this.data.keys.push(key)
    this.save()
    return { key, secret }
  }

  updateKeyAccess(id: string, access: AccessLevel): ClientKey | undefined {
    const key = this.data.keys.find(k => k.id === id)
    if (!key) return undefined
    key.access = access
    this.save()
    return key
  }

  revokeKey(id: string): boolean {
    const before = this.data.keys.length
    this.data.keys = this.data.keys.filter(k => k.id !== id)
    if (this.data.keys.length === before) return false
    this.save()
    return true
  }

  /**
   * Find the key a bearer token belongs to. Lookup is by hash, so the
   * comparison never touches the plain secret.
   */
  findKey(secret: string): ClientKey | undefined {
    if (!secret.startsWith(KEY_PREFIX)) return undefined
    const hash = hashKey(secret)
    return this.data.keys.find(k => k.hash === hash)
  }

  touchKey(key: ClientKey): void {
    key.lastUsedAt = new Date().toISOString()
    this.saveSoon()
  }

  // ==================== Activity ====================

  recordActivity(entry: ActivityEntry): void {
    this.activity.push(entry)
    if (this.activity.length > ACTIVITY_LIMIT) {
      this.activity.splice(0, this.activity.length - ACTIVITY_LIMIT)
    }
    appendFileSync(this.activityPath, `${JSON.stringify(entry)}\n`, {
      mode: 0o600,
    })
    if (++this.appendsSinceRewrite >= ACTIVITY_LIMIT) {
      this.rewriteActivity(this.activity)
    }
  }

  listActivity(limit = 100): ActivityEntry[] {
    return this.activity.slice(-limit).reverse()
  }

  flush(): void {
    if (this.saveTimer) this.save()
  }
}
