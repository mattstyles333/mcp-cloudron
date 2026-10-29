/**
 * Tasks API
 * Async task management operations
 */

import { CloudronError } from "../errors.js"
import type { TaskStatus, TaskStatusRaw } from "../types.js"
import type { HttpClient } from "./http-client.js"

/**
 * Normalize raw task status from API to our TaskStatus interface.
 * Cloudron sets `active` while a task is running or queued; once it is false
 * the task is finished and `success`/`error` say how.
 */
export function normalizeTaskStatus(raw: TaskStatusRaw): TaskStatus {
  let state: TaskStatus["state"]
  if (raw.success === true) {
    state = "success"
  } else if (raw.error) {
    state = raw.error.code === "stopped" ? "stopped" : "error"
  } else if (raw.running === true) {
    state = "running"
  } else if (raw.active === true || raw.pending === true) {
    state = "pending"
  } else {
    state = "running"
  }

  const result: TaskStatus = {
    id: String(raw.id),
    state,
    progress: raw.percent ?? 0,
    message: raw.message ?? "",
  }
  if (raw.type) result.type = raw.type
  if (raw.result !== undefined && raw.result !== null) {
    result.result = raw.result
  }

  if (raw.error) {
    const errorCode = raw.error.code?.toString()
    result.error = {
      message: raw.error.message,
      ...(errorCode !== undefined && { code: errorCode }),
    }
  }

  return result
}

function taskPath(taskId: string, suffix = ""): string {
  if (!taskId) {
    throw new CloudronError("taskId is required")
  }
  return `/api/v1/tasks/${encodeURIComponent(taskId)}${suffix}`
}

/**
 * Tasks API for managing async operations
 */
export class TasksApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/tasks/:taskId
   */
  async getTaskStatus(taskId: string): Promise<TaskStatus> {
    const raw = await this.http.get<TaskStatusRaw>(taskPath(taskId))
    return normalizeTaskStatus(raw)
  }

  /**
   * Stop a running task: POST /api/v1/tasks/:taskId/stop (204), then read
   * the task back so the caller sees its final state.
   */
  async cancelTask(taskId: string): Promise<TaskStatus> {
    await this.http.post(taskPath(taskId, "/stop"))
    return await this.getTaskStatus(taskId)
  }
}
