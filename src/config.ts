/**
 * Centralized configuration constants for mcp-cloudron
 *
 * All magic numbers and configurable values should be defined here
 * with documentation explaining their purpose and rationale.
 */

/**
 * HTTP request timeout in milliseconds
 * Default: 30 seconds - sufficient for most API calls
 */
export const DEFAULT_TIMEOUT_MS = 30000

/**
 * Minimum disk space required for backup creation (in MB)
 * 5GB = 5120MB - backups can be large, especially with multiple apps
 */
export const BACKUP_MIN_STORAGE_MB = 5120

/**
 * Minimum disk space required for backup restore (in MB)
 * 1GB = 1024MB - restore needs space for extraction and temporary files
 */
export const RESTORE_MIN_STORAGE_MB = 1024

/**
 * Default disk space requirement for app installation (in MB)
 * 500MB - reasonable default for most apps; specific apps may need more
 */
export const INSTALL_DEFAULT_STORAGE_MB = 500

/**
 * Storage warning threshold as percentage of total disk
 * When available space drops below this, emit warnings
 */
export const STORAGE_WARNING_THRESHOLD = 0.1 // 10%

/**
 * Storage critical threshold as percentage of total disk
 * When available space drops below this, block operations
 */
export const STORAGE_CRITICAL_THRESHOLD = 0.05 // 5%

/**
 * Maximum log lines that can be retrieved
 */
export const MAX_LOG_LINES = 1000

/**
 * Default log lines to retrieve
 */
export const DEFAULT_LOG_LINES = 100

/**
 * Page size used when walking paginated list endpoints
 * Cloudron defaults to 25 per page, which silently truncates lists
 */
export const LIST_PAGE_SIZE = 100

/**
 * Upper bound on pages fetched by a single list call (100 x 50 = 5000 rows)
 */
export const LIST_MAX_PAGES = 50

/**
 * Maximum App Store search results returned to the model
 */
export const APPSTORE_MAX_RESULTS = 25

/**
 * What the server lets a client do, set via CLOUDRON_ACCESS
 * - read: read-only tools (default). Pair with a read-only API token.
 * - write: adds tools that change state but can be undone (start/stop, backup, configure, install...)
 * - all: adds destructive tools (uninstall, delete user, restore, platform update)
 */
export type AccessLevel = "read" | "write" | "all"

export const ACCESS_LEVELS: readonly AccessLevel[] = ["read", "write", "all"]

export function getAccessLevel(
  value: string | undefined = process.env.CLOUDRON_ACCESS,
): AccessLevel {
  if (value === undefined || value === "") return "read"
  const level = ACCESS_LEVELS.find(l => l === value)
  if (!level) {
    throw new Error(
      `Invalid CLOUDRON_ACCESS '${value}'. Valid options: ${ACCESS_LEVELS.join(", ")}`,
    )
  }
  return level
}
