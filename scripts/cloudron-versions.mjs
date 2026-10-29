#!/usr/bin/env node
/**
 * Add the current CloudronManifest.json version to CloudronVersions.json,
 * following https://docs.cloudron.io/packaging/versions/
 *
 *   node scripts/cloudron-versions.mjs ghcr.io/mattstyles333/mcp-cloudron:0.7.0
 *
 * file:// references are inlined; the changelog entry is this version's
 * section of CHANGELOG.cloudron. Run it only after the image is published.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"

const image = process.argv[2]
if (!image) {
  console.error("usage: cloudron-versions.mjs <docker image with tag>")
  process.exit(1)
}

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const manifest = JSON.parse(read("CloudronManifest.json"))

function inline(value) {
  return typeof value === "string" && value.startsWith("file://")
    ? read(value.slice("file://".length)).trim()
    : value
}

function changelogFor(version, text) {
  const sections = text.split(/^\[(.+?)\]\s*$/m)
  for (let i = 1; i < sections.length; i += 2) {
    if (sections[i] === version) return sections[i + 1].trim()
  }
  throw new Error(`CHANGELOG.cloudron has no [${version}] section`)
}

if (!image.endsWith(`:${manifest.version}`)) {
  throw new Error(`Image tag must be the manifest version ${manifest.version}`)
}

const { icon: _icon, ...rest } = manifest // icon is a local file; iconUrl is published
const published = {
  ...rest,
  description: inline(manifest.description),
  postInstallMessage: inline(manifest.postInstallMessage),
  changelog: changelogFor(manifest.version, inline(manifest.changelog)),
  dockerImage: image,
}

for (const field of [
  "id", "title", "description", "tagline", "website", "tags", "changelog",
  "mediaLinks", "healthCheckPath", "iconUrl", "packagerName", "packagerUrl",
]) {
  const value = published[field]
  if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
    throw new Error(`Manifest field ${field} is required for publishing`)
  }
}

const path = new URL("../CloudronVersions.json", import.meta.url)
const catalog = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : { stable: true, versions: {} }

if (catalog.versions[manifest.version]) {
  throw new Error(
    `${manifest.version} is already published; bump the version instead of changing a release`,
  )
}

const now = new Date().toUTCString()
catalog.versions[manifest.version] = {
  manifest: published,
  creationDate: now,
  ts: now,
  publishState: "published",
}

writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`Added ${manifest.version} (${image}) to CloudronVersions.json`)
