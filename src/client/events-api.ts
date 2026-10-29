/**
 * Events API
 * Audit event log and dashboard notifications
 */

import { CloudronError } from "../errors.js"
import type { EventLogEntry, Notification } from "../types.js"
import type { HttpClient } from "./http-client.js"

export interface EventLogFilter {
  appId?: string // limit to one app (GET /api/v1/apps/:id/eventlog)
  actions?: string[] // e.g. ["app.update", "backup.finish"]
  search?: string
  from?: string // ISO 8601
  to?: string // ISO 8601
  limit: number
}

export class EventsApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/eventlog, newest first. With appId this reads
   * /api/v1/apps/:id/eventlog, which only filters by date server-side, so
   * actions and search are applied to the returned page here.
   */
  async listEventLog(filter: EventLogFilter): Promise<EventLogEntry[]> {
    const dates = { from: filter.from, to: filter.to }

    if (!filter.appId) {
      const response = await this.http.get<{ eventlogs: EventLogEntry[] }>(
        "/api/v1/eventlog",
        {
          query: {
            page: 1,
            per_page: filter.limit,
            actions: filter.actions?.length
              ? filter.actions.join(",")
              : undefined,
            search: filter.search,
            ...dates,
          },
        },
      )
      return response.eventlogs ?? []
    }

    const response = await this.http.get<{ eventlogs: EventLogEntry[] }>(
      `/api/v1/apps/${encodeURIComponent(filter.appId)}/eventlog`,
      { query: { page: 1, per_page: filter.limit, ...dates } },
    )
    const search = filter.search?.toLowerCase()
    return (response.eventlogs ?? []).filter(
      entry =>
        (!filter.actions?.length || filter.actions.includes(entry.action)) &&
        (!search || JSON.stringify(entry).toLowerCase().includes(search)),
    )
  }

  /**
   * GET /api/v1/notifications
   */
  async listNotifications(
    acknowledged: boolean | undefined,
    limit: number,
  ): Promise<Notification[]> {
    const response = await this.http.get<{ notifications: Notification[] }>(
      "/api/v1/notifications",
      { query: { page: 1, per_page: limit, acknowledged } },
    )
    return response.notifications ?? []
  }

  /**
   * POST /api/v1/notifications/:id (204)
   */
  async acknowledgeNotification(notificationId: string): Promise<void> {
    if (!notificationId) {
      throw new CloudronError("notificationId is required")
    }
    await this.http.post(
      `/api/v1/notifications/${encodeURIComponent(notificationId)}`,
      { acknowledged: true },
    )
  }
}
