/**
 * App Store tool handlers
 */

import { APPSTORE_MAX_RESULTS } from "../../config.js"
import { formatAppStoreApp } from "../formatters.js"
import type { ToolRegistry } from "../registry.js"
import { textResponse } from "../response.js"
import { parseAppStoreIdArgs, parseSearchAppsArgs } from "../validators.js"

export const appstoreHandlers: ToolRegistry = {
  cloudron_search_apps: async (args, ctx) => {
    const { query } = parseSearchAppsArgs(args)
    const apps = await ctx.appstore.searchApps(query)

    if (apps.length === 0) {
      return textResponse(
        query
          ? `No apps found matching query: "${query}"`
          : "No apps available in the App Store.",
      )
    }

    const shown = apps.slice(0, APPSTORE_MAX_RESULTS)
    const more =
      apps.length > shown.length
        ? `\n\n…and ${apps.length - shown.length} more; refine the query to narrow it down.`
        : ""
    const heading = query ? `Results for "${query}"` : "App Store catalogue"

    return textResponse(
      `${heading} (${apps.length} match(es)):\n\n${shown.map(formatAppStoreApp).join("\n\n")}${more}`,
    )
  },

  cloudron_validate_manifest: async (args, ctx) => {
    const { appStoreId } = parseAppStoreIdArgs(args)
    const result = await ctx.validation.validateManifest(appStoreId)

    const warningsText =
      result.warnings.length > 0
        ? `\n\nWarnings:\n${result.warnings.map(w => `  - ${w}`).join("\n")}`
        : ""

    if (result.valid) {
      return textResponse(
        `Pre-install check passed for ${appStoreId}.${warningsText}`,
      )
    }
    return textResponse(`Pre-install check failed for ${appStoreId}:

Errors (must be resolved):
${result.errors.map(e => `  - ${e}`).join("\n")}${warningsText}`)
  },
}
