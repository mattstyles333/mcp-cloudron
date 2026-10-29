/**
 * Fake Cloudron for unit tests.
 *
 * Every request is checked against the real route table extracted from
 * Cloudron's server source (tests/fixtures/cloudron-routes.json, see
 * scripts/extract-cloudron-routes.mjs). A request to a route that does not
 * exist in every supported Cloudron version fails the test, even if the test
 * mocked it. Responses are real Response objects, so 204 / empty bodies
 * behave as they do against a live server.
 */

import { readFileSync } from "node:fs"
import { vi } from "vitest"
import {
  type CloudronContext,
  createCloudronContextFromHttp,
  HttpClient,
} from "../../src/client/index"
import type {
  App,
  AppStoreApp,
  Backup,
  BackupSite,
  Filesystem,
  User,
} from "../../src/types"

export const BASE_URL = "https://my.example.com"
export const TOKEN = "test-token-12345"

const routeFixture: Record<string, string[]> = JSON.parse(
  readFileSync(
    new URL("../fixtures/cloudron-routes.json", import.meta.url),
    "utf8",
  ),
)
export const SUPPORTED_VERSIONS = Object.keys(routeFixture)

function compile(route: string): { method: string; pattern: RegExp } {
  const [method, path] = route.split(" ") as [string, string]
  const pattern = path
    .split("/")
    .map(part =>
      part.startsWith(":")
        ? "[^/]+"
        : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/")
  return { method, pattern: new RegExp(`^${pattern}/?$`) }
}

const compiled = Object.fromEntries(
  Object.entries(routeFixture).map(([version, routes]) => [
    version,
    routes.map(compile),
  ]),
)

/**
 * Versions of Cloudron that do NOT serve this method + path
 */
export function missingInVersions(method: string, path: string): string[] {
  return SUPPORTED_VERSIONS.filter(
    version =>
      !compiled[version]?.some(
        route => route.method === method && route.pattern.test(path),
      ),
  )
}

export interface FakeResponse {
  status?: number
  body?: unknown // object -> JSON, string -> raw text, undefined -> empty
}

export type FakeHandler =
  | FakeResponse
  | ((request: RecordedRequest) => FakeResponse)

export interface RecordedRequest {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  headers: Record<string, string>
}

export interface FakeCloudron {
  fetch: typeof fetch
  requests: RecordedRequest[]
  /** requests matching "METHOD /path" (query ignored) */
  calls(key: string): RecordedRequest[]
}

/**
 * Build a fake. Keys are "METHOD /api/v1/path" (no host, no query).
 * Unmocked but real routes answer 404, like Cloudron for an unknown id.
 */
export function createFakeCloudron(
  routes: Record<string, FakeHandler>,
): FakeCloudron {
  for (const key of Object.keys(routes)) {
    const [method, path] = key.split(" ") as [string, string]
    const missing = missingInVersions(method, path)
    if (missing.length > 0) {
      throw new Error(
        `Test mocks ${key}, which Cloudron ${missing.join(", ")} does not serve`,
      )
    }
  }

  const requests: RecordedRequest[] = []

  const fetchImpl = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString())
      const method = init?.method ?? "GET"
      const path = url.pathname
      const key = `${method} ${path}`

      if (url.origin !== BASE_URL) {
        throw new Error(`Request left the fake Cloudron: ${url.href}`)
      }
      const missing = missingInVersions(method, path)
      if (missing.length > 0) {
        throw new Error(
          `Request to ${key}, which Cloudron ${missing.join(", ")} does not serve`,
        )
      }

      const headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(
          ([k, v]) => [k.toLowerCase(), v],
        ),
      )
      const request: RecordedRequest = {
        method,
        path,
        query: url.searchParams,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        headers,
      }
      requests.push(request)

      const handler = routes[key]
      const response: FakeResponse = handler
        ? typeof handler === "function"
          ? handler(request)
          : handler
        : { status: 404, body: { status: "Not Found", message: "Not found" } }

      const status = response.status ?? 200
      const body =
        response.body === undefined || status === 204
          ? null
          : typeof response.body === "string"
            ? response.body
            : JSON.stringify(response.body)
      return new Response(body, { status })
    },
  )

  return {
    fetch: fetchImpl as unknown as typeof fetch,
    requests,
    calls: key => requests.filter(r => `${r.method} ${r.path}` === key),
  }
}

/**
 * Install a fake and return a context wired to it
 */
export function useFakeCloudron(routes: Record<string, FakeHandler>): {
  fake: FakeCloudron
  ctx: CloudronContext
} {
  const fake = createFakeCloudron(routes)
  global.fetch = fake.fetch
  const ctx = createCloudronContextFromHttp(
    new HttpClient({ baseUrl: BASE_URL, token: TOKEN }),
  )
  return { fake, ctx }
}

// ==================== Fixtures in Cloudron's real shapes ====================

export function makeApp(overrides: Partial<App> = {}): App {
  return {
    id: "app-1",
    appStoreId: "org.wordpress.cloudronapp",
    installationState: "installed",
    runState: "running",
    health: "healthy",
    error: null,
    taskId: null,
    subdomain: "blog",
    domain: "example.com",
    fqdn: "blog.example.com",
    label: null,
    tags: [],
    accessRestriction: null,
    manifest: {
      id: "org.wordpress.cloudronapp",
      title: "WordPress",
      version: "3.21.0",
    },
    portBindings: null,
    memoryLimit: 0,
    env: { EXISTING: "keep", SECRET_KEY: "s3cr3t" },
    enableBackup: true,
    enableAutomaticUpdate: true,
    updateInfo: null,
    creationTime: "2026-01-15T10:00:00.000Z",
    ...overrides,
  }
}

export function makeBackup(overrides: Partial<Backup> = {}): Backup {
  return {
    id: "app_app-1_v3.21.0_2026-10-28",
    identifier: "app-1",
    creationTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    packageVersion: "3.21.0",
    type: "app",
    state: "normal",
    siteId: "site-1",
    stats: { size: 50 * 1024 * 1024 },
    ...overrides,
  }
}

export function makeBackupSite(
  overrides: Partial<BackupSite> = {},
): BackupSite {
  return {
    id: "site-1",
    name: "Hetzner storage box",
    provider: "sshfs",
    format: "tgz",
    schedule: "00 00 23 * * *",
    enableForUpdates: true,
    encrypted: true,
    ...overrides,
  }
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "uid-1",
    username: "alice",
    email: "alice@example.com",
    displayName: "Alice",
    role: "user",
    active: true,
    source: "",
    groupIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    inviteAccepted: true,
    ...overrides,
  }
}

export function makeAppStoreApp(
  id: string,
  title: string,
  extra: Partial<AppStoreApp["manifest"]> = {},
): AppStoreApp {
  return {
    id,
    iconUrl: null,
    manifest: { id, title, version: "1.0.0", ...extra },
  }
}

const GB = 1024 * 1024 * 1024

export function makeFilesystems(
  availableGB: number,
  sizeGB = 100,
): { filesystems: Record<string, Filesystem> } {
  return {
    filesystems: {
      "/dev/sda1": {
        filesystem: "/dev/sda1",
        type: "ext4",
        size: sizeGB * GB,
        used: (sizeGB - availableGB) * GB,
        available: availableGB * GB,
        mountpoint: "/",
      },
      "/dev/sdb1": {
        filesystem: "/dev/sdb1",
        type: "ext4",
        size: 1000 * GB,
        used: 0,
        available: 1000 * GB,
        mountpoint: "/mnt/data",
      },
    },
  }
}

export function textOf(response: { content: { text: string }[] }): string {
  return response.content.map(c => c.text).join("\n")
}
