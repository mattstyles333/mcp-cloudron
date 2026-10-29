/**
 * Log retrieval tool handlers
 */

import type { ToolRegistry } from "../registry.js"
import { textResponse } from "../response.js"
import { parseGetLogsArgs } from "../validators.js"

const LOG_LABELS = { app: "App", service: "Service", task: "Task" } as const

export const logHandlers: ToolRegistry = {
  cloudron_get_logs: async (args, ctx) => {
    const { resourceId, type, lines } = parseGetLogsArgs(args)
    const logEntries = await ctx.logs.getLogs(resourceId, type, lines)

    const formattedLogs = logEntries
      .map(entry => `[${entry.timestamp}] [${entry.severity}] ${entry.message}`)
      .join("\n")

    return textResponse(
      `${LOG_LABELS[type]} logs for ${resourceId} (${logEntries.length} entries):\n\n${formattedLogs}`,
    )
  },
}
