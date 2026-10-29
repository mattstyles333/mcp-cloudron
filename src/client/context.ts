/**
 * Cloudron Context
 * Container for all API modules
 */

import { ValidationService } from "../validation/validation-service.js"
import { AppsApi } from "./apps-api.js"
import { AppStoreApi } from "./appstore-api.js"
import { BackupsApi } from "./backups-api.js"
import { EventsApi } from "./events-api.js"
import { GroupsApi } from "./groups-api.js"
import { HttpClient } from "./http-client.js"
import { LogsApi } from "./logs-api.js"
import { SystemApi } from "./system-api.js"
import { TasksApi } from "./tasks-api.js"
import { UpdatesApi } from "./updates-api.js"
import { UsersApi } from "./users-api.js"

/**
 * Context containing all Cloudron API modules, passed to tool handlers
 */
export interface CloudronContext {
  http: HttpClient
  apps: AppsApi
  appstore: AppStoreApi
  backups: BackupsApi
  events: EventsApi
  groups: GroupsApi
  logs: LogsApi
  system: SystemApi
  tasks: TasksApi
  updates: UpdatesApi
  users: UsersApi
  validation: ValidationService
}

/**
 * Wire up all API modules around one HTTP client
 */
export function createCloudronContextFromHttp(
  http: HttpClient,
): CloudronContext {
  const system = new SystemApi(http)
  const appstore = new AppStoreApi(http)
  const backups = new BackupsApi(http, system)

  // Validation reads through APIs that are not themselves validated
  const appsBasic = new AppsApi(http, system)
  const usersBasic = new UsersApi(http)
  const updatesBasic = new UpdatesApi(http)

  const validation = new ValidationService({
    getApp: appId => appsBasic.getApp(appId),
    listApps: () => appsBasic.listApps(),
    listAppBackups: appId => appsBasic.listAppBackups(appId),
    getUser: userId => usersBasic.getUser(userId),
    listUsers: () => usersBasic.listUsers(),
    checkStorage: requiredMB => system.checkStorage(requiredMB),
    listBackups: () => backups.listBackups(),
    checkUpdates: () => updatesBasic.checkUpdates(),
    getAppStoreApp: appStoreId => appstore.getApp(appStoreId),
  })

  return {
    http,
    apps: new AppsApi(http, system, validation),
    appstore,
    backups,
    events: new EventsApi(http),
    groups: new GroupsApi(http),
    logs: new LogsApi(http),
    system,
    tasks: new TasksApi(http),
    updates: new UpdatesApi(http, validation),
    users: new UsersApi(http, validation),
    validation,
  }
}

/**
 * Create a CloudronContext from environment variables
 */
export function createCloudronContext(): CloudronContext {
  return createCloudronContextFromHttp(HttpClient.fromEnv())
}
