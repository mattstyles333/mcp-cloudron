/**
 * Users API
 * User management operations
 */

import { CloudronError } from "../errors.js"
import {
  type CreateUserParams,
  type UpdateUserParams,
  USER_ROLES,
  type User,
  type UserRole,
  type ValidationResult,
} from "../types.js"
import {
  isValidEmail,
  isValidPassword,
  isValidRole,
} from "../validation/index.js"
import type { HttpClient } from "./http-client.js"

/**
 * Interface for user validation (dependency injection)
 */
export interface UserValidator {
  validateOperation(
    operation: "delete_user",
    resourceId: string,
  ): Promise<ValidationResult>
}

const ROLE_ORDER: Record<UserRole, number> = {
  owner: 0,
  admin: 1,
  usermanager: 2,
  mailmanager: 3,
  user: 4,
}

function userPath(userId: string, suffix = ""): string {
  if (!userId) {
    throw new CloudronError("userId is required")
  }
  return `/api/v1/users/${encodeURIComponent(userId)}${suffix}`
}

function assertRole(role: string): asserts role is UserRole {
  if (!isValidRole(role)) {
    throw new CloudronError(
      `Invalid role: ${role}. Valid options: ${USER_ROLES.join(", ")}`,
    )
  }
}

/**
 * Users API for Cloudron user management
 */
export class UsersApi {
  constructor(
    private readonly http: HttpClient,
    private readonly validator?: UserValidator,
  ) {}

  /**
   * GET /api/v1/users (every page), sorted by role then email
   */
  async listUsers(): Promise<User[]> {
    const users = await this.http.getAllPages<User>("/api/v1/users", "users")
    return users.sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
        a.email.localeCompare(b.email),
    )
  }

  /**
   * GET /api/v1/users/:userId
   */
  async getUser(userId: string): Promise<User> {
    return await this.http.get<User>(userPath(userId))
  }

  /**
   * POST /api/v1/users (returns only the new id), then read the user back.
   * Without a password the user signs up through an invite.
   */
  async createUser(params: CreateUserParams): Promise<User> {
    if (!isValidEmail(params.email)) {
      throw new CloudronError("Invalid email format")
    }
    if (params.password !== undefined && !isValidPassword(params.password)) {
      throw new CloudronError(
        "Password must be between 8 and 256 characters long",
      )
    }
    if (params.role !== undefined) assertRole(params.role)
    if (
      params.fallbackEmail !== undefined &&
      !isValidEmail(params.fallbackEmail)
    ) {
      throw new CloudronError("Invalid fallback email format")
    }

    const response = await this.http.post<{ id: string }>(
      "/api/v1/users",
      params,
    )
    if (!response?.id) {
      throw new CloudronError("User creation response missing id")
    }
    return await this.getUser(response.id)
  }

  /**
   * POST /api/v1/users/:userId/send_invite_email
   */
  async sendInvite(userId: string, email: string): Promise<void> {
    await this.http.post(userPath(userId, "/send_invite_email"), { email })
  }

  /**
   * Update profile fields (POST /users/:id/profile, 204) and/or role
   * (PUT /users/:id/role, 204), then read the user back.
   */
  async updateUser(userId: string, params: UpdateUserParams): Promise<User> {
    const { role, ...profile } = params
    if (role === undefined && Object.keys(profile).length === 0) {
      throw new CloudronError(
        "Provide at least one of: email, displayName, fallbackEmail, role",
      )
    }
    if (profile.email !== undefined && !isValidEmail(profile.email)) {
      throw new CloudronError("Invalid email format")
    }
    if (
      profile.fallbackEmail !== undefined &&
      !isValidEmail(profile.fallbackEmail)
    ) {
      throw new CloudronError("Invalid fallback email format")
    }

    if (Object.keys(profile).length > 0) {
      await this.http.post(userPath(userId, "/profile"), profile)
    }
    if (role !== undefined) {
      assertRole(role)
      await this.http.put(userPath(userId, "/role"), { role })
    }

    return await this.getUser(userId)
  }

  /**
   * DELETE /api/v1/users/:userId (DESTRUCTIVE, 204)
   */
  async deleteUser(userId: string): Promise<void> {
    if (this.validator) {
      const validation = await this.validator.validateOperation(
        "delete_user",
        userId,
      )
      if (!validation.valid) {
        throw new CloudronError(
          `Pre-flight validation failed for delete_user on '${userId}':\n${validation.errors.join("\n")}`,
        )
      }
    }

    await this.http.delete(userPath(userId))
  }
}
