#!/usr/bin/env node
/**
 * Extract the REST route table from a Cloudron box checkout.
 *
 * Usage:
 *   git clone --depth 1 --branch v10.1.6 https://git.cloudron.io/platform/box.git /tmp/box
 *   node scripts/extract-cloudron-routes.mjs /tmp/box 10.1.6
 *
 * Merges the routes for that version into tests/fixtures/cloudron-routes.json.
 * The test suite rejects any request to a route that is missing from every
 * listed version, so a tool can never again ship against an endpoint that
 * Cloudron does not serve.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [boxDir, version] = process.argv.slice(2)
if (!boxDir || !version) {
  console.error("usage: extract-cloudron-routes.mjs <box-checkout> <version>")
  process.exit(1)
}

const serverSource = readFileSync(join(boxDir, "src/server.js"), "utf8")
const routePattern = /router\.(get|post|put|del)\s*\(\s*'(\/api\/v1\/[^']+)'/g
const methods = { get: "GET", post: "POST", put: "PUT", del: "DELETE" }

const routes = new Set()
for (const match of serverSource.matchAll(routePattern)) {
  routes.add(`${methods[match[1]]} ${match[2].replace(/\/$/, "")}`)
}

const fixturePath = new URL("../tests/fixtures/cloudron-routes.json", import.meta.url)
let fixture = {}
try {
  fixture = JSON.parse(readFileSync(fixturePath, "utf8"))
} catch {
  // first run
}
fixture[version] = [...routes].sort()
writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`Wrote ${routes.size} routes for Cloudron ${version}`)
