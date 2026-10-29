/**
 * Apps API
 * App management operations
 */

import { CloudronError } from "../errors.js"
import type {
  App,
  AppConfig,
  AppsResponse,
  Backup,
  BackupSite,
  BackupSitesResponse,
  CloneAppParams,
  ConfigureResult,
  InstallAppParams,
  ManifestValidationResult,
  StorageInfo,
  TaskStarted,
  ValidationResult,
} from "../types.js"
import type { HttpClient } from "./http-client.js"

/**
 * Interface for storage checking (dependency injection)
 */
export interface AppsStorageChecker {
  checkStorage(requiredMB?: number): Promise<StorageInfo>
}

/**
 * Interface for app validation (dependency injection)
 */
export interface AppsValidator {
  validateOperation(
    operation: "uninstall_app",
    resourceId: string,
  ): Promise<ValidationResult>
  validateManifest(appStoreId: string): Promise<ManifestValidationResult>
  validateCloneOperation(
    appId: string,
    params: CloneAppParams,
  ): Promise<ValidationResult>
  validateRestoreOperation(
    appId: string,
    backupId: string,
  ): Promise<ValidationResult>
  validateUpdateOperation(appId: string): Promise<ValidationResult>
}

export interface UpdateAppOptions {
  version?: string
  force?: boolean
  skipBackup?: boolean
}

export interface CloneAppOptions {
  subdomain: string
  domain?: string
  backupId?: string
  ports?: Record<string, number>
}

function appPath(appId: string, suffix = ""): string {
  if (!appId) {
    throw new CloudronError("appId is required")
  }
  return `/api/v1/apps/${encodeURIComponent(appId)}${suffix}`
}

function assertValid(
  operation: string,
  validation: { valid: boolean; errors: string[] },
): void {
  if (!validation.valid) {
    throw new CloudronError(
      `Pre-flight validation failed for ${operation}:\n${validation.errors.join("\n")}`,
    )
  }
}

/**
 * Pick the backup site to use. Explicit choice wins; otherwise only an
 * unambiguous single site is used.
 */
export function resolveBackupSite(
  sites: BackupSite[],
  backupSiteId?: string,
): BackupSite {
  if (backupSiteId) {
    const site = sites.find(s => s.id === backupSiteId)
    if (!site) {
      throw new CloudronError(
        `Backup site '${backupSiteId}' not found. Available: ${sites.map(s => `${s.name} (${s.id})`).join(", ") || "none"}`,
      )
    }
    return site
  }

  const [only] = sites
  if (only && sites.length === 1) return only

  if (sites.length === 0) {
    throw new CloudronError("No backup sites are configured on this Cloudron")
  }
  throw new CloudronError(
    `Several backup sites are configured; pass backupSiteId. Available: ${sites.map(s => `${s.name} (${s.id})`).join(", ")}`,
  )
}

/**
 * Apps API for Cloudron app management
 */
export class AppsApi {
  constructor(
    private readonly http: HttpClient,
    private readonly storageChecker: AppsStorageChecker,
    private readonly validator?: AppsValidator,
  ) {}

  /**
   * GET /api/v1/apps
   */
  async listApps(): Promise<App[]> {
    const response = await this.http.get<AppsResponse>("/api/v1/apps")
    return response.apps
  }

  /**
   * GET /api/v1/apps/:id (returns the app object directly)
   */
  async getApp(appId: string): Promise<App> {
    return await this.http.get<App>(appPath(appId))
  }

  async startApp(appId: string): Promise<TaskStarted> {
    return await this.http.post<TaskStarted>(appPath(appId, "/start"))
  }

  async stopApp(appId: string): Promise<TaskStarted> {
    return await this.http.post<TaskStarted>(appPath(appId, "/stop"))
  }

  async restartApp(appId: string): Promise<TaskStarted> {
    return await this.http.post<TaskStarted>(appPath(appId, "/restart"))
  }

  /**
   * Apply settings through the per-setting endpoints
   * (POST /api/v1/apps/:id/configure/<setting>).
   *
   * - Cloudron replaces the whole env map, so env changes are merged into the
   *   current values first.
   * - env and memoryLimit each start a task that locks the app until it
   *   finishes, so only one of them is accepted per call, and it is sent
   *   after the instant settings.
   * - Settings are applied one at a time; if one fails, the error says which
   *   were already applied.
   */
  async configureApp(
    appId: string,
    config: AppConfig,
  ): Promise<ConfigureResult[]> {
    if (Object.keys(config).length === 0) {
      throw new CloudronError("config object cannot be empty")
    }
    if (config.env !== undefined && config.memoryLimit !== undefined) {
      throw new CloudronError(
        "env and memoryLimit each restart the app through a task, and Cloudron locks the app until that task finishes. Change them in separate calls, waiting for the first task (cloudron_task_status). No settings were changed.",
      )
    }

    const steps: Array<{
      setting: ConfigureResult["setting"]
      path: string
      body: unknown
    }> = []
    const add = (
      setting: ConfigureResult["setting"],
      path: string,
      body: unknown,
    ) => steps.push({ setting, path: appPath(appId, path), body })

    if (config.accessRestriction !== undefined) {
      add("accessRestriction", "/configure/access_restriction", {
        accessRestriction: config.accessRestriction,
      })
    }
    if (config.label !== undefined) {
      add("label", "/configure/label", { label: config.label })
    }
    if (config.tags !== undefined) {
      add("tags", "/configure/tags", { tags: config.tags })
    }
    if (config.enableAutomaticUpdate !== undefined) {
      add("enableAutomaticUpdate", "/configure/automatic_update", {
        enable: config.enableAutomaticUpdate,
      })
    }
    if (config.enableBackup !== undefined) {
      add("enableBackup", "/configure/automatic_backup", {
        enable: config.enableBackup,
      })
    }
    if (config.memoryLimit !== undefined) {
      add("memoryLimit", "/configure/memory_limit", {
        memoryLimit: config.memoryLimit,
      })
    }
    if (config.env !== undefined) {
      const app = await this.getApp(appId)
      if (!app.env) {
        // Cloudron only returns env to admins; merging into {} would wipe it
        throw new CloudronError(
          `Cannot read the current environment of '${appId}' (token lacks admin access), so it cannot be merged safely. No settings were changed.`,
        )
      }
      const env: Record<string, string> = { ...app.env }
      for (const [key, value] of Object.entries(config.env)) {
        if (value === null) delete env[key]
        else env[key] = value
      }
      add("env", "/configure/env", { env })
    }

    const results: ConfigureResult[] = []
    for (const step of steps) {
      try {
        const response = await this.http.post<Partial<TaskStarted> | undefined>(
          step.path,
          step.body,
        )
        results.push(
          response?.taskId
            ? { setting: step.setting, taskId: response.taskId }
            : { setting: step.setting },
        )
      } catch (error) {
        if (results.length === 0) throw error
        const message = error instanceof Error ? error.message : String(error)
        throw new CloudronError(
          `Setting ${step.setting} failed: ${message}. Already applied: ${results.map(r => r.setting).join(", ")}.`,
          { cause: error },
        )
      }
    }
    return results
  }

  /**
   * POST /api/v1/apps/:id/uninstall (DESTRUCTIVE)
   */
  async uninstallApp(appId: string): Promise<TaskStarted> {
    if (this.validator) {
      assertValid(
        `uninstall_app on '${appId}'`,
        await this.validator.validateOperation("uninstall_app", appId),
      )
    }
    return await this.http.post<TaskStarted>(appPath(appId, "/uninstall"))
  }

  /**
   * POST /api/v1/apps
   * @returns new app id and the install task id
   */
  async installApp(
    params: InstallAppParams,
  ): Promise<{ id: string; taskId: string }> {
    if (!params.appStoreId) {
      throw new CloudronError("appStoreId is required for app installation")
    }

    if (this.validator) {
      const validation = await this.validator.validateManifest(
        params.appStoreId,
      )
      assertValid(`install of ${params.appStoreId}`, validation)
    }

    const response = await this.http.post<{ id: string; taskId: string }>(
      "/api/v1/apps",
      params,
    )
    if (!response?.taskId) {
      throw new CloudronError("App installation response missing taskId")
    }
    return response
  }

  /**
   * POST /api/v1/apps/:id/clone
   * Cloudron clones from a backup. Without backupId the newest backup is
   * used, and without domain the source app's domain is used.
   */
  async cloneApp(
    appId: string,
    options: CloneAppOptions,
  ): Promise<{ id: string; taskId: string; backupId: string }> {
    let { domain, backupId } = options
    if (!domain) {
      domain = (await this.getApp(appId)).domain
    }
    if (!backupId) {
      const [latest] = await this.http
        .get<{ backups: Backup[] }>(appPath(appId, "/backups"), {
          query: { page: 1, per_page: 1 },
        })
        .then(r => r.backups)
      if (!latest) {
        throw new CloudronError(
          `App '${appId}' has no backups to clone from. Run cloudron_backup_app first.`,
        )
      }
      backupId = latest.id
    }

    const params: CloneAppParams = {
      subdomain: options.subdomain,
      domain,
      backupId,
      ...(options.ports && { ports: options.ports }),
    }

    if (this.validator) {
      assertValid(
        "clone",
        await this.validator.validateCloneOperation(appId, params),
      )
    }

    const response = await this.http.post<{ id: string; taskId: string }>(
      appPath(appId, "/clone"),
      params,
    )
    if (!response?.taskId) {
      throw new CloudronError("Clone response missing taskId")
    }
    return { ...response, backupId }
  }

  /**
   * POST /api/v1/apps/:id/repair
   */
  async repairApp(appId: string): Promise<string> {
    const response = await this.http.post<TaskStarted>(
      appPath(appId, "/repair"),
    )
    if (!response?.taskId) {
      throw new CloudronError("Repair response missing taskId")
    }
    return response.taskId
  }

  /**
   * POST /api/v1/apps/:id/restore (DESTRUCTIVE: replaces current app data)
   */
  async restoreApp(appId: string, backupId: string): Promise<string> {
    if (!backupId) {
      throw new CloudronError("backupId is required for restore")
    }

    if (this.validator) {
      assertValid(
        "restore",
        await this.validator.validateRestoreOperation(appId, backupId),
      )
    }

    const response = await this.http.post<TaskStarted>(
      appPath(appId, "/restore"),
      { backupId },
    )
    if (!response?.taskId) {
      throw new CloudronError("Restore response missing taskId")
    }
    return response.taskId
  }

  /**
   * POST /api/v1/apps/:id/update
   * Cloudron needs the App Store id; a version is selected with id@version.
   */
  async updateApp(
    appId: string,
    options: UpdateAppOptions = {},
  ): Promise<{ taskId: string; target: string }> {
    if (this.validator) {
      assertValid("update", await this.validator.validateUpdateOperation(appId))
    }

    const app = await this.getApp(appId)
    if (!app.appStoreId) {
      throw new CloudronError(
        `App '${appId}' was not installed from the App Store; update it with the Cloudron CLI instead.`,
      )
    }

    const target = options.version
      ? `${app.appStoreId}@${options.version}`
      : app.appStoreId

    const response = await this.http.post<TaskStarted>(
      appPath(appId, "/update"),
      {
        appStoreId: target,
        ...(options.force !== undefined && { force: options.force }),
        ...(options.skipBackup !== undefined && {
          skipBackup: options.skipBackup,
        }),
      },
    )
    if (!response?.taskId) {
      throw new CloudronError("Update response missing taskId")
    }
    return { taskId: response.taskId, target }
  }

  /**
   * GET /api/v1/apps/:id/backups (newest first)
   */
  async listAppBackups(appId: string): Promise<Backup[]> {
    return await this.http.getAllPages<Backup>(
      appPath(appId, "/backups"),
      "backups",
    )
  }

  /**
   * GET /api/v1/apps/:id/backup_sites
   */
  async listAppBackupSites(appId: string): Promise<BackupSite[]> {
    const response = await this.http.get<BackupSitesResponse>(
      appPath(appId, "/backup_sites"),
    )
    return response.backupSites
  }

  /**
   * POST /api/v1/apps/:id/backup (needs a backup site since Cloudron 9)
   * Blocked only when the root disk is critically full.
   */
  async backupApp(
    appId: string,
    backupSiteId?: string,
  ): Promise<{ taskId: string; site: BackupSite }> {
    const storageInfo = await this.storageChecker.checkStorage()
    if (storageInfo.critical) {
      throw new CloudronError(
        `Root disk is critically full (${storageInfo.available_mb}MB free). Free space before backing up.`,
      )
    }

    const site = resolveBackupSite(
      await this.listAppBackupSites(appId),
      backupSiteId,
    )

    const response = await this.http.post<TaskStarted>(
      appPath(appId, "/backup"),
      { backupSiteId: site.id },
    )
    if (!response?.taskId) {
      throw new CloudronError("App backup response missing taskId")
    }
    return { taskId: response.taskId, site }
  }
}
