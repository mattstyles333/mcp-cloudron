/**
 * Access control: which tools a CLOUDRON_ACCESS level exposes.
 * Derived from each tool's MCP annotations so there is one source of truth.
 */

import type { AccessLevel } from "../config.js"
import { TOOLS, type ToolDefinition } from "./definitions.js"

export type ToolAccess = "read" | "write" | "destructive"

export function toolAccess(tool: ToolDefinition): ToolAccess {
  if (tool.annotations.readOnlyHint) return "read"
  return tool.annotations.destructiveHint ? "destructive" : "write"
}

const ALLOWED: Record<AccessLevel, readonly ToolAccess[]> = {
  read: ["read"],
  write: ["read", "write"],
  all: ["read", "write", "destructive"],
}

export function isToolAllowed(
  tool: ToolDefinition,
  level: AccessLevel,
): boolean {
  return ALLOWED[level].includes(toolAccess(tool))
}

export function toolsForAccessLevel(level: AccessLevel): ToolDefinition[] {
  return TOOLS.filter(tool => isToolAllowed(tool, level))
}

/**
 * Error text for a call to a tool the current level hides
 */
export function accessDeniedMessage(
  tool: ToolDefinition,
  level: AccessLevel,
): string {
  const needed = toolAccess(tool) === "destructive" ? "all" : "write"
  return `${tool.name} is disabled: this connection has '${level}' access and the tool needs '${needed}'. To allow it, raise the client key's level in the Cloudron MCP app (or CLOUDRON_ACCESS for a local server); writes also need a read-write Cloudron API token.`
}
