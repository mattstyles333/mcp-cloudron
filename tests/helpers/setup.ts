/**
 * Global test setup for Vitest
 *
 * This file is loaded via Vitest's setupFiles configuration.
 */

import { afterAll, afterEach, beforeAll, vi } from "vitest"
import { BASE_URL, TOKEN } from "./cloudron-fake"

let originalFetch: typeof global.fetch
const originalEnv = { ...process.env }

beforeAll(() => {
  originalFetch = global.fetch
  process.env.CLOUDRON_BASE_URL = BASE_URL
  process.env.CLOUDRON_API_TOKEN = TOKEN
  delete process.env.CLOUDRON_ACCESS
})

afterAll(() => {
  global.fetch = originalFetch
  process.env = originalEnv
})

afterEach(() => {
  vi.clearAllMocks()
})
