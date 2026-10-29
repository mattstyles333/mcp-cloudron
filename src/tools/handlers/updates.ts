/**
 * Platform update tool handlers
 */

import { formatAsyncTaskResponse, formatBoxUpdate } from "../formatters.js"
import type { ToolRegistry } from "../registry.js"
import { textResponse } from "../response.js"
import { parseApplyUpdateArgs } from "../validators.js"

export const updateHandlers: ToolRegistry = {
  cloudron_check_updates: async (_args, ctx) => {
    const update = await ctx.updates.checkUpdates()
    return textResponse(formatBoxUpdate(update))
  },

  cloudron_apply_update: async (args, ctx) => {
    const { version } = parseApplyUpdateArgs(args)
    const taskId = await ctx.updates.applyUpdate(version)

    return textResponse(
      formatAsyncTaskResponse(
        `Cloudron platform update to v${version}`,
        taskId,
        "⚠️  Cloudron backs up, then restarts; apps are unavailable for several minutes.",
      ),
    )
  },
}
