/**
 * Backup-related tool handlers
 */

import {
  formatAsyncTaskResponse,
  formatBackup,
  formatBackupSite,
} from "../formatters.js"
import type { ToolRegistry } from "../registry.js"
import { textResponse } from "../response.js"
import { parseBackupSiteArgs } from "../validators.js"

export const backupHandlers: ToolRegistry = {
  cloudron_list_backups: async (_args, ctx) => {
    const backups = await ctx.backups.listBackups()
    if (backups.length === 0) {
      return textResponse("No full-instance backups found.")
    }
    const formatted = backups.map(formatBackup).join("\n\n")
    return textResponse(
      `Found ${backups.length} full backup(s), newest first:\n\n${formatted}`,
    )
  },

  cloudron_list_backup_sites: async (_args, ctx) => {
    const sites = await ctx.backups.listBackupSites()
    if (sites.length === 0) {
      return textResponse("No backup sites are configured.")
    }
    return textResponse(
      `Found ${sites.length} backup site(s):\n\n${sites.map(formatBackupSite).join("\n\n")}`,
    )
  },

  cloudron_create_backup: async (args, ctx) => {
    const { backupSiteId } = parseBackupSiteArgs(args)
    const { taskId, site } = await ctx.backups.createBackup(backupSiteId)
    return textResponse(
      formatAsyncTaskResponse(
        "Full backup",
        taskId,
        `Backup site: ${site.name} (${site.id})`,
      ),
    )
  },
}
