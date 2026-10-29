/**
 * Groups API
 * Group management operations
 */

import { CloudronError } from "../errors.js"
import type { CreateGroupParams, Group, GroupsResponse } from "../types.js"
import type { HttpClient } from "./http-client.js"

export class GroupsApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/groups, sorted by name
   */
  async listGroups(): Promise<Group[]> {
    const response = await this.http.get<GroupsResponse>("/api/v1/groups")
    const groups = response.groups ?? []
    return groups.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * POST /api/v1/groups (returns { id, name })
   */
  async createGroup(params: CreateGroupParams): Promise<Group> {
    if (!params.name || params.name.trim() === "") {
      throw new CloudronError("Group name is required and cannot be empty")
    }

    return await this.http.post<Group>("/api/v1/groups", params)
  }
}
