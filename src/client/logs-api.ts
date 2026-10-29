/**
 * Logs API
 * Log retrieval operations
 */

import { DEFAULT_LOG_LINES, MAX_LOG_LINES } from "../config.js"
import { CloudronError } from "../errors.js"
import type { LogEntry, LogType } from "../types.js"
import type { HttpClient } from "./http-client.js"
import { parseLogLine } from "./parse-log-line.js"

const LOG_ENDPOINTS: Record<LogType, string> = {
  app: "/api/v1/apps",
  service: "/api/v1/services",
  task: "/api/v1/tasks",
}

/**
 * Logs API for Cloudron log retrieval
 */
export class LogsApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * Get logs for an app, platform service or task
   * GET /api/v1/{apps|services|tasks}/:id/logs
   * @param lines - Number of lines (default 100, max 1000)
   */
  async getLogs(
    resourceId: string,
    type: LogType,
    lines: number = DEFAULT_LOG_LINES,
  ): Promise<LogEntry[]> {
    if (!resourceId) {
      throw new CloudronError("resourceId is required")
    }

    const base = LOG_ENDPOINTS[type]
    if (!base) {
      throw new CloudronError(
        `Invalid type: ${type}. Valid options: ${Object.keys(LOG_ENDPOINTS).join(", ")}`,
      )
    }

    const clampedLines = Math.max(1, Math.min(MAX_LOG_LINES, lines))

    // Logs are NDJSON text, not a JSON document
    const text = await this.http.getText(
      `${base}/${encodeURIComponent(resourceId)}/logs`,
      { query: { lines: clampedLines, format: "json" } },
    )

    return text
      .split("\n")
      .filter(line => line.trim().length > 0)
      .map(parseLogLine)
  }
}
