/**
 * Status, tasks, storage, services, logs, event log, notifications, domains
 */

import { describe, expect, it } from "vitest"
import { normalizeTaskStatus } from "../../src/client/tasks-api"
import { domainHandlers } from "../../src/tools/handlers/domains"
import { logHandlers } from "../../src/tools/handlers/logs"
import { serviceHandlers } from "../../src/tools/handlers/services"
import { systemHandlers } from "../../src/tools/handlers/system"
import {
  makeApp,
  makeBackup,
  makeFilesystems,
  makeUser,
  textOf,
  useFakeCloudron,
} from "../helpers/cloudron-fake"

describe("cloudron_get_status", () => {
  it("combines version, system info and pending update", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/cloudron/status": { body: { version: "10.1.6" } },
      "GET /api/v1/system/info": {
        body: {
          info: {
            sysVendor: "Hetzner",
            productName: "vServer",
            uptimeSecs: 90000,
            rebootRequired: true,
          },
        },
      },
      "GET /api/v1/updater/box_update": {
        body: { update: { version: "10.1.7", sourceTarballUrl: "https://x" } },
      },
    })
    const text = textOf(await systemHandlers.cloudron_get_status({}, ctx))
    expect(text).toContain("Version: 10.1.6")
    expect(text).toContain("Server: Hetzner vServer")
    expect(text).toContain("Uptime: 1d 1h")
    expect(text).toContain("Reboot required: yes")
    expect(text).toContain("v10.1.7 available")
  })
})

describe("task status", () => {
  it.each([
    [{ id: "1", running: true, active: true }, "running"],
    [{ id: "1", running: false, active: true }, "pending"],
    [{ id: "1", active: false, success: true }, "success"],
    [
      { id: "1", active: false, error: { message: "boom", code: "crashed" } },
      "error",
    ],
    [
      {
        id: "1",
        active: false,
        error: { message: "stopped", code: "stopped" },
      },
      "stopped",
    ],
  ])("normalizes %j to %s", (raw, state) => {
    expect(normalizeTaskStatus(raw).state).toBe(state)
  })

  it("cloudron_task_status formats progress", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/tasks/42": {
        body: {
          id: "42",
          type: "backup",
          percent: 30,
          message: "Uploading",
          running: true,
          active: true,
        },
      },
    })
    const text = textOf(
      await systemHandlers.cloudron_task_status({ taskId: "42" }, ctx),
    )
    expect(text).toContain("State: running")
    expect(text).toContain("Progress: 30%")
  })

  // Regression: upstream sent DELETE /tasks/:id, which Cloudron does not serve
  it("cloudron_cancel_task posts to /stop and reads the task back", async () => {
    const { ctx, fake } = useFakeCloudron({
      "POST /api/v1/tasks/42/stop": { status: 204 },
      "GET /api/v1/tasks/42": {
        body: {
          id: "42",
          active: false,
          error: { message: "Task stopped", code: "stopped" },
        },
      },
    })
    const text = textOf(
      await systemHandlers.cloudron_cancel_task({ taskId: "42" }, ctx),
    )
    expect(fake.calls("POST /api/v1/tasks/42/stop")).toHaveLength(1)
    expect(text).toContain("State: stopped")
  })
})

describe("cloudron_check_storage", () => {
  // Regression: upstream read /system/disk_usage, removed in Cloudron 9
  it("reports the root filesystem from /system/filesystems", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/system/filesystems": { body: makeFilesystems(8) },
    })
    const text = textOf(
      await systemHandlers.cloudron_check_storage({ requiredMB: 10000 }, ctx),
    )
    expect(text).toContain("Storage Status (/)")
    expect(text).toContain("Available: 8192 MB")
    expect(text).toContain("Sufficient: No")
    expect(text).toContain("WARNING")
  })
})

describe("cloudron_validate_operation", () => {
  it("delete_user blocks the last owner", async () => {
    const owner = makeUser({ id: "uid-owner", role: "owner" })
    const { ctx } = useFakeCloudron({
      "GET /api/v1/users/uid-owner": { body: owner },
      "GET /api/v1/users": { body: { users: [owner, makeUser()] } },
    })
    const text = textOf(
      await systemHandlers.cloudron_validate_operation(
        { operation: "delete_user", resourceId: "uid-owner" },
        ctx,
      ),
    )
    expect(text).toContain("Valid: No")
    expect(text).toContain("last owner")
  })

  it("uninstall_app warns when the newest backup is old", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: makeApp() },
      "GET /api/v1/apps/app-1/backups": {
        body: {
          backups: [makeBackup({ creationTime: "2026-01-01T00:00:00.000Z" })],
        },
      },
    })
    const text = textOf(
      await systemHandlers.cloudron_validate_operation(
        { operation: "uninstall_app", resourceId: "app-1" },
        ctx,
      ),
    )
    expect(text).toContain("Valid: Yes")
    expect(text).toContain(
      "Newest backup of blog.example.com is from 2026-01-01",
    )
  })

  it("restore_app needs a backupId", async () => {
    const { ctx } = useFakeCloudron({})
    await expect(
      systemHandlers.cloudron_validate_operation(
        { operation: "restore_app", resourceId: "app-1" },
        ctx,
      ),
    ).rejects.toThrow(/backupId is required/)
  })
})

describe("cloudron_list_eventlog", () => {
  it("passes filters to /eventlog", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/eventlog": {
        body: {
          eventlogs: [
            {
              id: "e1",
              action: "app.update",
              source: { username: "matt", ip: "1.2.3.4" },
              data: { appId: "app-1" },
              creationTime: "2026-10-29T09:00:00.000Z",
            },
          ],
        },
      },
    })
    const text = textOf(
      await systemHandlers.cloudron_list_eventlog(
        {
          actions: ["app.update", "app.install"],
          from: "2026-10-01T00:00:00Z",
          limit: 500,
        },
        ctx,
      ),
    )
    const query = fake.requests[0]?.query
    expect(query?.get("actions")).toBe("app.update,app.install")
    expect(query?.get("from")).toBe("2026-10-01T00:00:00Z")
    expect(query?.get("per_page")).toBe("100")
    expect(text).toContain("app.update")
    expect(text).toContain("By: matt 1.2.3.4")
  })

  it("filters an app's events locally (the app route only filters by date)", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/apps/app-1/eventlog": {
        body: {
          eventlogs: [
            { id: "e1", action: "app.update", creationTime: "2026-10-29" },
            { id: "e2", action: "app.restart", creationTime: "2026-10-28" },
          ],
        },
      },
    })
    const text = textOf(
      await systemHandlers.cloudron_list_eventlog(
        { appId: "app-1", actions: ["app.restart"] },
        ctx,
      ),
    )
    expect(text).toContain("1 event(s)")
    expect(text).toContain("app.restart")
  })

  it("rejects a malformed date before calling Cloudron", async () => {
    const { ctx, fake } = useFakeCloudron({})
    await expect(
      systemHandlers.cloudron_list_eventlog({ from: "last tuesday" }, ctx),
    ).rejects.toThrow(/ISO 8601/)
    expect(fake.requests).toHaveLength(0)
  })
})

describe("notifications", () => {
  it("lists open notifications", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/notifications": {
        body: {
          notifications: [
            {
              id: "n1",
              title: "Backup failed",
              message: "Could not reach storage box",
              acknowledged: false,
              creationTime: "2026-10-29T02:00:00.000Z",
            },
          ],
        },
      },
    })
    const text = textOf(
      await systemHandlers.cloudron_list_notifications(
        { acknowledged: false },
        ctx,
      ),
    )
    expect(fake.requests[0]?.query.get("acknowledged")).toBe("false")
    expect(text).toContain("Backup failed [open]")
  })

  it("acknowledges a notification (204)", async () => {
    const { ctx, fake } = useFakeCloudron({
      "POST /api/v1/notifications/n1": { status: 204 },
    })
    const text = textOf(
      await systemHandlers.cloudron_acknowledge_notification(
        { notificationId: "n1" },
        ctx,
      ),
    )
    expect(fake.requests[0]?.body).toEqual({ acknowledged: true })
    expect(text).toContain("acknowledged")
  })
})

describe("services", () => {
  it("lists services with status, tolerating one failing status call", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/services": {
        body: {
          services: [
            { id: "mysql", name: "MySQL" },
            { id: "mail", name: "Mail" },
          ],
        },
      },
      "GET /api/v1/services/mysql": {
        body: {
          service: {
            name: "mysql",
            status: "active",
            memoryUsed: 256 * 1024 * 1024,
            memoryPercent: 25,
          },
        },
      },
      "GET /api/v1/services/mail": {
        status: 500,
        body: { message: "docker unreachable" },
      },
    })
    const text = textOf(await serviceHandlers.cloudron_list_services({}, ctx))
    expect(text).toContain("MySQL ✅")
    expect(text).toContain("Memory: 256.0 MB (25%)")
    expect(text).toMatch(
      /Mail ⚠️[\s\S]*Status: unknown[\s\S]*docker unreachable/,
    )
  })

  it("restarts a service (202, empty body)", async () => {
    const { ctx, fake } = useFakeCloudron({
      "POST /api/v1/services/mysql/restart": { status: 202 },
    })
    await serviceHandlers.cloudron_restart_service({ serviceId: "mysql" }, ctx)
    expect(fake.requests).toHaveLength(1)
  })
})

describe("cloudron_get_logs", () => {
  const ndjson = [
    '{"realtimeTimestamp":1767268800000000,"message":"Server started"}',
    '{"realtimeTimestamp":1767268801000000,"message":"Connected"}',
  ].join("\n")

  it.each([
    ["app", "/api/v1/apps/app-1/logs", "App logs"],
    ["service", "/api/v1/services/app-1/logs", "Service logs"],
    ["task", "/api/v1/tasks/app-1/logs", "Task logs"],
  ])("reads %s logs", async (type, path, label) => {
    const { ctx, fake } = useFakeCloudron({ [`GET ${path}`]: { body: ndjson } })
    const text = textOf(
      await logHandlers.cloudron_get_logs(
        { resourceId: "app-1", type, lines: 5000 },
        ctx,
      ),
    )
    expect(fake.requests[0]?.query.get("lines")).toBe("1000")
    expect(fake.requests[0]?.query.get("format")).toBe("json")
    expect(text).toContain(`${label} for app-1 (2 entries)`)
    expect(text).toContain("Server started")
  })
})

describe("cloudron_list_domains", () => {
  it("lists domains", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/domains": {
        body: {
          domains: [
            {
              domain: "example.com",
              zoneName: "example.com",
              provider: "cloudflare",
              tlsConfig: { provider: "letsencrypt-prod", wildcard: true },
            },
          ],
        },
      },
    })
    const text = textOf(await domainHandlers.cloudron_list_domains({}, ctx))
    expect(text).toContain("DNS provider: cloudflare")
    expect(text).toContain("TLS: letsencrypt-prod (wildcard)")
  })
})
