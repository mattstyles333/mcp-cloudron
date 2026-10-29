/**
 * Argument validators for MCP tool handlers
 * Provides runtime validation with proper TypeScript types
 */

import { CloudronError } from "../errors.js"
import {
  type AccessRestriction,
  type AppConfig,
  type LogType,
  USER_ROLES,
  type UserRole,
  type ValidatableOperation,
} from "../types.js"

const BYTES_PER_MB = 1024 * 1024

/**
 * Validate that a value is a non-empty string
 */
function assertNonEmptyString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CloudronError(
      `${fieldName} is required and must be a non-empty string`,
    )
  }
}

/**
 * Validate that a value is a string (can be empty)
 */
function assertString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new CloudronError(`${fieldName} must be a string`)
  }
}

/**
 * Validate that a value is a number
 */
function assertNumber(
  value: unknown,
  fieldName: string,
): asserts value is number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new CloudronError(`${fieldName} must be a number`)
  }
}

function assertBoolean(
  value: unknown,
  fieldName: string,
): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new CloudronError(`${fieldName} must be a boolean`)
  }
}

/**
 * Validate that a value is an object (not null, not array)
 */
function assertObject(
  value: unknown,
  fieldName: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CloudronError(`${fieldName} must be an object`)
  }
}

function assertStringArray(
  value: unknown,
  fieldName: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== "string")) {
    throw new CloudronError(`${fieldName} must be an array of strings`)
  }
}

function parseStringRecord(
  value: unknown,
  fieldName: string,
): Record<string, string> {
  assertObject(value, fieldName)
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(value)) {
    if (typeof val !== "string") {
      throw new CloudronError(
        `${fieldName}["${key}"] must be a string, got ${typeof val}`,
      )
    }
    result[key] = val
  }
  return result
}

function parsePorts(value: unknown): Record<string, number> {
  assertObject(value, "ports")
  const result: Record<string, number> = {}
  for (const [key, val] of Object.entries(value)) {
    if (typeof val !== "number" || !Number.isInteger(val) || val <= 0) {
      throw new CloudronError(`ports["${key}"] must be a port number`)
    }
    result[key] = val
  }
  return result
}

function parseAccessRestriction(value: unknown): AccessRestriction | null {
  if (value === null) return null
  assertObject(value, "accessRestriction")
  const result: AccessRestriction = {}
  if (value.users !== undefined) {
    assertStringArray(value.users, "accessRestriction.users")
    result.users = value.users
  }
  if (value.groups !== undefined) {
    assertStringArray(value.groups, "accessRestriction.groups")
    result.groups = value.groups
  }
  return result
}

function parseMemoryLimitMB(value: unknown): number {
  assertNumber(value, "memoryLimit")
  if (value < 0) {
    throw new CloudronError("memoryLimit must be 0 or a positive number of MB")
  }
  return Math.round(value * BYTES_PER_MB)
}

function parseRole(value: unknown): UserRole {
  assertNonEmptyString(value, "role")
  const role = USER_ROLES.find(r => r === value)
  if (!role) {
    throw new CloudronError(
      `Invalid role: ${value}. Valid options: ${USER_ROLES.join(", ")}`,
    )
  }
  return role
}

function parseLimit(value: unknown, fallback = 25, max = 100): number {
  if (value === undefined) return fallback
  assertNumber(value, "limit")
  return Math.max(1, Math.min(max, Math.floor(value)))
}

/**
 * Parse args[key] when present; spread the result into an args object
 */
function optional<K extends string, T>(
  args: Record<string, unknown>,
  key: K,
  parse: (value: unknown) => T,
): Partial<Record<K, T>> {
  if (args[key] === undefined) return {}
  return { [key]: parse(args[key]) } as Record<K, T>
}

/**
 * Destructive tools make the caller repeat the target's human-readable name,
 * so a wrong ID cannot silently hit a different app or user.
 */
export function requireConfirmation(
  confirm: unknown,
  expected: string,
  what: string,
): void {
  assertNonEmptyString(confirm, "confirm")
  if (confirm.trim().toLowerCase() !== expected.toLowerCase()) {
    throw new CloudronError(
      `Confirmation mismatch: confirm must be ${what} '${expected}', got '${confirm}'. Nothing was changed.`,
    )
  }
}

// ==================== Simple ID arguments ====================

export function parseIdArg<K extends string>(
  args: unknown,
  key: K,
): Record<K, string> {
  assertObject(args, "arguments")
  const value = args[key]
  assertNonEmptyString(value, key)
  return { [key]: value } as Record<K, string>
}

export function parseAppIdArgs(args: unknown): { appId: string } {
  return parseIdArg(args, "appId")
}

export function parseTaskIdArgs(args: unknown): { taskId: string } {
  return parseIdArg(args, "taskId")
}

export function parseUserIdArgs(args: unknown): { userId: string } {
  return parseIdArg(args, "userId")
}

// ==================== Apps ====================

export function parseControlAppArgs(args: unknown): {
  appId: string
  action: "start" | "stop" | "restart"
} {
  const { appId } = parseAppIdArgs(args)
  assertObject(args, "arguments")
  const action = args.action
  if (action !== "start" && action !== "stop" && action !== "restart") {
    throw new CloudronError(
      `Invalid action: ${String(action)}. Valid options: start, stop, restart`,
    )
  }
  return { appId, action }
}

export function parseConfigureAppArgs(args: unknown): {
  appId: string
  config: AppConfig
} {
  const { appId } = parseAppIdArgs(args)
  assertObject(args, "arguments")
  const raw = args.config
  assertObject(raw, "config")

  const known = new Set([
    "env",
    "memoryLimit",
    "accessRestriction",
    "label",
    "tags",
    "enableAutomaticUpdate",
    "enableBackup",
  ])
  const unknown = Object.keys(raw).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new CloudronError(
      `Unsupported config field(s): ${unknown.join(", ")}. Supported: ${[...known].join(", ")}`,
    )
  }

  const config: AppConfig = {}
  if (raw.env !== undefined) {
    assertObject(raw.env, "config.env")
    const env: Record<string, string | null> = {}
    for (const [key, val] of Object.entries(raw.env)) {
      if (val !== null && typeof val !== "string") {
        throw new CloudronError(`config.env["${key}"] must be a string or null`)
      }
      env[key] = val
    }
    config.env = env
  }
  if (raw.memoryLimit !== undefined) {
    config.memoryLimit = parseMemoryLimitMB(raw.memoryLimit)
  }
  if (raw.accessRestriction !== undefined) {
    config.accessRestriction = parseAccessRestriction(raw.accessRestriction)
  }
  if (raw.label !== undefined) {
    assertString(raw.label, "config.label")
    config.label = raw.label
  }
  if (raw.tags !== undefined) {
    assertStringArray(raw.tags, "config.tags")
    config.tags = raw.tags
  }
  if (raw.enableAutomaticUpdate !== undefined) {
    assertBoolean(raw.enableAutomaticUpdate, "config.enableAutomaticUpdate")
    config.enableAutomaticUpdate = raw.enableAutomaticUpdate
  }
  if (raw.enableBackup !== undefined) {
    assertBoolean(raw.enableBackup, "config.enableBackup")
    config.enableBackup = raw.enableBackup
  }

  if (Object.keys(config).length === 0) {
    throw new CloudronError(
      `config object cannot be empty. Provide at least one of: ${[...known].join(", ")}`,
    )
  }

  return { appId, config }
}

export interface InstallAppArgs {
  appStoreId: string
  subdomain: string
  domain: string
  accessRestriction: AccessRestriction | null
  ports?: Record<string, number>
  env?: Record<string, string>
  memoryLimit?: number // bytes
  label?: string
}

export function parseInstallAppArgs(args: unknown): InstallAppArgs {
  assertObject(args, "arguments")
  const { appStoreId, subdomain, domain } = args
  assertNonEmptyString(appStoreId, "appStoreId")
  assertString(subdomain, "subdomain")
  assertNonEmptyString(domain, "domain")

  return {
    appStoreId,
    subdomain,
    domain,
    accessRestriction:
      args.accessRestriction === undefined
        ? null
        : parseAccessRestriction(args.accessRestriction),
    ...optional(args, "ports", parsePorts),
    ...optional(args, "env", v => parseStringRecord(v, "env")),
    ...optional(args, "memoryLimit", parseMemoryLimitMB),
    ...optional(args, "label", v => {
      assertString(v, "label")
      return v
    }),
  }
}

export interface CloneAppArgs {
  appId: string
  subdomain: string
  domain?: string
  backupId?: string
  ports?: Record<string, number>
}

export function parseCloneAppArgs(args: unknown): CloneAppArgs {
  const { appId } = parseAppIdArgs(args)
  assertObject(args, "arguments")
  assertString(args.subdomain, "subdomain")
  const nonEmpty = (field: string) => (v: unknown) => {
    assertNonEmptyString(v, field)
    return v
  }

  return {
    appId,
    subdomain: args.subdomain,
    ...optional(args, "domain", nonEmpty("domain")),
    ...optional(args, "backupId", nonEmpty("backupId")),
    ...optional(args, "ports", parsePorts),
  }
}

export function parseRestoreAppArgs(args: unknown): {
  appId: string
  backupId: string
  confirm: unknown
} {
  const { appId } = parseAppIdArgs(args)
  assertObject(args, "arguments")
  assertNonEmptyString(args.backupId, "backupId")
  return { appId, backupId: args.backupId, confirm: args.confirm }
}

export function parseUninstallAppArgs(args: unknown): {
  appId: string
  confirm: unknown
} {
  const { appId } = parseAppIdArgs(args)
  assertObject(args, "arguments")
  return { appId, confirm: args.confirm }
}

export function parseUpdateAppArgs(args: unknown): {
  appId: string
  version?: string
  force?: boolean
} {
  const { appId } = parseAppIdArgs(args)
  assertObject(args, "arguments")
  return {
    appId,
    ...optional(args, "version", v => {
      assertNonEmptyString(v, "version")
      return v.replace(/^v/, "")
    }),
    ...optional(args, "force", v => {
      assertBoolean(v, "force")
      return v
    }),
  }
}

export function parseBackupAppArgs(args: unknown): {
  appId: string
  backupSiteId?: string
} {
  const { appId } = parseAppIdArgs(args)
  assertObject(args, "arguments")
  return { appId, ...parseBackupSiteArgs(args) }
}

export function parseBackupSiteArgs(args: unknown): { backupSiteId?: string } {
  assertObject(args ?? {}, "arguments")
  const value = (args as Record<string, unknown> | undefined)?.backupSiteId
  if (value === undefined) return {}
  assertNonEmptyString(value, "backupSiteId")
  return { backupSiteId: value }
}

// ==================== App Store ====================

export function parseSearchAppsArgs(args: unknown): { query?: string } {
  assertObject(args ?? {}, "arguments")
  const query = (args as Record<string, unknown> | undefined)?.query
  if (query === undefined) return {}
  assertString(query, "query")
  return { query }
}

export function parseAppStoreIdArgs(args: unknown): { appStoreId: string } {
  return parseIdArg(args, "appStoreId")
}

// ==================== System ====================

export function parseCheckStorageArgs(args: unknown): { requiredMB?: number } {
  assertObject(args ?? {}, "arguments")
  const requiredMB = (args as Record<string, unknown> | undefined)?.requiredMB
  if (requiredMB === undefined) return {}
  assertNumber(requiredMB, "requiredMB")
  if (requiredMB < 0) {
    throw new CloudronError("requiredMB must be a positive number")
  }
  return { requiredMB }
}

export function parseValidateOperationArgs(args: unknown): {
  operation: ValidatableOperation
  resourceId: string
  backupId?: string
} {
  assertObject(args, "arguments")
  const { operation, resourceId, backupId } = args
  assertNonEmptyString(resourceId, "resourceId")

  const validOperations: ValidatableOperation[] = [
    "uninstall_app",
    "delete_user",
    "restore_app",
  ]
  const op = validOperations.find(o => o === operation)
  if (!op) {
    throw new CloudronError(
      `Invalid operation: ${String(operation)}. Valid options: ${validOperations.join(", ")}`,
    )
  }

  if (backupId !== undefined) assertNonEmptyString(backupId, "backupId")
  return {
    operation: op,
    resourceId,
    ...(backupId !== undefined && { backupId }),
  }
}

export function parseGetLogsArgs(args: unknown): {
  resourceId: string
  type: LogType
  lines?: number
} {
  assertObject(args, "arguments")
  const { resourceId, type, lines } = args
  assertNonEmptyString(resourceId, "resourceId")

  const validTypes: LogType[] = ["app", "service", "task"]
  const logType = validTypes.find(t => t === type)
  if (!logType) {
    throw new CloudronError(
      `Invalid type: ${String(type)}. Valid options: ${validTypes.join(", ")}`,
    )
  }

  if (lines === undefined) return { resourceId, type: logType }
  assertNumber(lines, "lines")
  return {
    resourceId,
    type: logType,
    lines: Math.max(1, Math.min(1000, Math.floor(lines))),
  }
}

export function parseServiceIdArgs(args: unknown): { serviceId: string } {
  return parseIdArg(args, "serviceId")
}

export function parseEventLogArgs(args: unknown): {
  appId?: string
  actions?: string[]
  search?: string
  from?: string
  to?: string
  limit: number
} {
  assertObject(args ?? {}, "arguments")
  const raw = (args ?? {}) as Record<string, unknown>
  const text = (field: string) => (v: unknown) => {
    assertNonEmptyString(v, field)
    return v
  }
  const isoDate = (field: string) => (v: unknown) => {
    assertNonEmptyString(v, field)
    if (Number.isNaN(Date.parse(v))) {
      throw new CloudronError(`${field} must be an ISO 8601 date/time`)
    }
    return v
  }

  return {
    ...optional(raw, "appId", text("appId")),
    ...optional(raw, "actions", v => {
      assertStringArray(v, "actions")
      return v
    }),
    ...optional(raw, "search", text("search")),
    ...optional(raw, "from", isoDate("from")),
    ...optional(raw, "to", isoDate("to")),
    limit: parseLimit(raw.limit),
  }
}

export function parseNotificationsArgs(args: unknown): {
  acknowledged?: boolean
  limit: number
} {
  assertObject(args ?? {}, "arguments")
  const raw = (args ?? {}) as Record<string, unknown>
  return {
    ...optional(raw, "acknowledged", v => {
      assertBoolean(v, "acknowledged")
      return v
    }),
    limit: parseLimit(raw.limit),
  }
}

export function parseNotificationIdArgs(args: unknown): {
  notificationId: string
} {
  return parseIdArg(args, "notificationId")
}

// ==================== Users and groups ====================

export interface CreateUserArgs {
  email: string
  username?: string
  password?: string
  displayName?: string
  fallbackEmail?: string
  role?: UserRole
  sendInvite?: boolean
}

export function parseCreateUserArgs(args: unknown): CreateUserArgs {
  assertObject(args, "arguments")
  assertNonEmptyString(args.email, "email")
  const text = (field: string) => (v: unknown) => {
    assertNonEmptyString(v, field)
    return v
  }

  return {
    email: args.email,
    ...optional(args, "username", text("username")),
    ...optional(args, "password", text("password")),
    ...optional(args, "displayName", text("displayName")),
    ...optional(args, "fallbackEmail", text("fallbackEmail")),
    ...optional(args, "role", parseRole),
    ...optional(args, "sendInvite", v => {
      assertBoolean(v, "sendInvite")
      return v
    }),
  }
}

export interface UpdateUserArgs {
  userId: string
  email?: string
  displayName?: string
  fallbackEmail?: string
  role?: UserRole
}

export function parseUpdateUserArgs(args: unknown): UpdateUserArgs {
  const { userId } = parseUserIdArgs(args)
  assertObject(args, "arguments")

  if (args.password !== undefined) {
    throw new CloudronError(
      "Cloudron's API does not let admins set another user's password. Ask the user to reset it from the login page.",
    )
  }

  const result: UpdateUserArgs = {
    userId,
    ...optional(args, "email", v => {
      assertNonEmptyString(v, "email")
      return v
    }),
    ...optional(args, "displayName", v => {
      assertString(v, "displayName")
      return v
    }),
    ...optional(args, "fallbackEmail", v => {
      assertString(v, "fallbackEmail")
      return v
    }),
    ...optional(args, "role", parseRole),
  }

  if (Object.keys(result).length === 1) {
    throw new CloudronError(
      "At least one update field must be provided: email, displayName, fallbackEmail, role",
    )
  }
  return result
}

export function parseDeleteUserArgs(args: unknown): {
  userId: string
  confirm: unknown
} {
  const { userId } = parseUserIdArgs(args)
  assertObject(args, "arguments")
  return { userId, confirm: args.confirm }
}

export function parseCreateGroupArgs(args: unknown): { name: string } {
  return parseIdArg(args, "name")
}

// ==================== Platform updates ====================

export function parseApplyUpdateArgs(args: unknown): { version: string } {
  const { version } = parseIdArg(args, "version")
  return { version: version.trim().replace(/^v/, "") }
}
