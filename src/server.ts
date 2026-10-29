#!/usr/bin/env node
/**
 * Cloudron MCP Server
 * Provides tools for managing Cloudron instances via MCP protocol
 */

import { createRequire } from "node:module"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import { type CloudronContext, createCloudronContext } from "./client/index.js"
import { getAccessLevel } from "./config.js"
import {
  getFullPackagingGuide,
  PACKAGING_GUIDE_URI,
  RESOURCES,
} from "./resources/index.js"
import { toolsForAccessLevel } from "./tools/access.js"
import { callTool, validateToolHandlerAlignment } from "./tools/call.js"

const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string
}

// Catch tool↔handler mismatches at startup rather than on first call
validateToolHandlerAlignment()

const accessLevel = getAccessLevel()

const server = new Server(
  { name: "cloudron-mcp", version },
  { capabilities: { tools: {}, resources: {} } },
)

// Lazy-initialize context (validates env vars on first API tool call)
let ctx: CloudronContext | null = null
function getContext(): CloudronContext {
  ctx ??= createCloudronContext()
  return ctx
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolsForAccessLevel(accessLevel),
}))

server.setRequestHandler(CallToolRequestSchema, async request =>
  callTool(
    request.params.name,
    request.params.arguments,
    accessLevel,
    getContext,
  ),
)

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: RESOURCES,
}))

server.setRequestHandler(ReadResourceRequestSchema, async request => {
  const { uri } = request.params

  if (uri === PACKAGING_GUIDE_URI) {
    return {
      contents: [
        {
          uri: PACKAGING_GUIDE_URI,
          mimeType: "text/markdown",
          text: getFullPackagingGuide(),
        },
      ],
    }
  }

  throw new Error(`Unknown resource: ${uri}`)
})

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport())
  console.error(
    `Cloudron MCP server v${version} running on stdio (CLOUDRON_ACCESS=${accessLevel}, ${toolsForAccessLevel(accessLevel).length} tools)`,
  )
}

main().catch(error => {
  console.error("Fatal error:", error)
  process.exit(1)
})
