/**
 * HttpClient: transport behaviour against real Response objects
 */

import { describe, expect, it } from "vitest"
import { HttpClient, normalizeBaseUrl } from "../../src/client/http-client"
import { CloudronAuthError, CloudronError } from "../../src/errors"
import { BASE_URL, TOKEN, useFakeCloudron } from "../helpers/cloudron-fake"

const client = () => new HttpClient({ baseUrl: BASE_URL, token: TOKEN })

async function rejection(promise: Promise<unknown>): Promise<CloudronError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof CloudronError) return error
    throw error
  }
  throw new Error("expected the request to fail")
}

describe("normalizeBaseUrl", () => {
  it("accepts https and strips paths and trailing slashes", () => {
    expect(normalizeBaseUrl("https://my.example.com/")).toBe(
      "https://my.example.com",
    )
    expect(normalizeBaseUrl("https://my.example.com:8443/api")).toBe(
      "https://my.example.com:8443",
    )
  })

  it("refuses plain http for remote hosts so the token is never sent in clear", () => {
    expect(() => normalizeBaseUrl("http://my.example.com")).toThrow(/https/)
  })

  it("allows plain http for localhost", () => {
    expect(normalizeBaseUrl("http://localhost:3000")).toBe(
      "http://localhost:3000",
    )
    expect(normalizeBaseUrl("http://127.0.0.1")).toBe("http://127.0.0.1")
  })

  it("rejects garbage", () => {
    expect(() => normalizeBaseUrl("my.example.com")).toThrow(/not a valid URL/)
  })
})

describe("HttpClient", () => {
  it("sends the bearer token and JSON body", async () => {
    const { fake } = useFakeCloudron({
      "POST /api/v1/groups": { status: 201, body: { id: "g1", name: "ops" } },
    })

    const result = await client().post("/api/v1/groups", { name: "ops" })

    expect(result).toEqual({ id: "g1", name: "ops" })
    const [request] = fake.requests
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(request?.headers["content-type"]).toBe("application/json")
    expect(request?.body).toEqual({ name: "ops" })
  })

  it("does not send a body or content type on GET", async () => {
    const { fake } = useFakeCloudron({
      "GET /api/v1/cloudron/status": { body: { version: "10.1.6" } },
    })
    await client().get("/api/v1/cloudron/status")
    expect(fake.requests[0]?.body).toBeUndefined()
    expect(fake.requests[0]?.headers["content-type"]).toBeUndefined()
  })

  // Regression: upstream called response.json() on 204 and reported a
  // successful delete as "Network error: Unexpected end of JSON input"
  it("treats 204 No Content as success", async () => {
    useFakeCloudron({ "DELETE /api/v1/users/uid-1": { status: 204 } })
    await expect(
      client().delete("/api/v1/users/uid-1"),
    ).resolves.toBeUndefined()
  })

  it("treats a 202 with an empty body as success", async () => {
    useFakeCloudron({ "POST /api/v1/services/mysql/restart": { status: 202 } })
    await expect(
      client().post("/api/v1/services/mysql/restart"),
    ).resolves.toBeUndefined()
  })

  it("encodes query parameters and skips undefined ones", async () => {
    const { fake } = useFakeCloudron({
      "GET /api/v1/eventlog": { body: { eventlogs: [] } },
    })
    await client().get("/api/v1/eventlog", {
      query: { search: "a b&c", page: 2, from: undefined },
    })
    const query = fake.requests[0]?.query
    expect(query?.get("search")).toBe("a b&c")
    expect(query?.get("page")).toBe("2")
    expect(query?.has("from")).toBe(false)
  })

  it("uses Cloudron's error message and names the request", async () => {
    useFakeCloudron({
      "POST /api/v1/apps": {
        status: 400,
        body: { status: "Bad Request", message: "subdomain is required" },
      },
    })
    const error = await rejection(client().post("/api/v1/apps", {}))
    expect(error).toBeInstanceOf(CloudronError)
    expect(error.statusCode).toBe(400)
    expect(error.message).toBe("subdomain is required (POST /api/v1/apps)")
  })

  it("maps 401/403 to CloudronAuthError without echoing the token", async () => {
    useFakeCloudron({
      "POST /api/v1/apps/app-1/restart": {
        status: 403,
        body: { message: "access token does not have this scope" },
      },
    })
    const error = await rejection(client().post("/api/v1/apps/app-1/restart"))
    expect(error).toBeInstanceOf(CloudronAuthError)
    expect(error.statusCode).toBe(403)
    expect(error.message).not.toContain(TOKEN)
  })

  it("reports a non-JSON success body clearly", async () => {
    useFakeCloudron({ "GET /api/v1/cloudron/status": { body: "<html>" } })
    await expect(client().get("/api/v1/cloudron/status")).rejects.toThrow(
      /non-JSON/,
    )
  })

  it("reads text endpoints as text", async () => {
    useFakeCloudron({
      "GET /api/v1/apps/app-1/logs": {
        body: '{"message":"a"}\n{"message":"b"}',
      },
    })
    await expect(client().getText("/api/v1/apps/app-1/logs")).resolves.toBe(
      '{"message":"a"}\n{"message":"b"}',
    )
  })

  // Regression: Cloudron pages at 25 rows, so upstream's list_users stopped at 25
  it("walks every page of a paginated list", async () => {
    const users = Array.from({ length: 230 }, (_, i) => ({ id: `u${i}` }))
    const { fake } = useFakeCloudron({
      "GET /api/v1/users": request => {
        const page = Number(request.query.get("page"))
        const perPage = Number(request.query.get("per_page"))
        return {
          body: { users: users.slice((page - 1) * perPage, page * perPage) },
        }
      },
    })

    const all = await client().getAllPages("/api/v1/users", "users")

    expect(all).toHaveLength(230)
    expect(fake.requests.map(r => r.query.get("page"))).toEqual(["1", "2", "3"])
  })
})
