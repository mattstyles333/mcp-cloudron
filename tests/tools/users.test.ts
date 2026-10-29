/**
 * User and group tools
 */

import { describe, expect, it } from "vitest"
import { groupHandlers } from "../../src/tools/handlers/groups"
import { userHandlers } from "../../src/tools/handlers/users"
import { makeUser, textOf, useFakeCloudron } from "../helpers/cloudron-fake"

describe("cloudron_list_users", () => {
  it("sorts by role then email", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/users": {
        body: {
          users: [
            makeUser({ id: "u1", email: "zed@example.com" }),
            makeUser({ id: "u2", email: "amy@example.com", role: "owner" }),
            makeUser({ id: "u3", email: "bob@example.com", role: "admin" }),
          ],
        },
      },
    })
    const text = textOf(await userHandlers.cloudron_list_users({}, ctx))
    const order = ["amy@", "bob@", "zed@"].map(e => text.indexOf(e))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})

describe("cloudron_create_user", () => {
  // Regression: Cloudron answers { id } only; upstream printed undefined fields
  it("creates the user and reads it back", async () => {
    const created = makeUser({ id: "uid-new", email: "new@example.com" })
    const { ctx, fake } = useFakeCloudron({
      "POST /api/v1/users": { status: 201, body: { id: "uid-new" } },
      "GET /api/v1/users/uid-new": { body: created },
      "POST /api/v1/users/uid-new/send_invite_email": { status: 202, body: {} },
    })

    const text = textOf(
      await userHandlers.cloudron_create_user(
        { email: "new@example.com", role: "mailmanager", sendInvite: true },
        ctx,
      ),
    )

    expect(fake.calls("POST /api/v1/users")[0]?.body).toEqual({
      email: "new@example.com",
      role: "mailmanager",
    })
    expect(
      fake.calls("POST /api/v1/users/uid-new/send_invite_email")[0]?.body,
    ).toEqual({ email: "new@example.com" })
    expect(text).toContain("Email: new@example.com")
    expect(text).toContain("Invite email sent")
  })

  it("accepts any password Cloudron accepts (8-256 chars)", async () => {
    const { ctx, fake } = useFakeCloudron({
      "POST /api/v1/users": { status: 201, body: { id: "uid-new" } },
      "GET /api/v1/users/uid-new": { body: makeUser({ id: "uid-new" }) },
    })
    await userHandlers.cloudron_create_user(
      { email: "a@example.com", password: "all lowercase words" },
      ctx,
    )
    expect(fake.calls("POST /api/v1/users")).toHaveLength(1)
  })

  it("rejects a short password before calling Cloudron", async () => {
    const { ctx, fake } = useFakeCloudron({})
    await expect(
      userHandlers.cloudron_create_user(
        { email: "a@example.com", password: "short" },
        ctx,
      ),
    ).rejects.toThrow(/8 and 256/)
    expect(fake.requests).toHaveLength(0)
  })
})

describe("cloudron_update_user", () => {
  // Regression: both endpoints answer 204, which upstream reported as a network error
  it("updates profile and role, then reads the user back", async () => {
    const { ctx, fake } = useFakeCloudron({
      "POST /api/v1/users/uid-1/profile": { status: 204 },
      "PUT /api/v1/users/uid-1/role": { status: 204 },
      "GET /api/v1/users/uid-1": {
        body: makeUser({ displayName: "Alice B", role: "usermanager" }),
      },
    })

    const text = textOf(
      await userHandlers.cloudron_update_user(
        { userId: "uid-1", displayName: "Alice B", role: "usermanager" },
        ctx,
      ),
    )

    expect(fake.calls("POST /api/v1/users/uid-1/profile")[0]?.body).toEqual({
      displayName: "Alice B",
    })
    expect(fake.calls("PUT /api/v1/users/uid-1/role")[0]?.body).toEqual({
      role: "usermanager",
    })
    expect(text).toContain("Role: usermanager")
  })

  // Regression: upstream advertised password but silently ignored it
  it("says plainly that passwords cannot be set", async () => {
    const { ctx, fake } = useFakeCloudron({})
    await expect(
      userHandlers.cloudron_update_user(
        { userId: "uid-1", password: "NewPassword1" },
        ctx,
      ),
    ).rejects.toThrow(/does not let admins set another user's password/)
    expect(fake.requests).toHaveLength(0)
  })

  // Regression: upstream's role enum was admin/user/guest
  it("accepts Cloudron's real roles", async () => {
    const { ctx } = useFakeCloudron({})
    await expect(
      userHandlers.cloudron_update_user(
        { userId: "uid-1", role: "guest" },
        ctx,
      ),
    ).rejects.toThrow(/owner, admin, usermanager, mailmanager, user/)
  })
})

describe("cloudron_delete_user", () => {
  it("deletes after the email is confirmed (204)", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/users/uid-1": { body: makeUser() },
      "DELETE /api/v1/users/uid-1": { status: 204 },
    })
    const text = textOf(
      await userHandlers.cloudron_delete_user(
        { userId: "uid-1", confirm: "alice@example.com" },
        ctx,
      ),
    )
    expect(fake.calls("DELETE /api/v1/users/uid-1")).toHaveLength(1)
    expect(text).toContain("deleted")
  })

  it("does nothing on a wrong confirmation", async () => {
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/users/uid-1": { body: makeUser() },
    })
    await expect(
      userHandlers.cloudron_delete_user(
        { userId: "uid-1", confirm: "uid-1" },
        ctx,
      ),
    ).rejects.toThrow(/Confirmation mismatch/)
    expect(fake.calls("DELETE /api/v1/users/uid-1")).toHaveLength(0)
  })

  it("refuses to delete the last owner, counting every page of users", async () => {
    const owner = makeUser({
      id: "uid-owner",
      email: "o@example.com",
      role: "owner",
    })
    const many = Array.from({ length: 150 }, (_, i) =>
      makeUser({ id: `u${i}`, email: `u${i}@example.com` }),
    )
    const all = [...many, owner]
    const { ctx, fake } = useFakeCloudron({
      "GET /api/v1/users/uid-owner": { body: owner },
      "GET /api/v1/users": request => {
        const page = Number(request.query.get("page"))
        const perPage = Number(request.query.get("per_page"))
        return {
          body: { users: all.slice((page - 1) * perPage, page * perPage) },
        }
      },
    })
    await expect(
      userHandlers.cloudron_delete_user(
        { userId: "uid-owner", confirm: "o@example.com" },
        ctx,
      ),
    ).rejects.toThrow(/last owner/)
    expect(fake.calls("DELETE /api/v1/users/uid-owner")).toHaveLength(0)
  })
})

describe("groups", () => {
  it("lists groups with member counts", async () => {
    const { ctx } = useFakeCloudron({
      "GET /api/v1/groups": {
        body: {
          groups: [
            { id: "g2", name: "staff", source: "", userIds: ["u1", "u2"] },
            { id: "g1", name: "admins", source: "", userIds: [] },
          ],
        },
      },
    })
    const text = textOf(await groupHandlers.cloudron_list_groups({}, ctx))
    expect(text.indexOf("admins")).toBeLessThan(text.indexOf("staff"))
    expect(text).toContain("Members: 2")
    expect(text).not.toContain("Invalid Date")
  })

  it("creates a group", async () => {
    const { ctx, fake } = useFakeCloudron({
      "POST /api/v1/groups": { status: 201, body: { id: "g3", name: "ops" } },
    })
    const text = textOf(
      await groupHandlers.cloudron_create_group({ name: "ops" }, ctx),
    )
    expect(fake.requests[0]?.body).toEqual({ name: "ops" })
    expect(text).toContain("ID: g3")
  })
})
