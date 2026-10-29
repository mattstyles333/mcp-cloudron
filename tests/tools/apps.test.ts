/**
 * App tools against the route-checked fake Cloudron
 */

import { describe, expect, it } from "vitest"
import { appHandlers } from "../../src/tools/handlers/apps"
import {
  makeApp,
  makeAppStoreApp,
  makeBackup,
  makeBackupSite,
  makeFilesystems,
  textOf,
  useFakeCloudron,
} from "../helpers/cloudron-fake"

const app = makeApp()

describe("cloudron_list_apps / cloudron_get_app", () => {
  it("lists apps with pending updates and errors", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/apps": {
        body: {
          apps: [
            app,
            makeApp({
              id: "app-2",
              fqdn: "files.example.com",
              manifest: { id: "x", title: "Nextcloud", version: "1.0.0" },
              updateInfo: { manifest: { version: "1.1.0" } },
              installationState: "error",
              error: { message: "Addon mysql failed" },
            }),
          ],
        },
      },
    })

    const text = textOf(await appHandlers.cloudron_list_apps({}, ctx))
    expect(text).toContain("Found 2 apps")
    expect(text).toContain("WordPress (blog.example.com)")
    expect(text).toContain("Update available: 1.1.0")
    expect(text).toContain("Error: Addon mysql failed")
  })

  it("hides environment variable values", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: app },
    })
    const text = textOf(
      await appHandlers.cloudron_get_app({ appId: "app-1" }, ctx),
    )
    expect(text).toContain("EXISTING, SECRET_KEY")
    expect(text).not.toContain("s3cr3t")
    expect(text).toContain("Access: all Cloudron users")
  })
})

describe("cloudron_control_app", () => {
  it.each(["start", "stop", "restart"] as const)("%s", async action => {
    const { ctx, fake } = useFakeCloudron({
      [`POST /api/v1/apps/app-1/${action}`]: {
        status: 202,
        body: { taskId: "7" },
      },
    })
    const text = textOf(
      await appHandlers.cloudron_control_app({ appId: "app-1", action }, ctx),
    )
    expect(text).toContain("Task ID: 7")
    expect(fake.requests).toHaveLength(1)
  })
})

describe("cloudron_configure_app", () => {
  // Regression: upstream sent PUT /apps/:id/configure, which does not exist
  it("uses the per-setting endpoints, merges env, and sends it last", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: app },
      "POST /api/v1/apps/app-1/configure/env": {
        status: 202,
        body: { taskId: "11" },
      },
      "POST /api/v1/apps/app-1/configure/access_restriction": { body: {} },
      "POST /api/v1/apps/app-1/configure/label": { body: {} },
    })

    const text = textOf(
      await appHandlers.cloudron_configure_app(
        {
          appId: "app-1",
          config: {
            env: { NEW: "1", SECRET_KEY: null },
            accessRestriction: { groups: ["g-ops"] },
            label: "Blog",
          },
        },
        ctx,
      ),
    )

    expect(
      fake.calls("POST /api/v1/apps/app-1/configure/env")[0]?.body,
    ).toEqual({ env: { EXISTING: "keep", NEW: "1" } })
    expect(
      fake.calls("POST /api/v1/apps/app-1/configure/access_restriction")[0]
        ?.body,
    ).toEqual({ accessRestriction: { groups: ["g-ops"] } })
    // the task-starting setting goes last, after the instant ones
    expect(fake.requests.at(-1)?.path).toBe("/api/v1/apps/app-1/configure/env")
    expect(text).toContain("env (1 set, 1 removed): task 11")
    expect(text).toContain("label: applied")
  })

  // Regression: upstream documented MB but sent the number as bytes
  it("converts the memory limit from MB to bytes", async () => {
    const { ctx, fake } = useFakeCloudron({
      "POST /api/v1/apps/app-1/configure/memory_limit": {
        status: 202,
        body: { taskId: "12" },
      },
    })
    const text = textOf(
      await appHandlers.cloudron_configure_app(
        { appId: "app-1", config: { memoryLimit: 512 } },
        ctx,
      ),
    )
    expect(
      fake.calls("POST /api/v1/apps/app-1/configure/memory_limit")[0]?.body,
    ).toEqual({ memoryLimit: 512 * 1024 * 1024 })
    expect(text).toContain("memoryLimit (512.0 MB): task 12")
  })

  // Cloudron locks the app while the first task runs ("Locked by task")
  it("refuses env and memoryLimit in one call", async () => {
    const { ctx, fake } = useFakeCloudron({})
    await expect(
      appHandlers.cloudron_configure_app(
        { appId: "app-1", config: { env: { A: "1" }, memoryLimit: 512 } },
        ctx,
      ),
    ).rejects.toThrow(/separate calls/)
    expect(fake.requests).toHaveLength(0)
  })

  it("says which settings were applied before a failure", async () => {
    const { ctx } = useFakeCloudron({
      "POST /api/v1/apps/app-1/configure/label": { body: {} },
      "POST /api/v1/apps/app-1/configure/memory_limit": {
        status: 409,
        body: { message: "Locked by task 9" },
      },
    })
    await expect(
      appHandlers.cloudron_configure_app(
        { appId: "app-1", config: { label: "Blog", memoryLimit: 256 } },
        ctx,
      ),
    ).rejects.toThrow(
      /memoryLimit failed: Locked by task 9.*Already applied: label/,
    )
  })

  it("refuses to overwrite env it cannot read", async () => {
    const { env: _hidden, ...withoutEnv } = app
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: withoutEnv },
    })
    await expect(
      appHandlers.cloudron_configure_app(
        { appId: "app-1", config: { env: { NEW: "1" } } },
        ctx,
      ),
    ).rejects.toThrow(/cannot be merged safely/)
    expect(fake.calls("POST /api/v1/apps/app-1/configure/env")).toHaveLength(0)
  })

  it("rejects unknown settings before calling Cloudron", async () => {
    const { ctx, fake } = useFakeCloudron({})
    await expect(
      appHandlers.cloudron_configure_app(
        { appId: "app-1", config: { cpu: 2 } },
        ctx,
      ),
    ).rejects.toThrow(/Unsupported config field/)
    expect(fake.requests).toHaveLength(0)
  })
})

describe("cloudron_install_app", () => {
  // Regression: upstream sent location/portBindings and a string accessRestriction
  it("sends Cloudron's field names", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/appstore/apps/io.gitea.cloudronapp": {
        body: makeAppStoreApp("io.gitea.cloudronapp", "Gitea"),
      },
      "GET /api/v1/system/filesystems": { body: makeFilesystems(50) },
      "POST /api/v1/apps": {
        status: 202,
        body: { id: "new-app", taskId: "21" },
      },
    })

    const text = textOf(
      await appHandlers.cloudron_install_app(
        {
          appStoreId: "io.gitea.cloudronapp@1.2.0",
          subdomain: "git",
          domain: "example.com",
          ports: { SSH_PORT: 2222 },
          memoryLimit: 256,
        },
        ctx,
      ),
    )

    expect(fake.calls("POST /api/v1/apps")[0]?.body).toEqual({
      appStoreId: "io.gitea.cloudronapp@1.2.0",
      subdomain: "git",
      domain: "example.com",
      accessRestriction: null,
      ports: { SSH_PORT: 2222 },
      memoryLimit: 256 * 1024 * 1024,
    })
    expect(text).toContain("App ID: new-app")
    expect(text).toContain("git.example.com")
  })

  it("stops when the app is not in the App Store", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/system/filesystems": { body: makeFilesystems(50) },
    })
    await expect(
      appHandlers.cloudron_install_app(
        { appStoreId: "no.such.app", subdomain: "x", domain: "example.com" },
        ctx,
      ),
    ).rejects.toThrow(/not found in App Store/)
    expect(fake.calls("POST /api/v1/apps")).toHaveLength(0)
  })

  it("stops when the root disk is nearly full", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/appstore/apps/io.gitea.cloudronapp": {
        body: makeAppStoreApp("io.gitea.cloudronapp", "Gitea"),
      },
      "GET /api/v1/system/filesystems": { body: makeFilesystems(3) },
    })
    await expect(
      appHandlers.cloudron_install_app(
        {
          appStoreId: "io.gitea.cloudronapp",
          subdomain: "git",
          domain: "example.com",
        },
        ctx,
      ),
    ).rejects.toThrow(/CRITICAL/)
    expect(fake.calls("POST /api/v1/apps")).toHaveLength(0)
  })
})

describe("cloudron_clone_app", () => {
  // Regression: upstream sent location, and treated backupId/domain as optional
  it("defaults to the newest backup and the source domain", async () => {
    const backup = makeBackup()
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: app },
      "GET /api/v1/apps": { body: { apps: [app] } },
      "GET /api/v1/apps/app-1/backups": { body: { backups: [backup] } },
      "POST /api/v1/apps/app-1/clone": {
        status: 201,
        body: { id: "clone-1", taskId: "31" },
      },
    })

    const text = textOf(
      await appHandlers.cloudron_clone_app(
        { appId: "app-1", subdomain: "blog-staging" },
        ctx,
      ),
    )

    expect(fake.calls("POST /api/v1/apps/app-1/clone")[0]?.body).toEqual({
      subdomain: "blog-staging",
      domain: "example.com",
      backupId: backup.id,
    })
    expect(text).toContain("New app ID: clone-1")
  })

  it("refuses a location that is already taken", async () => {
    const backup = makeBackup()
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: app },
      "GET /api/v1/apps": { body: { apps: [app] } },
      "GET /api/v1/apps/app-1/backups": { body: { backups: [backup] } },
    })
    await expect(
      appHandlers.cloudron_clone_app(
        { appId: "app-1", subdomain: "blog", backupId: backup.id },
        ctx,
      ),
    ).rejects.toThrow(/already used/)
    expect(fake.calls("POST /api/v1/apps/app-1/clone")).toHaveLength(0)
  })

  it("explains when there is no backup to clone from", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: app },
      "GET /api/v1/apps/app-1/backups": { body: { backups: [] } },
    })
    await expect(
      appHandlers.cloudron_clone_app(
        { appId: "app-1", subdomain: "copy" },
        ctx,
      ),
    ).rejects.toThrow(/no backups to clone from/)
  })
})

describe("cloudron_repair_app", () => {
  it("starts a repair task", async () => {
    const { ctx } = useFakeCloudron({
      "POST /api/v1/apps/app-1/repair": { status: 202, body: { taskId: "41" } },
    })
    const text = textOf(
      await appHandlers.cloudron_repair_app({ appId: "app-1" }, ctx),
    )
    expect(text).toContain("Task ID: 41")
  })
})

describe("cloudron_update_app", () => {
  // Regression: upstream sent { manifest: { version } } which Cloudron rejects
  it("sends appStoreId@version", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/apps/app-1": {
        body: makeApp({ updateInfo: { manifest: { version: "3.22.0" } } }),
      },
      "POST /api/v1/apps/app-1/update": { status: 202, body: { taskId: "51" } },
    })

    const text = textOf(
      await appHandlers.cloudron_update_app(
        { appId: "app-1", version: "v3.22.0" },
        ctx,
      ),
    )

    expect(fake.calls("POST /api/v1/apps/app-1/update")[0]?.body).toEqual({
      appStoreId: "org.wordpress.cloudronapp@3.22.0",
    })
    expect(text).toContain("Task ID: 51")
  })

  it("updates to latest by default", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: app },
      "POST /api/v1/apps/app-1/update": { status: 202, body: { taskId: "52" } },
    })
    await appHandlers.cloudron_update_app({ appId: "app-1", force: true }, ctx)
    expect(fake.calls("POST /api/v1/apps/app-1/update")[0]?.body).toEqual({
      appStoreId: "org.wordpress.cloudronapp",
      force: true,
    })
  })

  it("refuses custom (non App Store) apps", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: makeApp({ appStoreId: "" }) },
    })
    await expect(
      appHandlers.cloudron_update_app({ appId: "app-1" }, ctx),
    ).rejects.toThrow(/not installed from the App Store/)
  })
})

describe("cloudron_backup_app", () => {
  // Regression: Cloudron 9+ requires backupSiteId
  it("uses the only backup site", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/system/filesystems": { body: makeFilesystems(50) },
      "GET /api/v1/apps/app-1/backup_sites": {
        body: { backupSites: [makeBackupSite()] },
      },
      "POST /api/v1/apps/app-1/backup": { status: 202, body: { taskId: "61" } },
    })

    const text = textOf(
      await appHandlers.cloudron_backup_app({ appId: "app-1" }, ctx),
    )

    expect(fake.calls("POST /api/v1/apps/app-1/backup")[0]?.body).toEqual({
      backupSiteId: "site-1",
    })
    expect(text).toContain("Hetzner storage box (site-1)")
  })

  it("asks which site when there are several", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/system/filesystems": { body: makeFilesystems(50) },
      "GET /api/v1/apps/app-1/backup_sites": {
        body: {
          backupSites: [
            makeBackupSite(),
            makeBackupSite({ id: "site-2", name: "S3" }),
          ],
        },
      },
    })
    await expect(
      appHandlers.cloudron_backup_app({ appId: "app-1" }, ctx),
    ).rejects.toThrow(/pass backupSiteId.*S3 \(site-2\)/)
  })

  it("uses the requested site", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/system/filesystems": { body: makeFilesystems(50) },
      "GET /api/v1/apps/app-1/backup_sites": {
        body: {
          backupSites: [
            makeBackupSite(),
            makeBackupSite({ id: "site-2", name: "S3" }),
          ],
        },
      },
      "POST /api/v1/apps/app-1/backup": { status: 202, body: { taskId: "62" } },
    })
    await appHandlers.cloudron_backup_app(
      { appId: "app-1", backupSiteId: "site-2" },
      ctx,
    )
    expect(fake.calls("POST /api/v1/apps/app-1/backup")[0]?.body).toEqual({
      backupSiteId: "site-2",
    })
  })
})

describe("cloudron_list_app_backups", () => {
  it("lists every page of an app's backups", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/apps/app-1/backups": {
        body: { backups: [makeBackup(), makeBackup({ id: "older" })] },
      },
    })
    const text = textOf(
      await appHandlers.cloudron_list_app_backups({ appId: "app-1" }, ctx),
    )
    expect(text).toContain("Found 2 backup(s)")
    expect(text).toContain("Size: 50.0 MB")
  })
})

describe("cloudron_restore_app", () => {
  const backup = makeBackup()
  const routes = {
    "GET /api/v1/apps/app-1": { body: app },
    "GET /api/v1/apps/app-1/backups": { body: { backups: [backup] } },
    "GET /api/v1/system/filesystems": { body: makeFilesystems(50) },
    "POST /api/v1/apps/app-1/restore": { status: 202, body: { taskId: "71" } },
  }

  it("restores after confirmation", async () => {
    const { ctx, fake } = useFakeCloudron(routes)
    const text = textOf(
      await appHandlers.cloudron_restore_app(
        { appId: "app-1", backupId: backup.id, confirm: "blog.example.com" },
        ctx,
      ),
    )
    expect(fake.calls("POST /api/v1/apps/app-1/restore")[0]?.body).toEqual({
      backupId: backup.id,
    })
    expect(text).toContain("Task ID: 71")
  })

  it("does nothing when the confirmation does not match", async () => {
    const { ctx, fake } = useFakeCloudron(routes)
    await expect(
      appHandlers.cloudron_restore_app(
        { appId: "app-1", backupId: backup.id, confirm: "files.example.com" },
        ctx,
      ),
    ).rejects.toThrow(/Confirmation mismatch/)
    expect(fake.calls("POST /api/v1/apps/app-1/restore")).toHaveLength(0)
  })

  // Regression: upstream looked for app backups in the full-backup list,
  // so every app restore failed validation
  it("refuses a backup that belongs to another app", async () => {
    const { ctx, fake } = useFakeCloudron(routes)
    await expect(
      appHandlers.cloudron_restore_app(
        { appId: "app-1", backupId: "other", confirm: "blog.example.com" },
        ctx,
      ),
    ).rejects.toThrow(/not a backup of blog.example.com/)
    expect(fake.calls("POST /api/v1/apps/app-1/restore")).toHaveLength(0)
  })
})

describe("cloudron_uninstall_app", () => {
  it("uninstalls after confirmation", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: app },
      "GET /api/v1/apps/app-1/backups": { body: { backups: [makeBackup()] } },
      "POST /api/v1/apps/app-1/uninstall": {
        status: 202,
        body: { taskId: "81" },
      },
    })
    const text = textOf(
      await appHandlers.cloudron_uninstall_app(
        { appId: "app-1", confirm: "BLOG.example.com " },
        ctx,
      ),
    )
    expect(fake.calls("POST /api/v1/apps/app-1/uninstall")).toHaveLength(1)
    expect(text).toContain("Task ID: 81")
  })

  it("requires the confirmation field", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/apps/app-1": { body: app },
    })
    await expect(
      appHandlers.cloudron_uninstall_app({ appId: "app-1" }, ctx),
    ).rejects.toThrow(/confirm is required/)
    expect(fake.calls("POST /api/v1/apps/app-1/uninstall")).toHaveLength(0)
  })
})
