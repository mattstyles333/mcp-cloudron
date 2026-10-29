/**
 * The route table used by the fake, and the upstream endpoint bugs it catches
 */

import { describe, expect, it } from "vitest"
import {
  createFakeCloudron,
  missingInVersions,
  SUPPORTED_VERSIONS,
} from "./helpers/cloudron-fake"

describe("Cloudron route fixture", () => {
  it("covers Cloudron 9 and 10", () => {
    expect(SUPPORTED_VERSIONS).toEqual(
      expect.arrayContaining(["9.0.15", "10.1.6"]),
    )
  })

  it("matches parameterised routes", () => {
    expect(missingInVersions("GET", "/api/v1/apps/abc-123")).toEqual([])
    expect(
      missingInVersions("POST", "/api/v1/apps/abc/configure/memory_limit"),
    ).toEqual([])
    expect(missingInVersions("GET", "/api/v1/backup_sites")).toEqual([])
  })

  // Every endpoint below was called by upstream mcp-cloudron 0.5.0 and does
  // not exist in Cloudron 9 or 10
  it.each([
    ["PUT", "/api/v1/apps/app-1/configure"], // configure_app
    ["DELETE", "/api/v1/tasks/42"], // cancel_task (real: POST /tasks/:id/stop)
    ["GET", "/api/v1/updater/updates"], // check_updates (real: /updater/box_update)
    ["POST", "/api/v1/updater/update"], // apply_update
    ["GET", "/api/v1/system/disk_usage"], // check_storage, backups
  ])("rejects upstream's %s %s", (method, path) => {
    expect(missingInVersions(method, path)).toEqual(SUPPORTED_VERSIONS)
  })

  // Upstream's create_backup called POST /backups/create. That is not a
  // create route: it matches POST /backups/:id (edit a backup's label) with
  // id "create", so the fake cannot reject it by path. tests/tools/backups
  // asserts the real route, POST /backup_sites/:id/create_backup.

  it("refuses to let a test mock a route Cloudron does not serve", () => {
    expect(() =>
      createFakeCloudron({ "GET /api/v1/system/disk_usage": { body: {} } }),
    ).toThrow(/does not serve/)
  })

  it("fails a request to a route Cloudron does not serve", async () => {
    const fake = createFakeCloudron({})
    await expect(
      fake.fetch("https://my.example.com/api/v1/updater/updates"),
    ).rejects.toThrow(/does not serve/)
  })
})
