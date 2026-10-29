/**
 * User-related tool handlers
 */

import { formatUser, formatUserDetails } from "../formatters.js"
import type { ToolRegistry } from "../registry.js"
import { textResponse } from "../response.js"
import {
  parseCreateUserArgs,
  parseDeleteUserArgs,
  parseUpdateUserArgs,
  parseUserIdArgs,
  requireConfirmation,
} from "../validators.js"

export const userHandlers: ToolRegistry = {
  cloudron_list_users: async (_args, ctx) => {
    const users = await ctx.users.listUsers()
    if (users.length === 0) {
      return textResponse("No users found.")
    }
    const formatted = users.map(formatUser).join("\n\n")
    return textResponse(`Found ${users.length} user(s):\n\n${formatted}`)
  },

  cloudron_create_user: async (args, ctx) => {
    const { sendInvite, ...params } = parseCreateUserArgs(args)
    const user = await ctx.users.createUser(params)

    let note = ""
    if (sendInvite) {
      await ctx.users.sendInvite(user.id, user.email)
      note = `\n\nInvite email sent to ${user.email}.`
    } else if (!params.password) {
      note =
        "\n\nNo password set: the user cannot sign in until invited (sendInvite) or given a password."
    }

    return textResponse(`User created.\n\n${formatUserDetails(user)}${note}`)
  },

  cloudron_get_user: async (args, ctx) => {
    const { userId } = parseUserIdArgs(args)
    const user = await ctx.users.getUser(userId)
    return textResponse(formatUserDetails(user))
  },

  cloudron_update_user: async (args, ctx) => {
    const { userId, ...params } = parseUpdateUserArgs(args)
    const user = await ctx.users.updateUser(userId, params)
    return textResponse(`User updated.\n\n${formatUserDetails(user)}`)
  },

  cloudron_delete_user: async (args, ctx) => {
    const { userId, confirm } = parseDeleteUserArgs(args)
    const user = await ctx.users.getUser(userId)
    requireConfirmation(confirm, user.email, "the user's email")

    await ctx.users.deleteUser(userId)
    return textResponse(`User ${user.email} (${userId}) deleted.`)
  },
}
