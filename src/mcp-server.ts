/**
 * MCP server factory shared by the stdio entry point and the HTTP app
 */

import { createRequire } from "node:module"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import type { CloudronContext } from "./client/index.js"
import type { AccessLevel } from "./config.js"
import {
  getFullPackagingGuide,
  PACKAGING_GUIDE_URI,
  RESOURCES,
} from "./resources/index.js"
import { toolsForAccessLevel } from "./tools/access.js"
import { callTool } from "./tools/call.js"
import type { MCPToolResponse } from "./tools/response.js"

export const VERSION: string = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version

export interface McpServerOptions {
  accessLevel: AccessLevel
  getContext: () => CloudronContext
  /** Called after every tool call (used by the HTTP app's activity log) */
  onToolCall?: (name: string, args: unknown, response: MCPToolResponse) => void
}

export function createMcpServer(options: McpServerOptions): Server {
  const { accessLevel, getContext, onToolCall } = options

  const server = new Server(
    { name: "cloudron-mcp", version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsForAccessLevel(accessLevel),
  }))

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { name, arguments: args } = request.params
    const response = await callTool(name, args, accessLevel, getContext)
    onToolCall?.(name, args, response)
    return response
  })

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

  return server
}
