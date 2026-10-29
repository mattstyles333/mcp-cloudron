/**
 * Formatters for MCP tool responses
 *
 * Functions to format Cloudron data types into human-readable strings.
 */

import type {
  AccessRestriction,
  App,
  AppStoreApp,
  Backup,
  BackupSite,
  BoxUpdateInfo,
  Domain,
  EventLogEntry,
  Group,
  Notification,
  Service,
  StorageInfo,
  TaskStatus,
  User,
  ValidationResult,
} from "../types.js"

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) {
    return "N/A"
  }
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function formatAccessRestriction(
  restriction: AccessRestriction | null | undefined,
): string {
  if (!restriction) return "all Cloudron users"
  const users = restriction.users ?? []
  const groups = restriction.groups ?? []
  if (users.length === 0 && groups.length === 0)
    return "nobody (no users or groups)"
  const parts = []
  if (users.length) parts.push(`users: ${users.join(", ")}`)
  if (groups.length) parts.push(`groups: ${groups.join(", ")}`)
  return parts.join("; ")
}

function pendingAppUpdate(app: App): string | null {
  if (!app.updateInfo) return null
  return app.updateInfo.manifest?.version ?? "available"
}

/**
 * One-paragraph app summary for lists
 */
export function formatApp(app: App): string {
  const title = app.label || app.manifest.title
  const update = pendingAppUpdate(app)
  let text = `${title} (${app.fqdn})
  ID: ${app.id}
  Version: ${app.manifest.version}
  State: ${app.installationState}, ${app.runState}
  Health: ${app.health ?? "unknown"}`
  if (update) text += `\n  Update available: ${update}`
  if (app.error?.message) text += `\n  Error: ${app.error.message}`
  return text
}

/**
 * Detailed app view. Environment values are masked: they often hold secrets.
 */
export function formatAppDetails(app: App): string {
  const lines = [
    formatApp(app),
    `  App Store ID: ${app.appStoreId || "(custom app)"}`,
    `  Subdomain: ${app.subdomain || "(bare domain)"}  Domain: ${app.domain}`,
    `  Memory limit: ${app.memoryLimit ? formatBytes(app.memoryLimit) : "app default"}`,
    `  Access: ${formatAccessRestriction(app.accessRestriction)}`,
  ]
  if (app.enableBackup !== undefined) {
    lines.push(`  Automatic backup: ${app.enableBackup ? "on" : "off"}`)
  }
  if (app.enableAutomaticUpdate !== undefined) {
    lines.push(
      `  Automatic update: ${app.enableAutomaticUpdate ? "on" : "off"}`,
    )
  }
  if (app.tags?.length) lines.push(`  Tags: ${app.tags.join(", ")}`)
  if (app.portBindings && Object.keys(app.portBindings).length) {
    lines.push(`  Ports: ${JSON.stringify(app.portBindings)}`)
  }
  const envKeys = Object.keys(app.env ?? {})
  if (envKeys.length) {
    lines.push(`  Env vars (values hidden): ${envKeys.join(", ")}`)
  }
  if (app.taskId) lines.push(`  Active task: ${app.taskId}`)
  if (app.creationTime) lines.push(`  Installed: ${app.creationTime}`)
  return lines.join("\n")
}

export function formatAppStoreApp(app: AppStoreApp, index: number): string {
  const { manifest } = app
  let text = `${index + 1}. ${manifest.title} (${app.id})
  Version: ${manifest.version}`
  if (manifest.tagline) text += `\n  ${manifest.tagline}`
  if (manifest.tags?.length) text += `\n  Tags: ${manifest.tags.join(", ")}`
  if (manifest.website) text += `\n  Website: ${manifest.website}`
  return text
}

export function formatBackup(backup: Backup, index: number): string {
  let text = `${index + 1}. ${backup.id}
  Created: ${backup.creationTime}
  Type: ${backup.type}${backup.packageVersion ? ` (v${backup.packageVersion})` : ""}
  State: ${backup.state}`
  if (backup.label) text += `\n  Label: ${backup.label}`
  if (backup.stats?.size !== undefined) {
    text += `\n  Size: ${formatBytes(backup.stats.size)}`
  }
  if (backup.siteId) text += `\n  Backup site: ${backup.siteId}`
  if (backup.preserveSecs === -1) text += "\n  Preserved: forever"
  return text
}

export function formatBackupSite(site: BackupSite, index: number): string {
  let text = `${index + 1}. ${site.name} (${site.id})
  Provider: ${site.provider}${site.format ? `, format ${site.format}` : ""}`
  if (site.locationLabel) text += `\n  Location: ${site.locationLabel}`
  if (site.schedule) text += `\n  Schedule: ${site.schedule}`
  if (site.encrypted !== undefined) {
    text += `\n  Encrypted: ${site.encrypted ? "yes" : "no"}`
  }
  if (site.enableForUpdates) text += "\n  Used for pre-update backups"
  return text
}

export function formatUser(user: User, index: number): string {
  let text = `${index + 1}. ${user.username ?? "(invite pending)"} <${user.email}>
  ID: ${user.id}
  Role: ${user.role}`
  if (user.active === false) text += "\n  Status: deactivated"
  if (user.inviteAccepted === false) text += "\n  Invite: not yet accepted"
  return text
}

export function formatUserDetails(user: User): string {
  const lines = [
    "User Details:",
    `  ID: ${user.id}`,
    `  Email: ${user.email}`,
    `  Username: ${user.username ?? "(not set)"}`,
    `  Display name: ${user.displayName || "(not set)"}`,
    `  Role: ${user.role}`,
    `  Active: ${user.active === false ? "no" : "yes"}`,
  ]
  if (user.fallbackEmail) lines.push(`  Fallback email: ${user.fallbackEmail}`)
  if (user.groupIds?.length) lines.push(`  Groups: ${user.groupIds.join(", ")}`)
  if (user.source) lines.push(`  Source: ${user.source}`)
  if (user.createdAt) lines.push(`  Created: ${user.createdAt}`)
  return lines.join("\n")
}

export function formatDomain(domain: Domain): string {
  let text = `Domain: ${domain.domain}
  Zone: ${domain.zoneName}
  DNS provider: ${domain.provider}`
  if (domain.tlsConfig?.provider) {
    text += `\n  TLS: ${domain.tlsConfig.provider}${domain.tlsConfig.wildcard ? " (wildcard)" : ""}`
  }
  return text
}

export function formatStorageInfo(
  storageInfo: StorageInfo,
  requiredMB?: number,
): string {
  let statusText = `Storage Status (${storageInfo.mountpoint}):
  Available: ${storageInfo.available_mb} MB
  Total: ${storageInfo.total_mb} MB
  Used: ${storageInfo.used_mb} MB`

  if (requiredMB !== undefined) {
    statusText += `\n  Required: ${requiredMB} MB`
    statusText += `\n  Sufficient: ${storageInfo.sufficient ? "Yes" : "No"}`
  }

  if (storageInfo.critical) {
    statusText += "\n  ⚠️  CRITICAL: Less than 5% disk space remaining!"
  } else if (storageInfo.warning) {
    statusText += "\n  ⚠️  WARNING: Less than 10% disk space remaining"
  }

  return statusText
}

export function formatValidationResult(
  operation: string,
  resourceId: string,
  validationResult: ValidationResult,
): string {
  let statusText = `Validation Result for ${operation} on resource '${resourceId}':
  Valid: ${validationResult.valid ? "Yes" : "No"}`

  const section = (title: string, items: string[]) => {
    if (items.length === 0) return
    statusText += `\n\n${title}:`
    items.forEach((item, i) => {
      statusText += `\n  ${i + 1}. ${item}`
    })
  }
  section("Blocking Errors", validationResult.errors)
  section("Warnings", validationResult.warnings)
  section("Recommendations", validationResult.recommendations)

  statusText += validationResult.valid
    ? "\n\n✅ Operation can proceed (warnings should be reviewed)"
    : "\n\n❌ Operation blocked due to errors listed above"

  return statusText
}

export function formatTaskStatus(taskStatus: TaskStatus): string {
  let statusText = `Task Status:
  ID: ${taskStatus.id}${taskStatus.type ? `\n  Type: ${taskStatus.type}` : ""}
  State: ${taskStatus.state}
  Progress: ${taskStatus.progress}%
  Message: ${taskStatus.message}`

  if (taskStatus.state === "success" && taskStatus.result !== undefined) {
    statusText += `\n  Result: ${JSON.stringify(taskStatus.result, null, 2)}`
  }

  if (taskStatus.error) {
    statusText += `\n  Error: ${taskStatus.error.message}`
    if (taskStatus.error.code) {
      statusText += `\n  Error Code: ${taskStatus.error.code}`
    }
  }

  if (taskStatus.state === "pending" || taskStatus.state === "running") {
    statusText += "\n  Still in progress: check again shortly."
  }

  return statusText
}

/**
 * Format async task response with consistent guidance
 */
export function formatAsyncTaskResponse(
  operation: string,
  taskId: string,
  additionalInfo?: string,
): string {
  let response = `${operation} initiated successfully.

Task ID: ${taskId}

Use cloudron_task_status with taskId="${taskId}" to track progress.`

  if (additionalInfo) {
    response += `\n\n${additionalInfo}`
  }

  return response
}

export function formatService(service: Service, index: number): string {
  const ok = service.status === "active" || service.status === "running"
  let text = `${index + 1}. ${service.name} ${ok ? "✅" : service.status === "idle" ? "💤" : "⚠️"}
  ID: ${service.id}
  Status: ${service.status}`

  if (service.memoryUsed !== undefined) {
    text += `\n  Memory: ${formatBytes(service.memoryUsed)}${service.memoryPercent !== undefined ? ` (${service.memoryPercent}%)` : ""}`
  }
  if (service.error) {
    text += `\n  Error: ${service.error}`
  }
  return text
}

export function formatServiceList(services: Service[]): string {
  if (services.length === 0) {
    return "No services found."
  }
  const formatted = services.map((s, i) => formatService(s, i)).join("\n\n")
  return `Platform Services:\n\n${formatted}`
}

export function formatGroup(group: Group, index: number): string {
  let text = `${index + 1}. ${group.name}
  ID: ${group.id}`
  if (group.userIds) text += `\n  Members: ${group.userIds.length}`
  if (group.source && group.source !== "") text += `\n  Source: ${group.source}`
  return text
}

export function formatGroupList(groups: Group[]): string {
  if (groups.length === 0) {
    return "No groups found."
  }
  const formatted = groups.map((g, i) => formatGroup(g, i)).join("\n\n")
  return `Found ${groups.length} group(s):\n\n${formatted}`
}

export function formatBoxUpdate(update: BoxUpdateInfo | null): string {
  if (!update) {
    return `Update Status:
  Available: No

✅ No pending platform update (as of Cloudron's last check).`
  }

  let text = `Update Status:
  Available: Yes
  Version: ${update.version}${update.unstable ? " (pre-release)" : ""}`
  if (update.changelog?.length) {
    text += `\n  Changelog:\n${update.changelog.map(line => `    - ${line}`).join("\n")}`
  }
  if (!update.sourceTarballUrl) {
    text +=
      "\n\n⚠️  This release must be installed manually; it cannot be applied via the API."
  } else {
    text += `\n\nTo install, call cloudron_apply_update with version "${update.version}" (requires CLOUDRON_ACCESS=all).`
  }
  return text
}

export function formatEvent(entry: EventLogEntry, index: number): string {
  const source = entry.source
    ? [entry.source.username, entry.source.ip, entry.source.appId]
        .filter(Boolean)
        .join(" ")
    : ""
  let text = `${index + 1}. ${entry.creationTime} ${entry.action}`
  if (source) text += `\n  By: ${source}`
  if (entry.data && Object.keys(entry.data).length) {
    const data = JSON.stringify(entry.data)
    text += `\n  Data: ${data.length > 400 ? `${data.slice(0, 400)}…` : data}`
  }
  return text
}

export function formatNotification(
  notification: Notification,
  index: number,
): string {
  let text = `${index + 1}. ${notification.title}${notification.acknowledged ? "" : " [open]"}
  ID: ${notification.id}
  Created: ${notification.creationTime}`
  if (notification.message) {
    const message = notification.message.trim()
    text += `\n  ${message.length > 600 ? `${message.slice(0, 600)}…` : message}`
  }
  return text
}
