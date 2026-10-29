/**
 * Full-instance backup tools
 */

import { describe, expect, it } from "vitest"
import { backupHandlers } from "../../src/tools/handlers/backups"
import {
  makeBackup,
  makeBackupSite,
  makeFilesystems,
  textOf,
  useFakeCloudron,
} from "../helpers/cloudron-fake"

describe("cloudron_list_backups", () => {
  it("lists full backups", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/backups": {
        body: {
          backups: [
            makeBackup({ id: "box-1", type: "box", identifier: "box" }),
          ],
        },
      },
    })
    const text = textOf(await backupHandlers.cloudron_list_backups({}, ctx))
    expect(text).toContain("Found 1 full backup(s)")
    expect(text).toContain("box-1")
    expect(fake.requests[0]?.query.get("per_page")).toBe("100")
  })
})

describe("cloudron_list_backup_sites", () => {
  it("lists backup sites", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/backup_sites": {
        body: { backupSites: [makeBackupSite()] },
      },
    })
    const text = textOf(
      await backupHandlers.cloudron_list_backup_sites({}, ctx),
    )
    expect(text).toContain("Hetzner storage box (site-1)")
    expect(text).toContain("Encrypted: yes")
  })
})

describe("cloudron_create_backup", () => {
  // Regression: upstream called POST /backups/create (really "edit backup
  // 'create'") after a storage check against the removed /system/disk_usage
  it("starts a full backup on the backup site", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/system/filesystems": { body: makeFilesystems(40) },
      "GET /api/v1/backup_sites": {
        body: { backupSites: [makeBackupSite()] },
      },
      "POST /api/v1/backup_sites/site-1/create_backup": {
        status: 202,
        body: { taskId: "91" },
      },
    })

    const text = textOf(await backupHandlers.cloudron_create_backup({}, ctx))

    expect(
      fake.calls("POST /api/v1/backup_sites/site-1/create_backup"),
    ).toHaveLength(1)
    expect(text).toContain("Task ID: 91")
  })

  it("does not block on a small but healthy disk (backups may go off-box)", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/system/filesystems": { body: makeFilesystems(4, 40) },
      "GET /api/v1/backup_sites": {
        body: { backupSites: [makeBackupSite()] },
      },
      "POST /api/v1/backup_sites/site-1/create_backup": {
        status: 202,
        body: { taskId: "92" },
      },
    })
    await expect(
      backupHandlers.cloudron_create_backup({}, ctx),
    ).resolves.toBeDefined()
  })

  it("blocks when the root disk is critically full", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/system/filesystems": { body: makeFilesystems(2) },
    })
    await expect(
      backupHandlers.cloudron_create_backup({}, ctx),
    ).rejects.toThrow(/critically full/)
    expect(fake.requests).toHaveLength(1)
  })
})
