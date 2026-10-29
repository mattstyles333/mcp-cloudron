/**
 * App-related tool handlers
 */

import {
  formatApp,
  formatAppDetails,
  formatAsyncTaskResponse,
  formatBackup,
  formatBytes,
} from "../formatters.js"
import type { ToolRegistry } from "../registry.js"
import { textResponse } from "../response.js"
import {
  parseAppIdArgs,
  parseBackupAppArgs,
  parseCloneAppArgs,
  parseConfigureAppArgs,
  parseControlAppArgs,
  parseInstallAppArgs,
  parseRestoreAppArgs,
  parseUninstallAppArgs,
  parseUpdateAppArgs,
  requireConfirmation,
} from "../validators.js"

export const appHandlers: ToolRegistry = {
  cloudron_list_apps: async (_args, ctx) => {
    const apps = await ctx.apps.listApps()
    if (apps.length === 0) return textResponse("No apps installed.")
    const formatted = apps.map(formatApp).join("\n\n")
    return textResponse(`Found ${apps.length} apps:\n\n${formatted}`)
  },

  cloudron_get_app: async (args, ctx) => {
    const { appId } = parseAppIdArgs(args)
    const app = await ctx.apps.getApp(appId)
    return textResponse(formatAppDetails(app))
  },

  cloudron_control_app: async (args, ctx) => {
    const { appId, action } = parseControlAppArgs(args)
    const operations = {
      start: () => ctx.apps.startApp(appId),
      stop: () => ctx.apps.stopApp(appId),
      restart: () => ctx.apps.restartApp(appId),
    }
    const { taskId } = await operations[action]()
    return textResponse(formatAsyncTaskResponse(`App ${action}`, taskId))
  },

  cloudron_configure_app: async (args, ctx) => {
    const { appId, config } = parseConfigureAppArgs(args)
    const results = await ctx.apps.configureApp(appId, config)

    const lines = results.map(({ setting, taskId }) => {
      let detail = ""
      if (setting === "env" && config.env) {
        const removed = Object.values(config.env).filter(v => v === null).length
        detail = ` (${Object.keys(config.env).length - removed} set, ${removed} removed)`
      } else if (setting === "memoryLimit") {
        detail = ` (${config.memoryLimit ? formatBytes(config.memoryLimit) : "app default"})`
      }
      return `  - ${setting}${detail}${taskId ? `: task ${taskId}` : ": applied"}`
    })
    const tasks = results.filter(r => r.taskId)

    return textResponse(`App ${appId} configuration updated:
${lines.join("\n")}${
  tasks.length
    ? "\n\nSettings with a task restart the app; track them with cloudron_task_status."
    : ""
}`)
  },

  cloudron_uninstall_app: async (args, ctx) => {
    const { appId, confirm } = parseUninstallAppArgs(args)
    const app = await ctx.apps.getApp(appId)
    requireConfirmation(confirm, app.fqdn, "the app's fqdn")

    const { taskId } = await ctx.apps.uninstallApp(appId)
    return textResponse(
      formatAsyncTaskResponse(
        `Uninstall of ${app.fqdn}`,
        taskId,
        "The app and its data will be removed when the task completes. Its backups are kept.",
      ),
    )
  },

  cloudron_install_app: async (args, ctx) => {
    const { memoryLimit, ...params } = parseInstallAppArgs(args)
    const { id, taskId } = await ctx.apps.installApp({
      ...params,
      ...(memoryLimit !== undefined && { memoryLimit }),
    })
    const location = params.subdomain
      ? `${params.subdomain}.${params.domain}`
      : params.domain

    return textResponse(
      formatAsyncTaskResponse(
        `Installation of ${params.appStoreId}`,
        taskId,
        `App ID: ${id}\nLocation: ${location}`,
      ),
    )
  },

  cloudron_clone_app: async (args, ctx) => {
    const { appId, ...options } = parseCloneAppArgs(args)
    const { id, taskId, backupId } = await ctx.apps.cloneApp(appId, options)

    return textResponse(
      formatAsyncTaskResponse(
        `Clone of ${appId}`,
        taskId,
        `New app ID: ${id}\nCloned from backup: ${backupId}`,
      ),
    )
  },

  cloudron_repair_app: async (args, ctx) => {
    const { appId } = parseAppIdArgs(args)
    const taskId = await ctx.apps.repairApp(appId)
    return textResponse(formatAsyncTaskResponse(`Repair of ${appId}`, taskId))
  },

  cloudron_restore_app: async (args, ctx) => {
    const { appId, backupId, confirm } = parseRestoreAppArgs(args)
    const app = await ctx.apps.getApp(appId)
    requireConfirmation(confirm, app.fqdn, "the app's fqdn")

    const taskId = await ctx.apps.restoreApp(appId, backupId)
    return textResponse(
      formatAsyncTaskResponse(
        `Restore of ${app.fqdn}`,
        taskId,
        `Restoring from backup: ${backupId}. Current app data is being replaced.`,
      ),
    )
  },

  cloudron_update_app: async (args, ctx) => {
    const { appId, ...options } = parseUpdateAppArgs(args)
    const { taskId, target } = await ctx.apps.updateApp(appId, options)
    return textResponse(
      formatAsyncTaskResponse(
        `Update of ${appId} to ${target}`,
        taskId,
        "Cloudron backs the app up before updating.",
      ),
    )
  },

  cloudron_backup_app: async (args, ctx) => {
    const { appId, backupSiteId } = parseBackupAppArgs(args)
    const { taskId, site } = await ctx.apps.backupApp(appId, backupSiteId)
    return textResponse(
      formatAsyncTaskResponse(
        `Backup of ${appId}`,
        taskId,
        `Backup site: ${site.name} (${site.id})`,
      ),
    )
  },

  cloudron_list_app_backups: async (args, ctx) => {
    const { appId } = parseAppIdArgs(args)
    const backups = await ctx.apps.listAppBackups(appId)
    if (backups.length === 0) {
      return textResponse(`App ${appId} has no backups.`)
    }
    const formatted = backups.map(formatBackup).join("\n\n")
    return textResponse(
      `Found ${backups.length} backup(s) of ${appId}, newest first:\n\n${formatted}`,
    )
  },
}
