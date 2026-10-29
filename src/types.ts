/**
 * Cloudron API TypeScript Definitions
 *
 * Shapes follow the Cloudron box server source (routes/*.js) for 9.0 and 10.x.
 * Field names are kept as Cloudron sends them so they line up with the API.
 */

// ==================== Shared ====================

/**
 * Access restriction for an app: null means every Cloudron user can sign in
 */
export interface AccessRestriction {
  users?: string[] // User IDs allowed to access
  groups?: string[] // Group IDs allowed to access
}

export type UserRole =
  | "owner"
  | "admin"
  | "usermanager"
  | "mailmanager"
  | "user"

export const USER_ROLES: readonly UserRole[] = [
  "owner",
  "admin",
  "usermanager",
  "mailmanager",
  "user",
]

/**
 * Response from endpoints that start an asynchronous task
 */
export interface TaskStarted {
  taskId: string
}

// ==================== Apps ====================

/**
 * App manifest subset containing metadata
 */
export interface AppManifest {
  id: string
  version: string
  title: string
  description?: string
  tagline?: string
  website?: string
  author?: string
  tags?: string[]
  minBoxVersion?: string // Minimum Cloudron version required
  memoryLimit?: number // Memory requirement in bytes
  addons?: Record<string, unknown> // Required addons (dependencies)
}

/**
 * Pending app update as recorded by Cloudron's update checker
 */
export interface AppUpdateInfo {
  id?: string
  manifest?: { version?: string }
  unstable?: boolean
}

/**
 * Installed app (GET /api/v1/apps and GET /api/v1/apps/:id)
 */
export interface App {
  id: string
  appStoreId: string
  installationState: string // installed, pending_install, pending_configure, error, ...
  runState: string // running, stopped
  health: string | null // healthy, unhealthy, error, dead
  error: { message?: string; reason?: string } | null
  taskId: string | null
  subdomain: string
  domain: string
  fqdn: string
  label?: string | null
  tags?: string[]
  accessRestriction: AccessRestriction | null
  manifest: AppManifest
  portBindings: Record<string, unknown> | null
  memoryLimit?: number // bytes, 0 = manifest default
  env?: Record<string, string>
  enableBackup?: boolean
  enableAutomaticUpdate?: boolean
  updateInfo?: AppUpdateInfo | null
  creationTime?: string
  updateTime?: string
}

export interface AppsResponse {
  apps: App[]
}

/**
 * POST /api/v1/apps body
 */
export interface InstallAppParams {
  appStoreId: string // App Store id, optionally id@version
  subdomain: string
  domain: string
  accessRestriction: AccessRestriction | null
  ports?: Record<string, number>
  env?: Record<string, string>
  memoryLimit?: number // bytes
  label?: string
}

/**
 * POST /api/v1/apps/:id/clone body
 */
export interface CloneAppParams {
  subdomain: string
  domain: string
  backupId: string
  ports?: Record<string, number>
}

/**
 * POST /api/v1/apps/:id/update body
 */
export interface UpdateAppParams {
  appStoreId: string // id or id@version
  force?: boolean
  skipBackup?: boolean
}

/**
 * Settings handled by cloudron_configure_app. Each maps to one
 * POST /api/v1/apps/:id/configure/<setting> call.
 */
export interface AppConfig {
  env?: Record<string, string | null> // merged into existing env; null removes a key
  memoryLimit?: number // bytes
  accessRestriction?: AccessRestriction | null
  label?: string
  tags?: string[]
  enableAutomaticUpdate?: boolean
  enableBackup?: boolean
}

export interface ConfigureResult {
  setting: keyof AppConfig
  taskId?: string
}

// ==================== App Store ====================

/**
 * App Store entry (GET /api/v1/appstore/apps)
 */
export interface AppStoreApp {
  id: string
  iconUrl?: string | null
  releaseState?: string
  manifest: AppManifest
}

export interface AppStoreResponse {
  apps: AppStoreApp[]
}

export interface ManifestValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ==================== System ====================

/**
 * GET /api/v1/cloudron/status
 */
export interface SystemStatus {
  version: string
}

/**
 * GET /api/v1/system/info
 */
export interface SystemInfo {
  sysVendor?: string
  productName?: string
  uptimeSecs?: number
  rebootRequired?: boolean
  activationTime?: string | null
}

/**
 * One entry of GET /api/v1/system/filesystems (sizes in bytes)
 */
export interface Filesystem {
  filesystem: string
  type: string
  size: number
  used: number
  available: number
  capacity?: number
  mountpoint: string
}

export interface FilesystemsResponse {
  filesystems: Record<string, Filesystem>
}

export interface StorageInfo {
  mountpoint: string
  available_mb: number
  total_mb: number
  used_mb: number
  sufficient: boolean // available >= required
  warning: boolean // < 10% free
  critical: boolean // < 5% free
}

// ==================== Tasks ====================

export type TaskState = "pending" | "running" | "success" | "error" | "stopped"

export interface TaskStatus {
  id: string
  type?: string
  state: TaskState
  progress: number // 0-100
  message: string
  result?: unknown
  error?: {
    message: string
    code?: string
  }
}

/**
 * GET /api/v1/tasks/:id (tasks.removePrivateFields)
 */
export interface TaskStatusRaw {
  id: string
  type?: string
  percent?: number
  message?: string
  running?: boolean // actively running
  active?: boolean // running or scheduled; clients can stop polling once false
  pending?: boolean
  success?: boolean
  error?: {
    message: string
    code?: number | string
  } | null
  result?: unknown
  creationTime?: string
  ts?: string
}

// ==================== Validation ====================

export type ValidatableOperation =
  | "uninstall_app"
  | "delete_user"
  | "restore_app"

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  recommendations: string[]
}

// ==================== Domains ====================

export interface Domain {
  domain: string
  zoneName: string
  provider: string
  config?: Record<string, unknown>
  tlsConfig?: {
    provider?: string
    wildcard?: boolean
  }
}

// ==================== Backups ====================

/**
 * Backup (GET /api/v1/backups and GET /api/v1/apps/:id/backups)
 */
export interface Backup {
  id: string
  remotePath?: string
  label?: string | null
  identifier: string // "box" for full backups, app id otherwise
  creationTime: string
  packageVersion?: string
  type: string // "box" or "app"
  state: string // normal, creating, error
  siteId?: string
  preserveSecs?: number
  dependsOn?: string[]
  stats?: { size?: number; [key: string]: unknown } | null
}

export interface BackupsResponse {
  backups: Backup[]
}

/**
 * Backup destination (GET /api/v1/backup_sites)
 */
export interface BackupSite {
  id: string
  name: string
  provider: string
  format?: string
  schedule?: string
  enableForUpdates?: boolean
  locationLabel?: string
  encrypted?: boolean
}

export interface BackupSitesResponse {
  backupSites: BackupSite[]
}

// ==================== Users and Groups ====================

/**
 * User (users.removePrivateFields)
 */
export interface User {
  id: string
  username: string | null
  email: string
  fallbackEmail?: string
  displayName?: string
  role: UserRole
  active?: boolean
  source?: string
  groupIds?: string[]
  createdAt?: string
  inviteAccepted?: boolean
}

export interface UsersResponse {
  users: User[]
}

export interface CreateUserParams {
  email: string
  username?: string
  password?: string
  displayName?: string
  fallbackEmail?: string
  role?: UserRole
}

export interface UpdateUserParams {
  email?: string
  displayName?: string
  fallbackEmail?: string
  role?: UserRole
}

export interface Group {
  id: string
  name: string
  source?: string
  userIds?: string[]
}

export interface GroupsResponse {
  groups: Group[]
}

export interface CreateGroupParams {
  name: string
}

// ==================== Logs ====================

export type LogType = "app" | "service" | "task"

export interface LogEntry {
  timestamp: string
  severity: string
  message: string
}

// ==================== Services ====================

export interface Service {
  id: string // e.g. "mysql", "redis:<appId>"
  name: string
  status: string // active, stopped, starting, idle, unknown, ...
  memoryUsed?: number // bytes
  memoryPercent?: number
  error?: string | null
}

export interface ServicesResponse {
  services: Array<{ id: string; name: string }>
}

export interface ServiceStatusResponse {
  service: {
    name?: string
    status: string | null
    memoryUsed?: number
    memoryPercent?: number
    error?: string | null
  }
}

// ==================== Platform updates ====================

/**
 * GET /api/v1/updater/box_update
 */
export interface BoxUpdateInfo {
  version: string
  changelog?: string[]
  sourceTarballUrl?: string | null
  unstable?: boolean
}

export interface BoxUpdateResponse {
  update: BoxUpdateInfo | null
}

// ==================== Event log and notifications ====================

export interface EventLogEntry {
  id: string
  action: string
  source?: Record<string, unknown> | null
  data?: Record<string, unknown> | null
  creationTime: string
}

export interface Notification {
  id: string
  type?: string
  title: string
  message?: string
  acknowledged: boolean
  creationTime: string
}
