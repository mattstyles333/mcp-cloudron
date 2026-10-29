/**
 * Platform update and App Store tools
 */

import { describe, expect, it } from "vitest"
import { appstoreHandlers } from "../../src/tools/handlers/appstore"
import { updateHandlers } from "../../src/tools/handlers/updates"
import {
  makeAppStoreApp,
  makeBackup,
  makeFilesystems,
  textOf,
  useFakeCloudron,
} from "../helpers/cloudron-fake"

const pending = {
  update: {
    version: "10.1.7",
    changelog: ["Fix mail relay", "Update Node.js"],
    sourceTarballUrl: "https://releases.cloudron.io/box-10.1.7.tar.gz",
  },
}

describe("cloudron_check_updates", () => {
  // Regression: upstream read /updater/updates, which does not exist
  it("reads /updater/box_update", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/updater/box_update": { body: pending },
    })
    const text = textOf(await updateHandlers.cloudron_check_updates({}, ctx))
    expect(text).toContain("Version: 10.1.7")
    expect(text).toContain("- Fix mail relay")
    expect(text).toContain('version "10.1.7"')
  })

  it("reports no update", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/updater/box_update": { body: { update: null } },
    })
    const text = textOf(await updateHandlers.cloudron_check_updates({}, ctx))
    expect(text).toContain("Available: No")
  })
})

describe("cloudron_apply_update", () => {
  const routes = {
    "GET /api/v1/updater/box_update": { body: pending },
    "GET /api/v1/backups": { body: { backups: [makeBackup({ type: "box" })] } },
    "POST /api/v1/updater/box_update": { status: 202, body: { taskId: "101" } },
  }

  it("applies the confirmed version", async () => {
    const { ctx, fake } = useFakeCloudron(routes)
    const text = textOf(
      await updateHandlers.cloudron_apply_update({ version: "v10.1.7" }, ctx),
    )
    expect(fake.calls("POST /api/v1/updater/box_update")[0]?.body).toEqual({
      skipBackup: false,
    })
    expect(text).toContain("Task ID: 101")
  })

  it("refuses when the confirmed version is not the pending one", async () => {
    const { ctx, fake } = useFakeCloudron(routes)
    await expect(
      updateHandlers.cloudron_apply_update({ version: "10.2.0" }, ctx),
    ).rejects.toThrow(/Pending update is v10.1.7, not v10.2.0/)
    expect(fake.calls("POST /api/v1/updater/box_update")).toHaveLength(0)
  })

  it("refuses when nothing is pending", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/updater/box_update": { body: { update: null } },
    })
    await expect(
      updateHandlers.cloudron_apply_update({ version: "10.1.7" }, ctx),
    ).rejects.toThrow(/No platform update/)
  })
})

describe("cloudron_search_apps", () => {
  const catalogue = {
    apps: [
      makeAppStoreApp("org.wordpress.cloudronapp", "WordPress (Managed)", {
        tagline: "Blog and CMS",
        tags: ["blog", "cms"],
      }),
      makeAppStoreApp(
        "org.wordpress.unmanaged.cloudronapp",
        "WordPress (Developer)",
      ),
      makeAppStoreApp("io.ghost.cloudronapp", "Ghost", { tags: ["blog"] }),
      makeAppStoreApp("io.gitea.cloudronapp", "Gitea"),
    ],
  }

  // Regression: Cloudron ignores ?search, so upstream returned the whole catalogue
  it("filters and ranks locally", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/appstore/apps": { body: catalogue },
    })
    const text = textOf(
      await appstoreHandlers.cloudron_search_apps({ query: "blog" }, ctx),
    )
    expect(text).toContain("(2 match(es))")
    expect(text).toContain("Ghost")
    expect(text).toContain("WordPress (Managed)")
    expect(text).not.toContain("Gitea")
  })

  it("ranks title matches above tag matches", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/appstore/apps": { body: catalogue },
    })
    const text = textOf(
      await appstoreHandlers.cloudron_search_apps({ query: "wordpress" }, ctx),
    )
    expect(text.indexOf("1. WordPress")).toBeGreaterThan(-1)
    expect(text).not.toContain("Ghost")
  })
})

describe("cloudron_validate_manifest", () => {
  it("passes for an existing app with room on disk", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/appstore/apps/io.gitea.cloudronapp": {
        body: makeAppStoreApp("io.gitea.cloudronapp", "Gitea"),
      },
      "GET /api/v1/system/filesystems": { body: makeFilesystems(50) },
    })
    const text = textOf(
      await appstoreHandlers.cloudron_validate_manifest(
        { appStoreId: "io.gitea.cloudronapp" },
        ctx,
      ),
    )
    expect(text).toContain("Pre-install check passed")
  })

  it("fails for an unknown app", async () => {
    const { ctx } = useFakeCloudron({})
    const text = textOf(
      await appstoreHandlers.cloudron_validate_manifest(
        { appStoreId: "no.such.app" },
        ctx,
      ),
    )
    expect(text).toContain("not found in App Store")
  })
})
