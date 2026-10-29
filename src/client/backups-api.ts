/**
 * Backups API
 * Full-instance backups and backup sites (Cloudron 9+)
 */

import { CloudronError } from "../errors.js"
import type {
  Backup,
  BackupSite,
  BackupSitesResponse,
  StorageInfo,
  TaskStarted,
} from "../types.js"
import { resolveBackupSite } from "./apps-api.js"
import type { HttpClient } from "./http-client.js"

/**
 * Interface for storage checking (dependency injection)
 */
export interface StorageChecker {
  checkStorage(requiredMB?: number): Promise<StorageInfo>
}

/**
 * Backups API for Cloudron backup operations
 */
export class BackupsApi {
  constructor(
    private readonly http: HttpClient,
    private readonly storageChecker: StorageChecker,
  ) {}

  /**
   * GET /api/v1/backups: completed full-instance backups, newest first.
   * App backups are listed per app (AppsApi.listAppBackups).
   */
  async listBackups(): Promise<Backup[]> {
    return await this.http.getAllPages<Backup>("/api/v1/backups", "backups")
  }

  /**
   * GET /api/v1/backup_sites
   */
  async listBackupSites(): Promise<BackupSite[]> {
    const response = await this.http.get<BackupSitesResponse>(
      "/api/v1/backup_sites",
    )
    return response.backupSites
  }

  /**
   * POST /api/v1/backup_sites/:id/create_backup
   * Blocked only when the root disk is critically full.
   */
  async createBackup(
    backupSiteId?: string,
  ): Promise<{ taskId: string; site: BackupSite }> {
    const storageInfo = await this.storageChecker.checkStorage()
    if (storageInfo.critical) {
      throw new CloudronError(
        `Root disk is critically full (${storageInfo.available_mb}MB free). Free space before backing up.`,
      )
    }

    const site = resolveBackupSite(await this.listBackupSites(), backupSiteId)

    const response = await this.http.post<TaskStarted>(
      `/api/v1/backup_sites/${encodeURIComponent(site.id)}/create_backup`,
    )
    if (!response?.taskId) {
      throw new CloudronError("Backup creation response missing taskId")
    }
    return { taskId: response.taskId, site }
  }
}
