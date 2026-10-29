/**
 * Updates API
 * Cloudron platform (box) update operations
 */

import { CloudronError } from "../errors.js"
import type {
  BoxUpdateInfo,
  BoxUpdateResponse,
  TaskStarted,
  ValidationResult,
} from "../types.js"
import type { HttpClient } from "./http-client.js"

/**
 * Interface for update validation (dependency injection)
 */
export interface UpdateValidator {
  validateApplyUpdate(): Promise<ValidationResult>
}

/**
 * Updates API for Cloudron platform updates
 */
export class UpdatesApi {
  constructor(
    private readonly http: HttpClient,
    private readonly validator?: UpdateValidator,
  ) {}

  /**
   * GET /api/v1/updater/box_update
   * Returns the update Cloudron's own checker found, or null when up to date.
   */
  async checkUpdates(): Promise<BoxUpdateInfo | null> {
    const response = await this.http.get<BoxUpdateResponse>(
      "/api/v1/updater/box_update",
    )
    return response.update ?? null
  }

  /**
   * POST /api/v1/updater/box_update (DESTRUCTIVE: restarts the platform)
   * @param expectedVersion - must match the pending update, so a stale
   *   confirmation cannot apply a different release
   */
  async applyUpdate(
    expectedVersion: string,
    skipBackup = false,
  ): Promise<string> {
    const update = await this.checkUpdates()
    if (!update) {
      throw new CloudronError("No platform update is available")
    }
    if (update.version !== expectedVersion) {
      throw new CloudronError(
        `Pending update is v${update.version}, not v${expectedVersion}. Re-check with cloudron_check_updates.`,
      )
    }

    if (this.validator) {
      const validation = await this.validator.validateApplyUpdate()
      if (!validation.valid) {
        throw new CloudronError(
          `Pre-flight validation failed for apply_update:\n${validation.errors.join("\n")}`,
        )
      }
    }

    const response = await this.http.post<TaskStarted>(
      "/api/v1/updater/box_update",
      { skipBackup },
    )
    if (!response?.taskId) {
      throw new CloudronError("Apply update response missing taskId")
    }
    return response.taskId
  }
}
