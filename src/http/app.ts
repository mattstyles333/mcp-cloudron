/**
 * HTTP app: MCP endpoint for clients, settings API and UI for admins.
 *
 * Behind Cloudron's proxyAuth addon (with supportsBearerAuth):
 * - Requests with "Authorization: Bearer ..." skip the login wall and reach
 *   /mcp, where the bearer must be a client key created in the UI.
 * - Every other request passes the login wall first; nginx then sets
 *   X-Remote-User to the signed-in user, and to an empty value on bearer
 *   requests, so clients cannot forge it.
 */

import { readFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { join } from "node:path"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"

import { createCloudronContextFromHttp } from "../client/context.js"
import { HttpClient } from "../client/http-client.js"
import { ACCESS_LEVELS, type AccessLevel } from "../config.js"
import { isCloudronError } from "../errors.js"
import { createMcpServer, VERSION } from "../mcp-server.js"
import { toolsForAccessLevel } from "../tools/access.js"
import type { MCPToolResponse } from "../tools/response.js"
import { checkToken, RoleLookup } from "./cloudron-checks.js"
import { type ClientKey, minAccess, type Store } from "./store.js"

const MAX_BODY_BYTES = 1024 * 1024
const MANAGER_ROLES = new Set(["owner", "admin"])

/** Argument names safe to show in the activity log (no env, passwords...) */
const LOGGED_ARGS = [
  "appId",
  "action",
  "userId",
  "taskId",
  "resourceId",
  "type",
  "serviceId",
  "backupId",
  "backupSiteId",
  "notificationId",
  "appStoreId",
  "subdomain",
  "domain",
  "operation",
  "version",
  "query",
  "name",
]

export interface AppOptions {
  store: Store
  /** Cloudron dashboard/API origin, e.g. https://my.example.com */
  cloudronOrigin: string
  /** Public origin of this app, used to show the MCP URL */
  appOrigin: string
  uiDir: string
  /** Replaceable for tests */
  checkToken?: typeof checkToken
  roles?: RoleLookup
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES)
      throw new HttpError(413, "Request body too large")
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, "Request body is not valid JSON")
  }
}

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name]
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? ""
}

function bearerToken(req: IncomingMessage): string | null {
  const match = header(req, "authorization").match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function parseAccess(value: unknown, field: string): AccessLevel {
  const level = ACCESS_LEVELS.find(l => l === value)
  if (!level) {
    throw new HttpError(
      400,
      `${field} must be one of ${ACCESS_LEVELS.join(", ")}`,
    )
  }
  return level
}

function summarize(args: unknown, response: MCPToolResponse): string {
  if (response.isError) {
    return (response.content[0]?.text ?? "error").slice(0, 200)
  }
  if (!args || typeof args !== "object") return ""
  return LOGGED_ARGS.filter(k => k in args)
    .map(
      k => `${k}=${String((args as Record<string, unknown>)[k]).slice(0, 60)}`,
    )
    .join(" ")
}

function publicKey(key: ClientKey) {
  const { hash: _hash, ...rest } = key
  return rest
}

export function createApp(options: AppOptions) {
  const { store, cloudronOrigin, appOrigin } = options
  const runTokenCheck = options.checkToken ?? checkToken
  const roles = options.roles ?? new RoleLookup()

  const uiFiles: Record<string, { type: string; body: Buffer }> = {}
  for (const [file, type] of [
    ["index.html", "text/html; charset=utf-8"],
    ["app.js", "text/javascript; charset=utf-8"],
    ["style.css", "text/css; charset=utf-8"],
    ["logo.svg", "image/svg+xml"],
  ] as const) {
    uiFiles[`/${file}`] = {
      type,
      body: readFileSync(join(options.uiDir, file)),
    }
  }

  /**
   * Access level for a client key: the lower of the key's level and the
   * server maximum, and read when the Cloudron token itself is read-only
   */
  function effectiveAccess(key: ClientKey): AccessLevel {
    const { maxAccess, tokenStatus } = store.getSettings()
    const level = minAccess(key.access, maxAccess)
    return tokenStatus?.writable === false ? "read" : level
  }

  // ==================== MCP endpoint ====================

  async function handleMcp(req: IncomingMessage, res: ServerResponse) {
    const secret = bearerToken(req)
    const key = secret ? store.findKey(secret) : undefined
    if (!key) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="cloudron-mcp"')
      sendJson(res, 401, {
        jsonrpc: "2.0",
        error: {
          code: -32001,
          message:
            "Missing or unknown client key. Create one in the Cloudron MCP app settings and send it as 'Authorization: Bearer <key>'.",
        },
        id: null,
      })
      return
    }

    if (req.method !== "POST") {
      // Stateless server: no SSE stream or session to resume or delete
      res.setHeader("Allow", "POST")
      sendJson(res, 405, {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed" },
        id: null,
      })
      return
    }

    store.touchKey(key)
    const body = await readJson(req)
    const { cloudronToken } = store.getSettings()

    const server = createMcpServer({
      accessLevel: effectiveAccess(key),
      getContext: () => {
        if (!cloudronToken) {
          throw new Error(
            "This Cloudron MCP app has no Cloudron API token yet. An admin must add one in the app's settings page.",
          )
        }
        return createCloudronContextFromHttp(
          new HttpClient({ baseUrl: cloudronOrigin, token: cloudronToken }),
        )
      },
      onToolCall: (name, args, response) => {
        store.recordActivity({
          at: new Date().toISOString(),
          key: key.name,
          tool: name,
          ok: !response.isError,
          summary: summarize(args, response),
        })
      },
    })
    // No sessionIdGenerator: stateless mode, one server per request
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    })
    res.on("close", () => {
      void transport.close()
      void server.close()
    })
    // The SDK's transport type predates exactOptionalPropertyTypes
    await server.connect(transport as Transport)
    await transport.handleRequest(req, res, body)
  }

  // ==================== Admin API ====================

  /**
   * Who is signed in, and may they manage the app? Until a token is
   * configured anyone Cloudron lets into the app may set it up.
   */
  async function viewer(req: IncomingMessage) {
    if (bearerToken(req)) {
      throw new HttpError(401, "Client keys cannot use the settings API")
    }
    const username = header(req, "x-remote-user")
    if (!username) {
      throw new HttpError(401, "Not signed in through Cloudron")
    }

    const { cloudronToken } = store.getSettings()
    if (!cloudronToken) {
      return { username, role: null, canManage: true, bootstrap: true }
    }
    let role = null
    try {
      role = await roles.roleOf(cloudronOrigin, cloudronToken, username)
    } catch (error) {
      // Only a token Cloudron rejects reopens setup, so it can be replaced.
      // That cannot escalate anyone: a replacement token only carries its
      // owner's own rights. Any other failure must not grant access.
      if (
        isCloudronError(error) &&
        (error.statusCode === 401 || error.statusCode === 403)
      ) {
        return { username, role: null, canManage: true, bootstrap: true }
      }
      throw new HttpError(
        503,
        "Cannot check your Cloudron role right now; try again shortly.",
      )
    }
    return {
      username,
      role,
      canManage: role !== null && MANAGER_ROLES.has(role),
      bootstrap: false,
    }
  }

  function requireCsrfHeader(req: IncomingMessage) {
    // A custom header cannot be sent cross-site without a CORS preflight,
    // which this app never grants
    if (header(req, "x-requested-with") !== "cloudron-mcp") {
      throw new HttpError(403, "Missing X-Requested-With header")
    }
  }

  function state(who: Awaited<ReturnType<typeof viewer>>) {
    const settings = store.getSettings()
    return {
      version: VERSION,
      cloudronOrigin,
      mcpUrl: `${appOrigin}/mcp`,
      viewer: who,
      settings: {
        maxAccess: settings.maxAccess,
        tokenConfigured: Boolean(settings.cloudronToken),
        tokenStatus: settings.tokenStatus,
      },
      toolCounts: Object.fromEntries(
        ACCESS_LEVELS.map(level => [level, toolsForAccessLevel(level).length]),
      ),
      keys: store.listKeys().map(k => ({
        ...publicKey(k),
        effectiveAccess: effectiveAccess(k),
      })),
      activity: store.listActivity(100),
    }
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
  ) {
    const who = await viewer(req)
    if (!who.canManage) {
      throw new HttpError(
        403,
        `Only Cloudron owners and admins can manage this app (you are ${who.role ?? "not a known user"}).`,
      )
    }

    const method = req.method ?? "GET"
    if (method !== "GET") requireCsrfHeader(req)

    if (method === "GET" && path === "/api/state") {
      return sendJson(res, 200, state(who))
    }

    if (method === "PUT" && path === "/api/settings") {
      const body = (await readJson(req)) as { maxAccess?: unknown }
      store.setMaxAccess(parseAccess(body.maxAccess, "maxAccess"))
      return sendJson(res, 200, state(who))
    }

    if (method === "PUT" && path === "/api/token") {
      const body = (await readJson(req)) as { token?: unknown }
      if (typeof body.token !== "string" || body.token.trim().length < 16) {
        throw new HttpError(400, "token must be a Cloudron API token")
      }
      const token = body.token.trim()
      const status = await runTokenCheck(cloudronOrigin, token)
      if (!status.ok) {
        throw new HttpError(
          400,
          `Cloudron rejected the token: ${status.error ?? "unknown error"}. Nothing was saved.`,
        )
      }
      store.setToken(token, status)
      roles.clear()
      return sendJson(res, 200, state(await viewer(req)))
    }

    if (method === "POST" && path === "/api/token/check") {
      const { cloudronToken } = store.getSettings()
      if (!cloudronToken) throw new HttpError(400, "No token configured")
      store.setTokenStatus(await runTokenCheck(cloudronOrigin, cloudronToken))
      return sendJson(res, 200, state(who))
    }

    if (method === "DELETE" && path === "/api/token") {
      store.setToken(null, null)
      roles.clear()
      return sendJson(res, 200, state(who))
    }

    if (method === "POST" && path === "/api/keys") {
      const body = (await readJson(req)) as { name?: unknown; access?: unknown }
      const name = typeof body.name === "string" ? body.name.trim() : ""
      if (!name || name.length > 60) {
        throw new HttpError(400, "name must be 1 to 60 characters")
      }
      const { key, secret } = store.createKey(
        name,
        parseAccess(body.access, "access"),
        who.username,
      )
      return sendJson(res, 201, {
        key: publicKey(key),
        secret,
        state: state(who),
      })
    }

    const keyMatch = path.match(/^\/api\/keys\/([0-9a-f-]{36})$/)
    if (keyMatch?.[1] && method === "PATCH") {
      const body = (await readJson(req)) as { access?: unknown }
      const key = store.updateKeyAccess(
        keyMatch[1],
        parseAccess(body.access, "access"),
      )
      if (!key) throw new HttpError(404, "No such key")
      return sendJson(res, 200, state(who))
    }
    if (keyMatch?.[1] && method === "DELETE") {
      if (!store.revokeKey(keyMatch[1])) throw new HttpError(404, "No such key")
      return sendJson(res, 200, state(who))
    }

    throw new HttpError(404, "Not found")
  }

  // ==================== Static UI ====================

  function serveUi(res: ServerResponse, path: string): boolean {
    const file = uiFiles[path === "/" ? "/index.html" : path]
    if (!file) return false
    res.writeHead(200, {
      "Content-Type": file.type,
      "Cache-Control": "no-cache",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    })
    res.end(file.body)
    return true
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? "/", "http://localhost").pathname
    try {
      if (path === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain" })
        res.end("ok")
        return
      }
      if (path === "/mcp") return await handleMcp(req, res)
      if (path.startsWith("/api/")) return await handleApi(req, res, path)
      if (req.method === "GET" && serveUi(res, path)) return
      throw new HttpError(404, "Not found")
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message })
        return
      }
      console.error("Unhandled error:", error)
      sendJson(res, 500, { error: "Internal error" })
    }
  }
}
