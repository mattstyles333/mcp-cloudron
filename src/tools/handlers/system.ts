/**
 * System-related tool handlers
 */

import {
  formatEvent,
  formatNotification,
  formatStorageInfo,
  formatTaskStatus,
  formatValidationResult,
} from "../formatters.js"
import type { ToolRegistry } from "../registry.js"
import { textResponse } from "../response.js"
import {
  parseCheckStorageArgs,
  parseEventLogArgs,
  parseNotificationIdArgs,
  parseNotificationsArgs,
  parseTaskIdArgs,
  parseValidateOperationArgs,
} from "../validators.js"

function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined) return "N/A"
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`
}

export const systemHandlers: ToolRegistry = {
  cloudron_get_status: async (_args, ctx) => {
    const [status, info, update] = await Promise.all([
      ctx.system.getStatus(),
      ctx.system.getInfo(),
      ctx.updates.checkUpdates(),
    ])
    const server = [info.sysVendor, info.productName].filter(Boolean).join(" ")

    return textResponse(`Cloudron Status:
  Version: ${status.version}
  Server: ${server || "N/A"}
  Uptime: ${formatUptime(info.uptimeSecs)}
  Reboot required: ${info.rebootRequired ? "yes" : "no"}
  Platform update: ${update ? `v${update.version} available` : "none pending"}`)
  },

  cloudron_task_status: async (args, ctx) => {
    const { taskId } = parseTaskIdArgs(args)
    const taskStatus = await ctx.tasks.getTaskStatus(taskId)
    return textResponse(formatTaskStatus(taskStatus))
  },

  cloudron_cancel_task: async (args, ctx) => {
    const { taskId } = parseTaskIdArgs(args)
    const taskStatus = await ctx.tasks.cancelTask(taskId)
    return textResponse(
      `Stop requested for task ${taskId}.\n\n${formatTaskStatus(taskStatus)}`,
    )
  },

  cloudron_check_storage: async (args, ctx) => {
    const { requiredMB } = parseCheckStorageArgs(args)
    const storageInfo = await ctx.system.checkStorage(requiredMB)
    return textResponse(formatStorageInfo(storageInfo, requiredMB))
  },

  cloudron_validate_operation: async (args, ctx) => {
    const { operation, resourceId, backupId } = parseValidateOperationArgs(args)
    const validationResult = await ctx.validation.validateOperation(
      operation,
      resourceId,
      backupId,
    )
    return textResponse(
      formatValidationResult(operation, resourceId, validationResult),
    )
  },

  cloudron_list_eventlog: async (args, ctx) => {
    const filter = parseEventLogArgs(args)
    const events = await ctx.events.listEventLog(filter)
    if (events.length === 0) return textResponse("No matching events.")
    return textResponse(
      `${events.length} event(s), newest first:\n\n${events.map(formatEvent).join("\n\n")}`,
    )
  },

  cloudron_list_notifications: async (args, ctx) => {
    const { acknowledged, limit } = parseNotificationsArgs(args)
    const notifications = await ctx.events.listNotifications(
      acknowledged,
      limit,
    )
    if (notifications.length === 0) return textResponse("No notifications.")
    return textResponse(
      `${notifications.length} notification(s), newest first:\n\n${notifications.map(formatNotification).join("\n\n")}`,
    )
  },

  cloudron_acknowledge_notification: async (args, ctx) => {
    const { notificationId } = parseNotificationIdArgs(args)
    await ctx.events.acknowledgeNotification(notificationId)
    return textResponse(`Notification ${notificationId} acknowledged.`)
  },
}
