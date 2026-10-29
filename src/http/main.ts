#!/usr/bin/env node
/**
 * Entry point for the Cloudron app (HTTP transport + settings UI)
 *
 * Environment (set by Cloudron):
 *   CLOUDRON_API_ORIGIN  dashboard/API origin, e.g. https://my.example.com
 *   CLOUDRON_APP_ORIGIN  this app's origin
 * Optional:
 *   PORT (default 3000), DATA_DIR (default /app/data), UI_DIR
 */

import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { VERSION } from "../mcp-server.js"
import { validateToolHandlerAlignment } from "../tools/call.js"
import { createApp } from "./app.js"
import { Store } from "./store.js"

validateToolHandlerAlignment()

const cloudronOrigin =
  process.env.CLOUDRON_API_ORIGIN ?? process.env.CLOUDRON_BASE_URL
if (!cloudronOrigin) {
  console.error("CLOUDRON_API_ORIGIN is not set; is this running on Cloudron?")
  process.exit(1)
}

const port = Number(process.env.PORT ?? 3000)
const store = new Store(process.env.DATA_DIR ?? "/app/data")
const handler = createApp({
  store,
  cloudronOrigin,
  appOrigin: process.env.CLOUDRON_APP_ORIGIN ?? `http://localhost:${port}`,
  uiDir: process.env.UI_DIR ?? fileURLToPath(new URL("../ui", import.meta.url)),
})

const server = createServer((req, res) => {
  void handler(req, res)
})
server.listen(port, () => {
  console.log(
    `Cloudron MCP app v${VERSION} listening on :${port} (Cloudron API ${cloudronOrigin})`,
  )
})

function shutdown(): void {
  store.flush()
  server.close(() => process.exit(0))
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
