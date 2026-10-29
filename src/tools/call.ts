/**
 * Tool dispatch: access check, then the matching handler
 */

import type { CloudronContext } from "../client/index.js"
import type { AccessLevel } from "../config.js"
import { isCloudronError } from "../errors.js"
import { accessDeniedMessage, isToolAllowed } from "./access.js"
import { TOOLS } from "./definitions.js"
import { apiHandlers, offlineHandlers } from "./handlers/index.js"
import { errorResponse, type MCPToolResponse } from "./response.js"

/**
 * Every defined tool must have exactly one handler, and every handler a definition
 */
export function validateToolHandlerAlignment(): void {
  const defined = new Set(TOOLS.map(t => t.name))
  const handled = [...Object.keys(apiHandlers), ...Object.keys(offlineHandlers)]
  const missing = [...defined].filter(name => !handled.includes(name))
  const orphaned = handled.filter(name => !defined.has(name))
  if (missing.length > 0 || orphaned.length > 0) {
    throw new Error(
      `Tool↔Handler mismatch. Without handler: ${missing.join(", ") || "none"}. Without definition: ${orphaned.join(", ") || "none"}`,
    )
  }
}

/**
 * Run one tool call. Errors become MCP error responses rather than protocol
 * failures. The context is only built for tools that call the API, so the
 * packaging helpers work without credentials.
 */
export async function callTool(
  name: string,
  args: unknown,
  accessLevel: AccessLevel,
  getContext: () => CloudronContext,
): Promise<MCPToolResponse> {
  const tool = TOOLS.find(t => t.name === name)
  if (!tool) {
    return errorResponse(`Unknown tool: ${name}`)
  }
  if (!isToolAllowed(tool, accessLevel)) {
    return errorResponse(accessDeniedMessage(tool, accessLevel))
  }

  try {
    const offline = offlineHandlers[name]
    if (offline) {
      return await offline(args ?? {})
    }
    const handler = apiHandlers[name]
    if (!handler) {
      return errorResponse(`Unknown tool: ${name}`)
    }
    return await handler(args ?? {}, getContext())
  } catch (error) {
    const message = isCloudronError(error)
      ? `Cloudron API Error: ${error.message}${error.statusCode ? ` [HTTP ${error.statusCode}]` : ""}`
      : error instanceof Error
        ? error.message
        : "Unknown error occurred"
    return errorResponse(message)
  }
}
