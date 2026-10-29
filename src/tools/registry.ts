/**
 * Tool Handler Registry
 *
 * Maps tool names to their handler functions.
 */

import type { CloudronContext } from "../client/index.js"
import type { MCPToolResponse } from "./response.js"

/**
 * Handler for a tool that talks to the Cloudron API
 */
export type ToolHandler = (
  args: unknown,
  ctx: CloudronContext,
) => Promise<MCPToolResponse>

/**
 * Handler for a tool that needs no Cloudron credentials (packaging helpers)
 */
export type OfflineToolHandler = (args: unknown) => Promise<MCPToolResponse>

export type ToolRegistry = Record<string, ToolHandler>

export type OfflineToolRegistry = Record<string, OfflineToolHandler>

/**
 * Create a combined registry from multiple handler modules
 */
export function createRegistry<T>(
  ...registries: Record<string, T>[]
): Record<string, T> {
  return Object.assign({}, ...registries)
}
