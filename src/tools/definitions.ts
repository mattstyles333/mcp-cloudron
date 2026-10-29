/**
 * MCP Tool Definitions for Cloudron
 *
 * Each tool carries MCP annotations. They tell clients which tools only read
 * and which destroy data, and the server uses them to decide which tools a
 * given CLOUDRON_ACCESS level exposes (see tools/access.ts).
 */

export interface ToolAnnotations {
  title: string
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, object>
    required?: string[]
  }
  annotations: ToolAnnotations
}

const read = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
})

const write = (title: string, idempotent = false): ToolAnnotations => ({
  title,
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: idempotent,
  openWorldHint: true,
})

const destructive = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
})

const offline = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
})

const noArgs = { type: "object" as const, properties: {} }

const appId = {
  type: "string",
  description: "App ID (from cloudron_list_apps)",
}

const ports = {
  type: "object",
  description:
    'Optional TCP/UDP port bindings, e.g. {"SSH_PORT": 2222}. Keys come from the app manifest.',
  additionalProperties: { type: "number" },
}

const accessRestriction = {
  type: ["object", "null"],
  description:
    'Who can sign in: null for every Cloudron user, or {"users": [userIds], "groups": [groupIds]}',
  properties: {
    users: { type: "array", items: { type: "string" } },
    groups: { type: "array", items: { type: "string" } },
  },
}

const backupSiteId = {
  type: "string",
  description:
    "Backup site ID (from cloudron_list_backup_sites). Optional when only one site is configured.",
}

const confirm = (what: string) => ({
  type: "string",
  description: `Safety check: must equal ${what}, exactly as Cloudron reports it`,
})

const limit = {
  type: "number",
  description: "Maximum entries to return (default 25, max 100)",
}

const API_TOOLS: ToolDefinition[] = [
  // ==================== Apps ====================
  {
    name: "cloudron_list_apps",
    description:
      "List installed apps with their location, state, health and whether an update is pending.",
    inputSchema: noArgs,
    annotations: read("List apps"),
  },
  {
    name: "cloudron_get_app",
    description:
      "Get details of one app: location, state, health, error, memory limit, access, backups and auto-update settings, environment variable names, pending update.",
    inputSchema: {
      type: "object",
      properties: { appId },
      required: ["appId"],
    },
    annotations: read("Get app"),
  },
  {
    name: "cloudron_control_app",
    description:
      "Start, stop or restart an app. Returns a task ID; track it with cloudron_task_status.",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        action: {
          type: "string",
          enum: ["start", "stop", "restart"],
          description: "Action to perform on the app",
        },
      },
      required: ["appId", "action"],
    },
    annotations: write("Start/stop/restart app", true),
  },
  {
    name: "cloudron_configure_app",
    description:
      "Change app settings. env is merged into the existing variables (set a key to null to remove it). env and memoryLimit restart the app through a task that locks it, so change only one of them per call.",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        config: {
          type: "object",
          description: "Settings to change; give at least one",
          properties: {
            env: {
              type: "object",
              description:
                "Environment variables to set (string) or remove (null)",
              additionalProperties: { type: ["string", "null"] },
            },
            memoryLimit: {
              type: "number",
              description:
                "Memory limit in MB (converted to bytes for Cloudron); 0 uses the app's default",
            },
            accessRestriction,
            label: { type: "string", description: "Dashboard label" },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Dashboard tags (replaces existing tags)",
            },
            enableAutomaticUpdate: {
              type: "boolean",
              description: "Let Cloudron update the app automatically",
            },
            enableBackup: {
              type: "boolean",
              description: "Include the app in automatic backups",
            },
          },
        },
      },
      required: ["appId", "config"],
    },
    annotations: write("Configure app", true),
  },
  {
    name: "cloudron_install_app",
    description:
      "Install an app from the Cloudron App Store. Checks the app exists and the root disk has room first. Returns the new app ID and a task ID.",
    inputSchema: {
      type: "object",
      properties: {
        appStoreId: {
          type: "string",
          description:
            "App Store ID, e.g. org.wordpress.cloudronapp (from cloudron_search_apps); append @version to pin a version",
        },
        subdomain: {
          type: "string",
          description:
            "Subdomain to install at; empty string for the bare domain",
        },
        domain: {
          type: "string",
          description: "Domain to install on (from cloudron_list_domains)",
        },
        accessRestriction,
        ports,
        env: {
          type: "object",
          description: "Optional environment variables",
          additionalProperties: { type: "string" },
        },
        memoryLimit: {
          type: "number",
          description: "Optional memory limit in MB",
        },
        label: { type: "string", description: "Optional dashboard label" },
      },
      required: ["appStoreId", "subdomain", "domain"],
    },
    annotations: write("Install app"),
  },
  {
    name: "cloudron_clone_app",
    description:
      "Clone an app from one of its backups to a new location. Uses the newest backup and the source app's domain unless given.",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        subdomain: {
          type: "string",
          description: "Subdomain for the clone",
        },
        domain: {
          type: "string",
          description: "Domain for the clone (defaults to the source app's)",
        },
        backupId: {
          type: "string",
          description:
            "Backup to clone from (from cloudron_list_app_backups); defaults to the newest",
        },
        ports,
      },
      required: ["appId", "subdomain"],
    },
    annotations: write("Clone app"),
  },
  {
    name: "cloudron_repair_app",
    description:
      "Re-run the last failed operation of an app that is in an error state. Returns a task ID.",
    inputSchema: {
      type: "object",
      properties: { appId },
      required: ["appId"],
    },
    annotations: write("Repair app"),
  },
  {
    name: "cloudron_update_app",
    description:
      "Update an App Store app to the latest or a given version. Cloudron backs the app up before updating. Returns a task ID.",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        version: {
          type: "string",
          description: "Package version to update to (defaults to latest)",
        },
        force: {
          type: "boolean",
          description:
            "Update even if the new version has breaking-change warnings",
        },
      },
      required: ["appId"],
    },
    annotations: write("Update app"),
  },
  {
    name: "cloudron_backup_app",
    description: "Back up one app to a backup site. Returns a task ID.",
    inputSchema: {
      type: "object",
      properties: { appId, backupSiteId },
      required: ["appId"],
    },
    annotations: write("Back up app"),
  },
  {
    name: "cloudron_list_app_backups",
    description:
      "List the backups of one app, newest first. Use the IDs with cloudron_restore_app or cloudron_clone_app.",
    inputSchema: {
      type: "object",
      properties: { appId },
      required: ["appId"],
    },
    annotations: read("List app backups"),
  },
  {
    name: "cloudron_restore_app",
    description:
      "DESTRUCTIVE: replace an app's current data with one of its backups. Validates that the backup belongs to the app first.",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        backupId: {
          type: "string",
          description: "Backup to restore (from cloudron_list_app_backups)",
        },
        confirm: confirm("the app's fqdn (e.g. blog.example.com)"),
      },
      required: ["appId", "backupId", "confirm"],
    },
    annotations: destructive("Restore app from backup"),
  },
  {
    name: "cloudron_uninstall_app",
    description:
      "DESTRUCTIVE: uninstall an app and delete its data. Warns if the app has no backup from the last 24 hours.",
    inputSchema: {
      type: "object",
      properties: {
        appId,
        confirm: confirm("the app's fqdn (e.g. blog.example.com)"),
      },
      required: ["appId", "confirm"],
    },
    annotations: destructive("Uninstall app"),
  },

  // ==================== App Store ====================
  {
    name: "cloudron_search_apps",
    description:
      "Search the Cloudron App Store by name, ID, tag or tagline. Returns up to 25 matches.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search text (empty lists the catalogue alphabetically)",
        },
      },
    },
    annotations: read("Search App Store"),
  },
  {
    name: "cloudron_validate_manifest",
    description:
      "Pre-install check for an App Store app: confirms it exists and the root disk has room.",
    inputSchema: {
      type: "object",
      properties: {
        appStoreId: {
          type: "string",
          description: "App Store ID to check",
        },
      },
      required: ["appStoreId"],
    },
    annotations: read("Check App Store app"),
  },

  // ==================== System ====================
  {
    name: "cloudron_get_status",
    description:
      "Cloudron version, server vendor, uptime, whether a reboot is required, and any pending platform update.",
    inputSchema: noArgs,
    annotations: read("Get Cloudron status"),
  },
  {
    name: "cloudron_check_storage",
    description:
      "Free, used and total space on the root disk in MB, with warning (<10% free) and critical (<5% free) flags.",
    inputSchema: {
      type: "object",
      properties: {
        requiredMB: {
          type: "number",
          description:
            "Optional: report whether at least this many MB are free",
        },
      },
    },
    annotations: read("Check disk space"),
  },
  {
    name: "cloudron_list_domains",
    description: "List the domains configured on this Cloudron.",
    inputSchema: noArgs,
    annotations: read("List domains"),
  },
  {
    name: "cloudron_list_services",
    description:
      "List platform services (MySQL, PostgreSQL, mail, ...) with their status and memory use.",
    inputSchema: noArgs,
    annotations: read("List services"),
  },
  {
    name: "cloudron_restart_service",
    description: "Restart one platform service, e.g. mysql or mail.",
    inputSchema: {
      type: "object",
      properties: {
        serviceId: {
          type: "string",
          description: "Service ID (from cloudron_list_services)",
        },
      },
      required: ["serviceId"],
    },
    annotations: write("Restart service", true),
  },
  {
    name: "cloudron_get_logs",
    description: "Recent log lines for an app, a platform service or a task.",
    inputSchema: {
      type: "object",
      properties: {
        resourceId: {
          type: "string",
          description: "App ID, service ID or task ID",
        },
        type: {
          type: "string",
          enum: ["app", "service", "task"],
          description: "What resourceId refers to",
        },
        lines: {
          type: "number",
          description: "Number of lines (default 100, max 1000)",
        },
      },
      required: ["resourceId", "type"],
    },
    annotations: read("Get logs"),
  },
  {
    name: "cloudron_list_eventlog",
    description:
      "Audit log of what happened on the Cloudron (logins, installs, updates, backups...), newest first.",
    inputSchema: {
      type: "object",
      properties: {
        appId: {
          type: "string",
          description: "Optional: only events for this app",
        },
        actions: {
          type: "array",
          items: { type: "string" },
          description:
            'Optional action filter, e.g. ["app.update", "backup.finish", "user.login"]',
        },
        search: { type: "string", description: "Optional text search" },
        from: {
          type: "string",
          description: "Optional ISO 8601 start time",
        },
        to: { type: "string", description: "Optional ISO 8601 end time" },
        limit,
      },
    },
    annotations: read("List event log"),
  },
  {
    name: "cloudron_list_notifications",
    description:
      "Dashboard notifications (failed backups, app errors, update notices), newest first.",
    inputSchema: {
      type: "object",
      properties: {
        acknowledged: {
          type: "boolean",
          description:
            "Optional: false for open notifications only, true for acknowledged only",
        },
        limit,
      },
    },
    annotations: read("List notifications"),
  },
  {
    name: "cloudron_acknowledge_notification",
    description: "Mark a dashboard notification as acknowledged.",
    inputSchema: {
      type: "object",
      properties: {
        notificationId: {
          type: "string",
          description: "Notification ID (from cloudron_list_notifications)",
        },
      },
      required: ["notificationId"],
    },
    annotations: write("Acknowledge notification", true),
  },

  // ==================== Tasks ====================
  {
    name: "cloudron_task_status",
    description:
      "State (pending/running/success/error/stopped), progress and message of an async task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" },
      },
      required: ["taskId"],
    },
    annotations: read("Get task status"),
  },
  {
    name: "cloudron_cancel_task",
    description:
      "Stop a running task (e.g. a backup) and return its final state.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Task ID" },
      },
      required: ["taskId"],
    },
    annotations: write("Stop task", true),
  },
  {
    name: "cloudron_validate_operation",
    description:
      "Dry-run the pre-flight checks for a destructive operation without performing it.",
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["uninstall_app", "delete_user", "restore_app"],
          description: "Operation to check",
        },
        resourceId: {
          type: "string",
          description:
            "appId for uninstall_app/restore_app, userId for delete_user",
        },
        backupId: {
          type: "string",
          description: "Backup ID (required for restore_app)",
        },
      },
      required: ["operation", "resourceId"],
    },
    annotations: read("Check destructive operation"),
  },

  // ==================== Backups ====================
  {
    name: "cloudron_list_backups",
    description:
      "List full-instance backups, newest first. Per-app backups are listed by cloudron_list_app_backups.",
    inputSchema: noArgs,
    annotations: read("List backups"),
  },
  {
    name: "cloudron_list_backup_sites",
    description:
      "List backup destinations (storage provider, schedule, encryption).",
    inputSchema: noArgs,
    annotations: read("List backup sites"),
  },
  {
    name: "cloudron_create_backup",
    description:
      "Start a full-instance backup to a backup site. Returns a task ID.",
    inputSchema: {
      type: "object",
      properties: { backupSiteId },
    },
    annotations: write("Create full backup"),
  },

  // ==================== Users and groups ====================
  {
    name: "cloudron_list_users",
    description: "List all users with their role and status.",
    inputSchema: noArgs,
    annotations: read("List users"),
  },
  {
    name: "cloudron_get_user",
    description: "Get one user's details.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User ID" },
      },
      required: ["userId"],
    },
    annotations: read("Get user"),
  },
  {
    name: "cloudron_create_user",
    description:
      "Create a user. Without a password, set sendInvite so they can sign up by email. API tokens act as admin, so they cannot create owners.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address" },
        username: {
          type: "string",
          description: "Optional username (otherwise chosen at sign-up)",
        },
        password: {
          type: "string",
          description: "Optional password, 8 to 256 characters",
        },
        displayName: { type: "string", description: "Optional display name" },
        fallbackEmail: {
          type: "string",
          description: "Optional password-recovery email",
        },
        role: {
          type: "string",
          enum: ["admin", "usermanager", "mailmanager", "user"],
          description: "Role (default user)",
        },
        sendInvite: {
          type: "boolean",
          description: "Email the user an invite link",
        },
      },
      required: ["email"],
    },
    annotations: write("Create user"),
  },
  {
    name: "cloudron_update_user",
    description:
      "Change a user's email, display name, fallback email or role. Passwords can only be changed by the user (or via a reset email in the dashboard).",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User ID" },
        email: { type: "string", description: "New email" },
        displayName: { type: "string", description: "New display name" },
        fallbackEmail: {
          type: "string",
          description: "New password-recovery email",
        },
        role: {
          type: "string",
          enum: ["owner", "admin", "usermanager", "mailmanager", "user"],
          description: "New role",
        },
      },
      required: ["userId"],
    },
    annotations: write("Update user", true),
  },
  {
    name: "cloudron_delete_user",
    description:
      "DESTRUCTIVE: delete a user. Refuses to delete the last owner.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User ID" },
        confirm: confirm("the user's email address"),
      },
      required: ["userId", "confirm"],
    },
    annotations: destructive("Delete user"),
  },
  {
    name: "cloudron_list_groups",
    description: "List user groups and their members.",
    inputSchema: noArgs,
    annotations: read("List groups"),
  },
  {
    name: "cloudron_create_group",
    description: "Create a user group (for app access control).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Group name" },
      },
      required: ["name"],
    },
    annotations: write("Create group"),
  },

  // ==================== Platform updates ====================
  {
    name: "cloudron_check_updates",
    description:
      "Show the pending Cloudron platform update found by Cloudron's own checker, with its changelog.",
    inputSchema: noArgs,
    annotations: read("Check platform update"),
  },
  {
    name: "cloudron_apply_update",
    description:
      "DESTRUCTIVE: update the Cloudron platform. All apps go offline while it restarts. Cloudron backs up first.",
    inputSchema: {
      type: "object",
      properties: {
        version: {
          type: "string",
          description:
            "Safety check: the version reported by cloudron_check_updates, e.g. 10.1.7",
        },
      },
      required: ["version"],
    },
    annotations: destructive("Apply platform update"),
  },
]

// Packaging helpers work offline (except fetching examples from git.cloudron.io)
// and are available at every access level.
const PACKAGING_TOOLS: Omit<ToolDefinition, "annotations">[] = [
  // ==================== Packaging Guide Tool ====================
  {
    name: "cloudron_packaging_guide",
    description:
      "Get interactive, topic-specific guidance for creating Cloudron packages. Provides documentation, best practices, and reference implementation examples for packaging web applications for Cloudron.",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          enum: [
            "overview",
            "manifest",
            "dockerfile",
            "addons",
            "testing",
            "publishing",
          ],
          description:
            "The packaging topic to get guidance on. 'overview' provides quick start and workflow, 'manifest' covers CloudronManifest.json fields, 'dockerfile' covers Dockerfile best practices, 'addons' covers available platform services, 'testing' covers integration test patterns, 'publishing' covers App Store submission.",
        },
        appType: {
          type: "string",
          enum: ["nodejs", "php", "python", "java", "go", "static"],
          description:
            "Optional: The type of application being packaged. Provides language/framework-specific guidance when topic is 'dockerfile'.",
        },
      },
      required: ["topic"],
    },
  },
  // ==================== Package Scaffolding Tool ====================
  {
    name: "cloudron_scaffold_package",
    description:
      "Generate a complete Cloudron package scaffold with all required files (CloudronManifest.json, Dockerfile, start.sh, test/test.js). Provides ready-to-use templates customized for your application type, addons, and authentication method.",
    inputSchema: {
      type: "object" as const,
      properties: {
        appType: {
          type: "string",
          enum: ["nodejs", "php", "python", "java", "go", "static"],
          description:
            "The type of application being packaged. Determines the Dockerfile template and startup script.",
        },
        appName: {
          type: "string",
          description:
            "Name of the application (used in manifest title and generated files).",
        },
        appId: {
          type: "string",
          description:
            "Optional: Reverse domain identifier (e.g., 'com.example.myapp'). Auto-generated from appName if not provided.",
        },
        version: {
          type: "string",
          description:
            "Optional: Initial version in semver format (default: '1.0.0').",
        },
        httpPort: {
          type: "number",
          description:
            "Optional: HTTP port the application listens on (default: 8000).",
        },
        healthCheckPath: {
          type: "string",
          description: "Optional: Path for health checks (default: '/').",
        },
        addons: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "localstorage",
              "mysql",
              "postgresql",
              "mongodb",
              "redis",
              "ldap",
              "oidc",
              "sendmail",
              "recvmail",
              "scheduler",
            ],
          },
          description:
            "Optional: Required Cloudron addons (default: ['localstorage']).",
        },
        authMethod: {
          type: "string",
          enum: ["ldap", "oidc", "proxyAuth", "none"],
          description:
            "Optional: Authentication method to configure (default: 'none').",
        },
        description: {
          type: "string",
          description: "Optional: Application description for the manifest.",
        },
        website: {
          type: "string",
          description: "Optional: Application website URL.",
        },
        memoryLimit: {
          type: "number",
          description:
            "Optional: Memory limit in bytes (default: 256MB = 268435456).",
        },
      },
      required: ["appType", "appName"],
    },
  },
  // ==================== Package Validation Tool ====================
  {
    name: "cloudron_validate_package",
    description:
      "Validate Cloudron package files (CloudronManifest.json, Dockerfile, start.sh) for errors and best practices. Returns detailed validation report with errors, warnings, and suggestions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        manifest: {
          type: "string",
          description:
            "Optional: Content of CloudronManifest.json file to validate.",
        },
        dockerfile: {
          type: "string",
          description: "Optional: Content of Dockerfile to validate.",
        },
        startScript: {
          type: "string",
          description: "Optional: Content of start.sh script to validate.",
        },
      },
      required: [],
    },
  },
  // ==================== Git Fetch Tool ====================
  {
    name: "cloudron_fetch_package_example",
    description:
      "Fetch real package examples from git.cloudron.io. Finds the repository for a given App Store ID and returns the content of key files (CloudronManifest.json, Dockerfile, start.sh).",
    inputSchema: {
      type: "object" as const,
      properties: {
        appId: {
          type: "string",
          description:
            "The App Store ID to fetch (e.g., 'com.electerious.ackee')",
        },
      },
      required: ["appId"],
    },
  },
]

const PACKAGING_TITLES: Record<string, string> = {
  cloudron_packaging_guide: "Packaging guide",
  cloudron_scaffold_package: "Scaffold package",
  cloudron_validate_package: "Validate package",
  cloudron_fetch_package_example: "Fetch package example",
}

export const TOOLS: ToolDefinition[] = [
  ...API_TOOLS,
  ...PACKAGING_TOOLS.map(tool => {
    const title = PACKAGING_TITLES[tool.name] ?? tool.name
    return {
      ...tool,
      annotations:
        tool.name === "cloudron_fetch_package_example"
          ? read(title)
          : offline(title),
    }
  }),
]
