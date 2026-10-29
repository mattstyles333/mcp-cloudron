/**
 * Validation Service
 * Pre-flight validation for destructive operations
 * Reusable validation logic separated from API client
 */

import {
  INSTALL_DEFAULT_STORAGE_MB,
  RESTORE_MIN_STORAGE_MB,
} from "../config.js"
import { CloudronError, isCloudronError } from "../errors.js"
import type {
  App,
  AppStoreApp,
  Backup,
  BoxUpdateInfo,
  CloneAppParams,
  ManifestValidationResult,
  StorageInfo,
  User,
  ValidatableOperation,
  ValidationResult,
} from "../types.js"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Data the validation service reads (dependency injection for tests)
 */
export interface ValidationDataProvider {
  getApp(appId: string): Promise<App>
  listApps(): Promise<App[]>
  listAppBackups(appId: string): Promise<Backup[]>
  getUser(userId: string): Promise<User>
  listUsers(): Promise<User[]>
  checkStorage(requiredMB?: number): Promise<StorageInfo>
  listBackups(): Promise<Backup[]>
  checkUpdates(): Promise<BoxUpdateInfo | null>
  getAppStoreApp(appStoreId: string): Promise<AppStoreApp>
}

function emptyResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [], recommendations: [] }
}

function finish<T extends { valid: boolean; errors: string[] }>(result: T): T {
  result.valid = result.errors.length === 0
  return result
}

function isNotFound(error: unknown): boolean {
  return isCloudronError(error) && error.statusCode === 404
}

function isRecent(backup: Backup | undefined): boolean {
  return (
    backup !== undefined &&
    Date.now() - new Date(backup.creationTime).getTime() < DAY_MS
  )
}

/**
 * Validation Service for pre-flight checks on destructive operations
 */
export class ValidationService {
  constructor(private readonly dataProvider: ValidationDataProvider) {}

  /**
   * Validate a destructive operation before execution
   * @param resourceId - appId (uninstall_app, restore_app) or userId (delete_user)
   * @param backupId - required for restore_app
   */
  async validateOperation(
    operation: ValidatableOperation,
    resourceId: string,
    backupId?: string,
  ): Promise<ValidationResult> {
    if (!resourceId) {
      throw new CloudronError("resourceId is required for operation validation")
    }

    switch (operation) {
      case "uninstall_app":
        return await this.validateUninstallApp(resourceId)
      case "delete_user":
        return await this.validateDeleteUser(resourceId)
      case "restore_app":
        if (!backupId) {
          throw new CloudronError(
            "backupId is required to validate restore_app",
          )
        }
        return await this.validateRestoreOperation(resourceId, backupId)
      default:
        throw new CloudronError(
          `Invalid operation type: ${operation}. Valid options: uninstall_app, delete_user, restore_app`,
        )
    }
  }

  /**
   * Checks: app exists, app state, and whether a backup from the last day exists
   */
  async validateUninstallApp(appId: string): Promise<ValidationResult> {
    const result = emptyResult()
    try {
      const app = await this.dataProvider.getApp(appId)

      if (app.installationState !== "installed") {
        result.warnings.push(
          `App is in state '${app.installationState}', not 'installed'. Uninstall may fail or behave unexpectedly.`,
        )
      }

      const [latest] = await this.dataProvider.listAppBackups(appId)
      if (!latest) {
        result.warnings.push(
          `${app.fqdn} has no backups. Its data cannot be recovered after uninstall.`,
        )
      } else if (!isRecent(latest)) {
        result.warnings.push(
          `Newest backup of ${app.fqdn} is from ${latest.creationTime}. Changes since then will be lost.`,
        )
      }

      result.recommendations.push(
        "Run cloudron_backup_app first if the app's current data matters.",
      )
    } catch (error) {
      if (!isNotFound(error)) throw error
      result.errors.push(`App with ID '${appId}' does not exist.`)
    }
    return finish(result)
  }

  /**
   * Checks: user exists and is not the last owner
   */
  async validateDeleteUser(userId: string): Promise<ValidationResult> {
    const result = emptyResult()
    try {
      const target = await this.dataProvider.getUser(userId)

      if (target.role === "owner") {
        const owners = (await this.dataProvider.listUsers()).filter(
          u => u.role === "owner",
        )
        if (owners.length <= 1) {
          result.errors.push(
            "Cannot delete the last owner. Make another user an owner first.",
          )
        }
      }

      result.recommendations.push(
        "Consider deactivating the user instead if their data should be kept.",
      )
    } catch (error) {
      if (!isNotFound(error)) throw error
      result.errors.push(`User with ID '${userId}' does not exist.`)
    }
    return finish(result)
  }

  /**
   * Validate an App Store app before installation
   * Checks: app exists in the App Store, root disk has room
   */
  async validateManifest(
    appStoreId: string,
    requiredMB: number = INSTALL_DEFAULT_STORAGE_MB,
  ): Promise<ManifestValidationResult> {
    if (!appStoreId) {
      throw new CloudronError("appStoreId is required for manifest validation")
    }

    const result: ManifestValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    }

    try {
      const app = await this.dataProvider.getAppStoreApp(appStoreId)
      if (app.manifest.addons && "docker" in app.manifest.addons) {
        result.warnings.push(
          "This app uses the docker addon; Cloudron only lets the owner role install it, and API tokens act as admin.",
        )
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      result.errors.push(`App not found in App Store: ${appStoreId}`)
      return finish(result)
    }

    this.addStorageFindings(
      await this.dataProvider.checkStorage(requiredMB),
      requiredMB,
      "installation",
      result,
    )
    return finish(result)
  }

  /**
   * Checks: source app installed, target location free, backup belongs to the app
   */
  async validateCloneOperation(
    appId: string,
    params: CloneAppParams,
  ): Promise<ValidationResult> {
    const result = emptyResult()
    try {
      const app = await this.dataProvider.getApp(appId)
      if (app.installationState !== "installed") {
        result.errors.push(
          `Cannot clone app in state '${app.installationState}'. App must be 'installed'.`,
        )
      }

      const conflict = (await this.dataProvider.listApps()).find(
        a => a.subdomain === params.subdomain && a.domain === params.domain,
      )
      if (conflict) {
        result.errors.push(
          `${params.subdomain ? `${params.subdomain}.` : ""}${params.domain} is already used by ${conflict.manifest.title} (${conflict.id}).`,
        )
      }

      const backups = await this.dataProvider.listAppBackups(appId)
      if (!backups.some(b => b.id === params.backupId)) {
        result.errors.push(
          `Backup '${params.backupId}' is not a backup of app '${appId}'.`,
        )
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      result.errors.push(`Source app with ID '${appId}' does not exist.`)
    }
    return finish(result)
  }

  /**
   * Checks: app exists, backup belongs to the app, root disk has room
   */
  async validateRestoreOperation(
    appId: string,
    backupId: string,
  ): Promise<ValidationResult> {
    const result = emptyResult()
    try {
      const app = await this.dataProvider.getApp(appId)

      const backups = await this.dataProvider.listAppBackups(appId)
      const backup = backups.find(b => b.id === backupId)
      if (!backup) {
        result.errors.push(
          `Backup '${backupId}' is not a backup of ${app.fqdn}. Use cloudron_list_app_backups to find one.`,
        )
      } else if (backup.state !== "normal") {
        result.errors.push(
          `Backup '${backupId}' is in state '${backup.state}' and cannot be restored.`,
        )
      } else {
        result.warnings.push(
          `Current data of ${app.fqdn} will be replaced with the backup from ${backup.creationTime}.`,
        )
      }

      this.addStorageFindings(
        await this.dataProvider.checkStorage(RESTORE_MIN_STORAGE_MB),
        RESTORE_MIN_STORAGE_MB,
        "restore",
        result,
      )

      result.recommendations.push(
        "Back up the current state first if you may want to roll back.",
      )
    } catch (error) {
      if (!isNotFound(error)) throw error
      result.errors.push(`App with ID '${appId}' does not exist.`)
    }
    return finish(result)
  }

  /**
   * Checks: app exists and is installed
   */
  async validateUpdateOperation(appId: string): Promise<ValidationResult> {
    const result = emptyResult()
    try {
      const app = await this.dataProvider.getApp(appId)
      if (app.installationState !== "installed") {
        result.errors.push(
          `Cannot update app in state '${app.installationState}'. App must be 'installed'.`,
        )
      }
      if (!app.updateInfo) {
        result.warnings.push(
          "Cloudron has not recorded a pending update for this app.",
        )
      }
    } catch (error) {
      if (!isNotFound(error)) throw error
      result.errors.push(`App with ID '${appId}' does not exist.`)
    }
    return finish(result)
  }

  /**
   * Checks: an update is pending; warns when there is no full backup from the last day
   */
  async validateApplyUpdate(): Promise<ValidationResult> {
    const result = emptyResult()

    const update = await this.dataProvider.checkUpdates()
    if (!update) {
      result.errors.push("No update available. Cloudron is already up to date.")
      return finish(result)
    }

    const [latest] = await this.dataProvider.listBackups()
    if (!isRecent(latest)) {
      result.warnings.push(
        "No full backup within the last 24 hours. Cloudron backs up before updating unless skipBackup is set.",
      )
    }

    if (update.changelog?.length) {
      result.recommendations.push(
        `Review the changelog for v${update.version}:\n${update.changelog.map(line => `- ${line}`).join("\n")}`,
      )
    }

    return finish(result)
  }

  private addStorageFindings(
    storage: StorageInfo,
    requiredMB: number,
    operation: string,
    result: { errors: string[]; warnings: string[] },
  ): void {
    if (storage.critical) {
      result.errors.push(
        `CRITICAL: less than 5% disk space left (${storage.available_mb}MB free). ${operation} blocked.`,
      )
    } else if (!storage.sufficient) {
      result.errors.push(
        `Insufficient disk space for ${operation}: ${storage.available_mb}MB free, ${requiredMB}MB required.`,
      )
    } else if (storage.warning) {
      result.warnings.push(
        `Less than 10% disk space left (${storage.available_mb}MB free).`,
      )
    }
  }
}
