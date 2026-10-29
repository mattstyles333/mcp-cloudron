/**
 * Checks the app makes against its own Cloudron with the configured token
 */

import { HttpClient } from "../client/http-client.js"
import { isCloudronError } from "../errors.js"
import type { User, UserRole } from "../types.js"
import type { TokenStatus } from "./store.js"

/**
 * Validate a token and find out whether it may write.
 *
 * Cloudron checks token scope before it validates the request body, so
 * POST /groups with an empty body answers 403 for a read-only token and 400
 * ("name must be string") for a read-write one. Nothing is created.
 */
export async function checkToken(
  origin: string,
  token: string,
): Promise<TokenStatus> {
  const http = new HttpClient({ baseUrl: origin, token })
  const checkedAt = new Date().toISOString()

  let cloudronVersion: string | null = null
  try {
    cloudronVersion = (
      await http.get<{ version: string }>("/api/v1/cloudron/status")
    ).version
    await http.get("/api/v1/system/info")
  } catch (error) {
    return {
      checkedAt,
      ok: false,
      writable: null,
      cloudronVersion,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  let writable: boolean | null = null
  try {
    await http.post("/api/v1/groups", {})
  } catch (error) {
    if (isCloudronError(error)) {
      if (error.statusCode === 400) writable = true
      if (error.statusCode === 403) writable = false
    }
  }

  return { checkedAt, ok: true, writable, cloudronVersion, error: null }
}

const ROLE_CACHE_MS = 60_000

/**
 * Looks up the Cloudron role of the user signed in through proxyAuth
 */
export class RoleLookup {
  private cache = new Map<string, { role: UserRole | null; at: number }>()

  async roleOf(
    origin: string,
    token: string,
    username: string,
  ): Promise<UserRole | null> {
    const cached = this.cache.get(username)
    if (cached && Date.now() - cached.at < ROLE_CACHE_MS) return cached.role

    const http = new HttpClient({ baseUrl: origin, token })
    const users = await http.getAllPages<User>("/api/v1/users", "users", {
      search: username,
    })
    const role = users.find(u => u.username === username)?.role ?? null
    this.cache.set(username, { role, at: Date.now() })
    return role
  }

  clear(): void {
    this.cache.clear()
  }
}
