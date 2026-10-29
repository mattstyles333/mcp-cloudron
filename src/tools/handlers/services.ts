/**
 * Platform service tool handlers
 */

import { formatServiceList } from "../formatters.js"
import type { ToolRegistry } from "../registry.js"
import { textResponse } from "../response.js"
import { parseServiceIdArgs } from "../validators.js"

export const serviceHandlers: ToolRegistry = {
  cloudron_list_services: async (_args, ctx) => {
    const services = await ctx.system.listServices()
    return textResponse(formatServiceList(services))
  },

  cloudron_restart_service: async (args, ctx) => {
    const { serviceId } = parseServiceIdArgs(args)
    await ctx.system.restartService(serviceId)
    return textResponse(
      `Restart of service ${serviceId} requested. Check it with cloudron_list_services in a few seconds.`,
    )
  },
}
