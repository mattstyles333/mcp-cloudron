/**
 * Read-only smoke test against a real Cloudron.
 *
 * Calls every read-level tool through the same dispatch the MCP server uses,
 * with CLOUDRON_ACCESS=read, so it is safe to run with a read-only API token.
 *
 *   CLOUDRON_BASE_URL=https://my.example.com CLOUDRON_API_TOKEN=... \
 *     pnpm test:integration tests/integration/readonly.integration.test.ts
 */

import { beforeAll, describe, expect, it } from "vitest"
import {
  type CloudronContext,
  createCloudronContext,
} from "../../src/client/context"
import { toolsForAccessLevel } from "../../src/tools/access"
import { callTool } from "../../src/tools/call"
import { offlineHandlers } from "../../src/tools/handlers/index"

const skip = !process.env.CLOUDRON_BASE_URL || !process.env.CLOUDRON_API_TOKEN

describe.runIf(!skip)("read-only tools against a live Cloudron", () => {
  let ctx: CloudronContext
  const args: Record<string, Record<string, unknown>> = {}

  beforeAll(async () => {
    ctx = createCloudronContext()
    const [apps, users] = await Promise.all([
      ctx.apps.listApps(),
      ctx.users.listUsers(),
    ])
    const app = apps.find(a => a.installationState === "installed") ?? apps[0]
    const user = users[0]

    if (app) {
      args.cloudron_get_app = { appId: app.id }
      args.cloudron_list_app_backups = { appId: app.id }
      args.cloudron_get_logs = { resourceId: app.id, type: "app", lines: 20 }
      args.cloudron_validate_operation = {
        operation: "uninstall_app",
        resourceId: app.id,
      }
      if (app.appStoreId) {
        args.cloudron_validate_manifest = { appStoreId: app.appStoreId }
      }
    }
    if (user) args.cloudron_get_user = { userId: user.id }
    args.cloudron_list_eventlog = { limit: 5 }
    args.cloudron_search_apps = { query: "wordpress" }
    args.cloudron_list_notifications = { limit: 5 }
    args.cloudron_check_storage = { requiredMB: 100 }
  })

  const readTools = toolsForAccessLevel("read").filter(
    t => !offlineHandlers[t.name],
  )

  it.each(readTools.map(t => t.name))("%s", async name => {
    const needsArgs = (
      readTools.find(t => t.name === name)?.inputSchema.required ?? []
    ).length
    const toolArgs = args[name]
    if (needsArgs && !toolArgs) {
      console.warn(`${name}: no suitable resource on this Cloudron, skipped`)
      return
    }
    if (name === "cloudron_task_status") {
      const tasks = await ctx.http.get<{ tasks: { id: string }[] }>(
        "/api/v1/tasks",
        { query: { page: 1, per_page: 1 } },
      )
      const [task] = tasks.tasks
      if (!task) return
      Object.assign(args, { [name]: { taskId: task.id } })
    }

    const response = await callTool(name, args[name] ?? {}, "read", () => ctx)
    const text = response.content.map(c => c.text).join("\n")
    expect(response.isError, text).not.toBe(true)
    // Formatting bugs show up as these words; logs and events may contain them legitimately
    if (!/logs|eventlog|notifications/.test(name)) {
      expect(text).not.toMatch(/undefined|Invalid Date|NaN/)
    }
  })
})
