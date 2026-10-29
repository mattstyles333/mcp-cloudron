/**
 * Access levels, tool annotations and dispatch
 */

import { describe, expect, it, vi } from "vitest"
import { createCloudronContext } from "../src/client/index"
import { getAccessLevel } from "../src/config"
import { toolAccess, toolsForAccessLevel } from "../src/tools/access"
import { callTool } from "../src/tools/call"
import { TOOLS } from "../src/tools/definitions"
import { offlineHandlers } from "../src/tools/handlers/index"
import { makeApp, textOf, useFakeCloudron } from "./helpers/cloudron-fake"

const neverCalled = () => {
  throw new Error("context should not be created")
}

describe("CLOUDRON_ACCESS", () => {
  it("defaults to read", () => {
    expect(getAccessLevel(undefined)).toBe("read")
    expect(getAccessLevel("")).toBe("read")
  })

  it("rejects unknown levels", () => {
    expect(() => getAccessLevel("admin")).toThrow(/read, write, all/)
  })

  it("exposes more tools at each level", () => {
    const read = toolsForAccessLevel("read").map(t => t.name)
    const write = toolsForAccessLevel("write").map(t => t.name)
    const all = toolsForAccessLevel("all").map(t => t.name)

    expect(read).toContain("cloudron_list_apps")
    expect(read).not.toContain("cloudron_control_app")
    expect(write).toContain("cloudron_control_app")
    expect(write).not.toContain("cloudron_uninstall_app")
    expect(all).toHaveLength(TOOLS.length)
  })
})

describe("tool definitions", () => {
  it("have unique names", () => {
    const names = TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it("mark exactly the destructive operations as destructive", () => {
    const destructive = TOOLS.filter(t => toolAccess(t) === "destructive")
      .map(t => t.name)
      .sort()
    expect(destructive).toEqual([
      "cloudron_apply_update",
      "cloudron_delete_user",
      "cloudron_restore_app",
      "cloudron_uninstall_app",
    ])
  })

  it("make every destructive tool require a confirmation argument", () => {
    for (const tool of TOOLS.filter(t => toolAccess(t) === "destructive")) {
      const required = tool.inputSchema.required ?? []
      expect(
        required.includes("confirm") || required.includes("version"),
        tool.name,
      ).toBe(true)
    }
  })

  it("never let read-only tools claim to be destructive", () => {
    for (const tool of TOOLS) {
      if (tool.annotations.readOnlyHint) {
        expect(tool.annotations.destructiveHint, tool.name).toBe(false)
      }
    }
  })
})

describe("callTool", () => {
  it("refuses a write tool at the read level without calling Cloudron", async () => {
    const { fake } = useFakeCloudron({})
    const response = await callTool(
      "cloudron_control_app",
      { appId: "app-1", action: "stop" },
      "read",
      () => createCloudronContext(),
    )
    expect(response.isError).toBe(true)
    expect(textOf(response)).toContain("needs 'write'")
    expect(fake.requests).toHaveLength(0)
  })

  it("refuses a destructive tool at the write level", async () => {
    const response = await callTool(
      "cloudron_uninstall_app",
      { appId: "app-1", confirm: "blog.example.com" },
      "write",
      neverCalled,
    )
    expect(textOf(response)).toContain("needs 'all'")
  })

  it("runs packaging helpers without Cloudron credentials", async () => {
    const response = await callTool(
      "cloudron_packaging_guide",
      { topic: "overview" },
      "read",
      neverCalled,
    )
    expect(response.isError).not.toBe(true)
  })

  it("turns API errors into tool errors with the HTTP status", async () => {
    useFakeCloudron({})
    const response = await callTool(
      "cloudron_get_app",
      { appId: "missing" },
      "read",
      () => createCloudronContext(),
    )
    expect(response.isError).toBe(true)
    expect(textOf(response)).toMatch(
      /Not found \(GET \/api\/v1\/apps\/missing\).*HTTP 404/,
    )
  })

  it("rejects unknown tools", async () => {
    const response = await callTool("nope", {}, "all", neverCalled)
    expect(textOf(response)).toContain("Unknown tool")
  })

  // A read-only Cloudron token only allows GET; read mode must match it
  it("only sends GET requests from read-level tools", async () => {
    const methods = new Set<string>()
    global.fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        methods.add(init?.method ?? "GET")
        return new Response(JSON.stringify({}), { status: 200 })
      },
    ) as unknown as typeof fetch

    const sampleArgs = {
      appId: "app-1",
      appStoreId: "io.gitea.cloudronapp",
      userId: "uid-1",
      taskId: "1",
      resourceId: "app-1",
      operation: "uninstall_app",
      type: "app",
      query: "blog",
    }
    for (const tool of toolsForAccessLevel("read")) {
      if (offlineHandlers[tool.name]) continue
      await callTool(tool.name, sampleArgs, "read", () =>
        createCloudronContext(),
      )
    }
    expect([...methods]).toEqual(["GET"])
  })
})

describe("confirmation matching", () => {
  it("is case- and whitespace-insensitive but exact otherwise", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: makeApp() },
    })
    const response = await callTool(
      "cloudron_uninstall_app",
      { appId: "app-1", confirm: "blog.example.co" },
      "all",
      () => ctx,
    )
    expect(textOf(response)).toContain("Confirmation mismatch")
  })
})
