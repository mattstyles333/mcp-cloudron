/**
 * Handler exports and combined registries
 */

import {
  createRegistry,
  type OfflineToolRegistry,
  type ToolRegistry,
} from "../registry.js"
import { appHandlers } from "./apps.js"
import { appstoreHandlers } from "./appstore.js"
import { backupHandlers } from "./backups.js"
import { domainHandlers } from "./domains.js"
import { gitFetchHandlers } from "./git-fetch.js"
import { groupHandlers } from "./groups.js"
import { logHandlers } from "./logs.js"
import { packageValidationHandlers } from "./package-validation.js"
import { packagingHandlers } from "./packaging.js"
import { scaffoldingHandlers } from "./scaffolding.js"
import { serviceHandlers } from "./services.js"
import { systemHandlers } from "./system.js"
import { updateHandlers } from "./updates.js"
import { userHandlers } from "./users.js"

export {
  appHandlers,
  appstoreHandlers,
  backupHandlers,
  domainHandlers,
  gitFetchHandlers,
  groupHandlers,
  logHandlers,
  packageValidationHandlers,
  packagingHandlers,
  scaffoldingHandlers,
  serviceHandlers,
  systemHandlers,
  updateHandlers,
  userHandlers,
}

/**
 * Tools that call the Cloudron API (need CLOUDRON_BASE_URL and CLOUDRON_API_TOKEN)
 */
export const apiHandlers: ToolRegistry = createRegistry<ToolRegistry[string]>(
  appHandlers,
  appstoreHandlers,
  backupHandlers,
  domainHandlers,
  groupHandlers,
  logHandlers,
  serviceHandlers,
  systemHandlers,
  updateHandlers,
  userHandlers,
)

/**
 * Packaging helpers that work without Cloudron credentials
 */
export const offlineHandlers: OfflineToolRegistry = createRegistry<
  OfflineToolRegistry[string]
>(
  gitFetchHandlers,
  packageValidationHandlers,
  packagingHandlers,
  scaffoldingHandlers,
)
