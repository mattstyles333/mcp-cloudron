/**
 * The Cloudron app: MCP over HTTP, client keys, settings API, UI
 */

import { mkdtempSync, rmSync, statSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AccessLevel } from "../../src/config"
import { createApp } from "../../src/http/app"
import { checkToken, RoleLookup } from "../../src/http/cloudron-checks"
import { Store, type TokenStatus } from "../../src/http/store"
import { toolsForAccessLevel } from "../../src/tools/access"
import {
  BASE_URL,
  type FakeHandler,
  makeApp,
  makeUser,
  useFakeCloudron,
} from "../helpers/cloudron-fake"

const UI_DIR = new URL("../../ui", import.meta.url).pathname
const ADMIN_TOKEN = "cloudron-admin-token-0123456789"

const okStatus: TokenStatus = {
  checkedAt: "2026-10-29T00:00:00.000Z",
  ok: true,
  writable: true,
  cloudronVersion: "10.1.6",
  error: null,
}

let dataDir: string
let server: Server
let origin: string
let store: Store

async function start(
  options: { token?: TokenStatus | null; checkToken?: typeof checkToken } = {},
) {
  dataDir = mkdtempSync(join(tmpdir(), "mcp-cloudron-"))
  store = new Store(dataDir)
  if (options.token !== undefined && options.token !== null) {
    store.setToken(ADMIN_TOKEN, options.token)
  }
  const handler = createApp({
    store,
    cloudronOrigin: BASE_URL,
    appOrigin: "https://mcp.example.com",
    uiDir: UI_DIR,
    checkToken: options.checkToken ?? (async () => okStatus),
    roles: new RoleLookup(),
  })
  server = createServer((req, res) => void handler(req, res))
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  await new Promise(resolve => server?.close(resolve))
  rmSync(dataDir, { recursive: true, force: true })
})

/** Cloudron routes the app needs, plus a user list for the role lookup */
function cloudron(extra: Record<string, FakeHandler> = {}, role = "admin") {
  return useFakeCloudron({
    "GET /api/v1/users": {
      body: { users: [makeUser({ username: "matt", role: role as never })] },
    },
    "GET /api/v1/cloudron/status": { body: { version: "10.1.6" } },
    "GET /api/v1/system/info": { body: { info: { uptimeSecs: 100 } } },
    "GET /api/v1/updater/box_update": { body: { update: null } },
    ...extra,
  })
}

async function mcpClient(secret: string) {
  const client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${secret}` } },
    }),
  )
  return client
}

function asUser(username: string, extra: Record<string, string> = {}) {
  return { "X-Remote-User": username, ...extra }
}

const json = (res: Response): Promise<any> => res.json()

const mutate = {
  "X-Requested-With": "cloudron-mcp",
  "Content-Type": "application/json",
}

describe("health and UI", () => {
  beforeEach(() => start())

  it("answers /healthz without auth", async () => {
    const res = await fetch(`${origin}/healthz`)
    expect(res.status).toBe(200)
  })

  it("serves the UI with a strict CSP", async () => {
    const res = await fetch(`${origin}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("Cloudron MCP")
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    )
    expect((await fetch(`${origin}/app.js`)).status).toBe(200)
    expect((await fetch(`${origin}/../package.json`)).status).toBe(404)
  })
})

describe("MCP endpoint", () => {
  it("rejects requests without a valid client key", async () => {
    await start({ token: okStatus })
    // 403 rather than 401: Cloudron's nginx turns a 401 into a login redirect
    const none = await fetch(`${origin}/mcp`, { method: "POST", body: "{}" })
    expect(none.status).toBe(403)
    expect(none.headers.get("www-authenticate")).toContain("Bearer")

    const wrong = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer mcpc_notarealkey" },
      body: "{}",
    })
    expect(wrong.status).toBe(403)
  })

  it("serves MCP to a valid key and logs the call without secrets", async () => {
    await start({ token: okStatus })
    cloudron({
      "POST /api/v1/apps/app-1/configure/env": {
        status: 202,
        body: { taskId: "5" },
      },
      "GET /api/v1/apps/app-1": { body: makeApp() },
    })
    const { secret } = store.createKey("laptop", "write", "matt")
    const client = await mcpClient(secret)

    const tools = await client.listTools()
    expect(tools.tools).toHaveLength(toolsForAccessLevel("write").length)

    const status = await client.callTool({
      name: "cloudron_get_status",
      arguments: {},
    })
    expect(JSON.stringify(status.content)).toContain("10.1.6")

    await client.callTool({
      name: "cloudron_configure_app",
      arguments: { appId: "app-1", config: { env: { API_KEY: "hunter2" } } },
    })
    await client.close()

    const activity = store.listActivity()
    expect(activity.map(a => a.tool)).toEqual([
      "cloudron_configure_app",
      "cloudron_get_status",
    ])
    expect(activity[0]?.summary).toBe("appId=app-1")
    expect(JSON.stringify(activity)).not.toContain("hunter2")
    expect(store.listKeys()[0]?.lastUsedAt).not.toBeNull()
  })

  it.each([
    ["all", "write", "write"],
    ["write", "read", "read"],
    ["read", "all", "read"],
  ] as const)("a %s key under a %s maximum gets %s tools", async (keyAccess, maxAccess, expected) => {
    await start({ token: okStatus })
    store.setMaxAccess(maxAccess as AccessLevel)
    const { secret } = store.createKey("k", keyAccess as AccessLevel, "matt")
    const client = await mcpClient(secret)
    expect((await client.listTools()).tools).toHaveLength(
      toolsForAccessLevel(expected as AccessLevel).length,
    )
    await client.close()
  })

  it("limits every key to read when the Cloudron token is read-only", async () => {
    await start({ token: { ...okStatus, writable: false } })
    const { secret } = store.createKey("k", "all", "matt")
    store.setMaxAccess("all")
    const client = await mcpClient(secret)
    expect((await client.listTools()).tools).toHaveLength(
      toolsForAccessLevel("read").length,
    )
    const denied = await client.callTool({
      name: "cloudron_control_app",
      arguments: { appId: "app-1", action: "stop" },
    })
    expect(denied.isError).toBe(true)
    await client.close()
  })

  it("explains a missing Cloudron token instead of failing obscurely", async () => {
    await start()
    const { secret } = store.createKey("k", "read", "matt")
    const client = await mcpClient(secret)
    const result = await client.callTool({
      name: "cloudron_list_apps",
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("no Cloudron API token")
    await client.close()
  })

  it("refuses GET (stateless server, no SSE stream)", async () => {
    await start({ token: okStatus })
    const { secret } = store.createKey("k", "read", "matt")
    const res = await fetch(`${origin}/mcp`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(res.status).toBe(405)
  })
})

describe("settings API access", () => {
  it("requires the Cloudron login (X-Remote-User)", async () => {
    await start()
    expect((await fetch(`${origin}/api/state`)).status).toBe(401)
  })

  // nginx blanks X-Remote-User on bearer requests; the app refuses them anyway
  it("refuses bearer requests even with a forged X-Remote-User", async () => {
    await start({ token: okStatus })
    const { secret } = store.createKey("k", "all", "matt")
    const res = await fetch(`${origin}/api/state`, {
      headers: asUser("matt", { Authorization: `Bearer ${secret}` }),
    })
    expect(res.status).toBe(403)
  })

  it("lets anyone with app access set up the first token", async () => {
    await start()
    const res = await fetch(`${origin}/api/state`, {
      headers: asUser("someone"),
    })
    expect(res.status).toBe(200)
    expect((await json(res)).viewer.bootstrap).toBe(true)
  })

  it("lets Cloudron admins manage once a token is set", async () => {
    await start({ token: okStatus })
    const { fake } = cloudron({}, "admin")
    const res = await fetch(`${origin}/api/state`, { headers: asUser("matt") })
    expect(res.status).toBe(200)
    expect(fake.requests[0]?.query.get("search")).toBe("matt")
    expect(fake.requests[0]?.headers.authorization).toBe(
      `Bearer ${ADMIN_TOKEN}`,
    )
  })

  it("refuses ordinary Cloudron users once a token is set", async () => {
    await start({ token: okStatus })
    cloudron({}, "user")
    const res = await fetch(`${origin}/api/state`, { headers: asUser("matt") })
    expect(res.status).toBe(403)
    expect((await json(res)).error).toContain("owners and admins")
  })

  it("refuses rather than opens up when the role cannot be checked", async () => {
    await start({ token: okStatus })
    useFakeCloudron({
      "GET /api/v1/users": { status: 502, body: { message: "bad gateway" } },
    })
    const res = await fetch(`${origin}/api/state`, { headers: asUser("matt") })
    expect(res.status).toBe(503)
  })

  it("reopens setup when Cloudron rejects the stored token", async () => {
    await start({ token: okStatus })
    useFakeCloudron({
      "GET /api/v1/users": { status: 401, body: { message: "Invalid token" } },
    })
    const res = await fetch(`${origin}/api/state`, { headers: asUser("matt") })
    expect(res.status).toBe(200)
    expect((await json(res)).viewer.bootstrap).toBe(true)
  })

  it("requires the CSRF header on changes", async () => {
    await start()
    const res = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: asUser("matt", { "Content-Type": "application/json" }),
      body: JSON.stringify({ maxAccess: "all" }),
    })
    expect(res.status).toBe(403)
    expect(store.getSettings().maxAccess).toBe("write")
  })
})

describe("settings API actions", () => {
  it("saves a token only after Cloudron accepts it", async () => {
    const check = vi.fn<typeof checkToken>(async () => ({
      ...okStatus,
      ok: false,
      error: "Invalid token",
    }))
    await start({ checkToken: check })
    const res = await fetch(`${origin}/api/token`, {
      method: "PUT",
      headers: asUser("matt", mutate),
      body: JSON.stringify({ token: ADMIN_TOKEN }),
    })
    expect(res.status).toBe(400)
    expect(store.getSettings().cloudronToken).toBeNull()

    check.mockResolvedValueOnce(okStatus)
    cloudron()
    const ok = await fetch(`${origin}/api/token`, {
      method: "PUT",
      headers: asUser("matt", mutate),
      body: JSON.stringify({ token: ADMIN_TOKEN }),
    })
    expect(ok.status).toBe(200)
    const state = await json(ok)
    expect(state.settings.tokenConfigured).toBe(true)
    expect(JSON.stringify(state)).not.toContain(ADMIN_TOKEN)
  })

  it("sets the maximum access level", async () => {
    await start()
    const res = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: asUser("matt", mutate),
      body: JSON.stringify({ maxAccess: "all" }),
    })
    expect(res.status).toBe(200)
    expect(store.getSettings().maxAccess).toBe("all")

    const bad = await fetch(`${origin}/api/settings`, {
      method: "PUT",
      headers: asUser("matt", mutate),
      body: JSON.stringify({ maxAccess: "root" }),
    })
    expect(bad.status).toBe(400)
  })

  it("creates, changes and revokes client keys", async () => {
    await start()
    const created = await fetch(`${origin}/api/keys`, {
      method: "POST",
      headers: asUser("matt", mutate),
      body: JSON.stringify({ name: "laptop", access: "read" }),
    })
    expect(created.status).toBe(201)
    const { key, secret, state } = await json(created)
    expect(secret).toMatch(/^mcpc_/)
    expect(key.hash).toBeUndefined()
    expect(key.createdBy).toBe("matt")
    expect(JSON.stringify(state)).not.toContain(secret)
    expect(store.findKey(secret)?.id).toBe(key.id)

    const patched = await fetch(`${origin}/api/keys/${key.id}`, {
      method: "PATCH",
      headers: asUser("matt", mutate),
      body: JSON.stringify({ access: "all" }),
    })
    const patchedState = await json(patched)
    expect(patchedState.keys[0].access).toBe("all")
    expect(patchedState.keys[0].effectiveAccess).toBe("write")

    const revoked = await fetch(`${origin}/api/keys/${key.id}`, {
      method: "DELETE",
      headers: asUser("matt", mutate),
    })
    expect(revoked.status).toBe(200)
    expect(store.findKey(secret)).toBeUndefined()
  })
})

describe("Store", () => {
  it("persists keys and settings with private file permissions", async () => {
    await start()
    const { secret } = store.createKey("k", "write", "matt")
    store.setMaxAccess("read")

    const reopened = new Store(dataDir)
    expect(reopened.findKey(secret)?.name).toBe("k")
    expect(reopened.getSettings().maxAccess).toBe("read")
    expect(statSync(join(dataDir, "state.json")).mode & 0o777).toBe(0o600)
  })

  it("keeps the activity log bounded across restarts", async () => {
    await start()
    for (let i = 0; i < 520; i++) {
      store.recordActivity({
        at: "t",
        key: "k",
        tool: `t${i}`,
        ok: true,
        summary: "",
      })
    }
    const reopened = new Store(dataDir)
    const all = reopened.listActivity(1000)
    expect(all).toHaveLength(500)
    expect(all[0]?.tool).toBe("t519")
  })
})

describe("checkToken", () => {
  it.each([
    [400, true],
    [403, false],
  ])("POST /groups answering %i means writable=%s", async (status, writable) => {
    useFakeCloudron({
      "GET /api/v1/cloudron/status": { body: { version: "10.1.6" } },
      "GET /api/v1/system/info": { body: { info: {} } },
      "POST /api/v1/groups": { status, body: { message: "x" } },
    })
    const result = await checkToken(BASE_URL, ADMIN_TOKEN)
    expect(result).toMatchObject({
      ok: true,
      writable,
      cloudronVersion: "10.1.6",
    })
  })

  it("reports a rejected token", async () => {
    useFakeCloudron({
      "GET /api/v1/cloudron/status": { body: { version: "10.1.6" } },
      "GET /api/v1/system/info": {
        status: 401,
        body: { message: "Invalid token" },
      },
    })
    const result = await checkToken(BASE_URL, ADMIN_TOKEN)
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Invalid token")
  })
})
