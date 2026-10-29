/**
 * HTTP Client for Cloudron API
 * Core request functionality with error handling
 */

import {
  DEFAULT_TIMEOUT_MS,
  LIST_MAX_PAGES,
  LIST_PAGE_SIZE,
} from "../config.js"
import { CloudronError, createErrorFromStatus } from "../errors.js"

/**
 * Configuration for HttpClient
 */
export interface HttpClientConfig {
  baseUrl: string
  token: string
  timeout?: number
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"

export type QueryParams = Record<string, string | number | boolean | undefined>

export interface RequestOptions {
  body?: unknown
  query?: QueryParams
  timeout?: number
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Validate the instance URL. The token is sent on every request, so plain
 * http is only accepted for a server on this machine.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new CloudronError(
      `CLOUDRON_BASE_URL '${baseUrl}' is not a valid URL (expected e.g. https://my.example.com)`,
    )
  }

  if (url.protocol !== "https:" && !LOCAL_HOSTS.has(url.hostname)) {
    throw new CloudronError(
      "CLOUDRON_BASE_URL must use https:// so the API token is not sent in clear text",
    )
  }

  return url.origin
}

function buildQuery(query?: QueryParams): string {
  if (!query) return ""
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ""
}

/**
 * HTTP Client for making authenticated requests to Cloudron API
 */
export class HttpClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly timeout: number

  constructor(config: HttpClientConfig) {
    if (!config.baseUrl) {
      throw new CloudronError(
        "baseUrl is required. Provide via config or CLOUDRON_BASE_URL environment variable.",
      )
    }
    if (!config.token) {
      throw new CloudronError(
        "token is required. Provide via config or CLOUDRON_API_TOKEN environment variable.",
      )
    }

    this.baseUrl = normalizeBaseUrl(config.baseUrl)
    this.token = config.token
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Create HttpClient from environment variables
   */
  static fromEnv(): HttpClient {
    const baseUrl = process.env.CLOUDRON_BASE_URL
    const token = process.env.CLOUDRON_API_TOKEN

    if (!baseUrl) {
      throw new CloudronError(
        "CLOUDRON_BASE_URL not set. Provide via config or environment variable.",
      )
    }
    if (!token) {
      throw new CloudronError(
        "CLOUDRON_API_TOKEN not set. Provide via config or environment variable.",
      )
    }

    return new HttpClient({ baseUrl, token })
  }

  /**
   * Send a request and return the raw response body as text.
   * No retries: most Cloudron writes start tasks and are not idempotent.
   */
  private async send(
    method: HttpMethod,
    endpoint: string,
    options: RequestOptions & { accept?: string } = {},
  ): Promise<string> {
    const url = `${this.baseUrl}${endpoint}${buildQuery(options.query)}`
    const timeout = options.timeout ?? this.timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: options.accept ?? "application/json",
    }
    const init: RequestInit = { method, headers, signal: controller.signal }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json"
      init.body = JSON.stringify(options.body)
    }

    try {
      const response = await fetch(url, init)
      const text = await response.text()

      if (!response.ok) {
        let message = `${response.status} ${response.statusText}`.trim()
        try {
          const parsed = JSON.parse(text)
          if (parsed && typeof parsed.message === "string") {
            message = parsed.message
          }
        } catch {
          // Use default message if body isn't JSON
        }
        throw createErrorFromStatus(
          response.status,
          `${message} (${method} ${endpoint})`,
        )
      }

      return text
    } catch (error) {
      if (error instanceof CloudronError) {
        throw error
      }

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new CloudronError(
            `Request timeout after ${timeout}ms (${method} ${endpoint})`,
            { code: "TIMEOUT", cause: error },
          )
        }
        throw new CloudronError(`Network error: ${error.message}`, {
          code: "NETWORK_ERROR",
          cause: error,
        })
      }

      throw new CloudronError("Unknown error occurred", { cause: error })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Make a JSON request. Empty bodies (204 No Content, or 202 with no body)
   * resolve to undefined rather than failing to parse.
   */
  async request<T>(
    method: HttpMethod,
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const text = await this.send(method, endpoint, options)
    if (text.trim() === "") {
      return undefined as T
    }
    try {
      return JSON.parse(text)
    } catch (cause) {
      throw new CloudronError(
        `Cloudron returned a non-JSON response for ${method} ${endpoint}`,
        { code: "BAD_RESPONSE", cause },
      )
    }
  }

  async get<T>(
    endpoint: string,
    options: Omit<RequestOptions, "body"> = {},
  ): Promise<T> {
    return this.request<T>("GET", endpoint, options)
  }

  /**
   * GET a plain-text endpoint such as logs
   */
  async getText(
    endpoint: string,
    options: Omit<RequestOptions, "body"> = {},
  ): Promise<string> {
    return this.send("GET", endpoint, { ...options, accept: "*/*" })
  }

  async post<T>(
    endpoint: string,
    body?: unknown,
    options: Omit<RequestOptions, "body"> = {},
  ): Promise<T> {
    return this.request<T>("POST", endpoint, { ...options, body: body ?? {} })
  }

  async put<T>(
    endpoint: string,
    body?: unknown,
    options: Omit<RequestOptions, "body"> = {},
  ): Promise<T> {
    return this.request<T>("PUT", endpoint, { ...options, body: body ?? {} })
  }

  async delete<T>(
    endpoint: string,
    options: Omit<RequestOptions, "body"> = {},
  ): Promise<T> {
    return this.request<T>("DELETE", endpoint, options)
  }

  /**
   * Fetch every page of a paginated list endpoint (Cloudron defaults to 25
   * rows per page and gives no total, so stop at the first short page).
   */
  async getAllPages<T>(
    endpoint: string,
    key: string,
    query: QueryParams = {},
  ): Promise<T[]> {
    const items: T[] = []
    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      const response = await this.get<Record<string, T[] | undefined>>(
        endpoint,
        { query: { ...query, page, per_page: LIST_PAGE_SIZE } },
      )
      const pageItems = response?.[key] ?? []
      items.push(...pageItems)
      if (pageItems.length < LIST_PAGE_SIZE) return items
    }
    throw new CloudronError(
      `${endpoint} returned more than ${LIST_PAGE_SIZE * LIST_MAX_PAGES} rows; narrow the query`,
    )
  }
}
