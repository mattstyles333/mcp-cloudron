/**
 * App Store API
 * App store search operations
 */

import { CloudronError } from "../errors.js"
import type { AppStoreApp, AppStoreResponse } from "../types.js"
import type { HttpClient } from "./http-client.js"

/**
 * Score how well an App Store entry matches a query (0 = no match).
 * Cloudron returns the whole catalogue and ignores search parameters,
 * so matching happens here.
 */
export function scoreAppStoreMatch(app: AppStoreApp, query: string): number {
  const q = query.trim().toLowerCase()
  const id = app.id.toLowerCase()
  const title = (app.manifest.title ?? "").toLowerCase()
  if (id === q || title === q) return 100
  if (title.startsWith(q)) return 80
  if (title.includes(q)) return 60
  if (id.includes(q)) return 50
  if (app.manifest.tags?.some(tag => tag.toLowerCase() === q)) return 40
  if ((app.manifest.tagline ?? "").toLowerCase().includes(q)) return 30
  return 0
}

/**
 * App Store API for Cloudron app store operations
 */
export class AppStoreApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/appstore/apps, filtered and ranked locally.
   * @param query - Optional search text; empty returns the whole catalogue
   */
  async searchApps(query?: string): Promise<AppStoreApp[]> {
    const response = await this.http.get<AppStoreResponse>(
      "/api/v1/appstore/apps",
    )
    const apps = response.apps ?? []
    if (!query?.trim()) {
      return apps.sort((a, b) =>
        a.manifest.title.localeCompare(b.manifest.title),
      )
    }

    return apps
      .map(app => ({ app, score: scoreAppStoreMatch(app, query) }))
      .filter(({ score }) => score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.app.manifest.title.localeCompare(b.app.manifest.title),
      )
      .map(({ app }) => app)
  }

  /**
   * GET /api/v1/appstore/apps/:appstoreId
   */
  async getApp(appStoreId: string): Promise<AppStoreApp> {
    if (!appStoreId) {
      throw new CloudronError("appStoreId is required")
    }
    const [id] = appStoreId.split("@")
    return await this.http.get<AppStoreApp>(
      `/api/v1/appstore/apps/${encodeURIComponent(id ?? appStoreId)}`,
    )
  }
}
