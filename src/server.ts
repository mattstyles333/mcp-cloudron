#!/usr/bin/env node
/**
 * Cloudron MCP Server (stdio)
 * For local MCP clients; the Cloudron app uses src/http/main.ts instead.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

import { type CloudronContext, createCloudronContext } from "./client/index.js"
import { getAccessLevel } from "./config.js"
import { createMcpServer, VERSION } from "./mcp-server.js"
import { toolsForAccessLevel } from "./tools/access.js"
import { validateToolHandlerAlignment } from "./tools/call.js"

// Catch tool↔handler mismatches at startup rather than on first call
validateToolHandlerAlignment()

const accessLevel = getAccessLevel()

// Lazy-initialize context (validates env vars on first API tool call)
let ctx: CloudronContext | null = null

const server = createMcpServer({
  accessLevel,
  getContext: () => {
    ctx ??= createCloudronContext()
    return ctx
  },
})

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport())
  console.error(
    `Cloudron MCP server v${VERSION} running on stdio (CLOUDRON_ACCESS=${accessLevel}, ${toolsForAccessLevel(accessLevel).length} tools)`,
  )
}

main().catch(error => {
  console.error("Fatal error:", error)
  process.exit(1)
})
