# Technical notes

## Layout

```
src/
  server.ts            local MCP server over stdio
  mcp-server.ts        MCP server factory shared by stdio and HTTP
  http/                the Cloudron app
    main.ts            entry point (dist/app.js)
    app.ts             /mcp endpoint, settings API, static UI
    store.ts           settings, hashed client keys, activity log in /app/data
    cloudron-checks.ts token check (incl. read/write probe) and role lookup
  config.ts            constants and CLOUDRON_ACCESS parsing
  client/              one module per Cloudron API area, all built on http-client.ts
    context.ts         wires the modules and the validation service together
  tools/
    definitions.ts     tool schemas + MCP annotations (the single source of truth)
    access.ts          which annotations each CLOUDRON_ACCESS level allows
    call.ts            access check, then handler; errors become MCP error results
    handlers/          one registry per area; packaging helpers are "offline"
    validators.ts      argument parsing, including the confirm check
    formatters.ts      text output for the model
  validation/          pre-flight checks (validation-service.ts) and package linting
  scaffolding/, resources/, git/   packaging helpers
```

## Cloudron app

The manifest uses the `proxyAuth` addon with `supportsBearerAuth`. nginx then:

- sends requests carrying `Authorization: Bearer` straight to the app, where `/mcp` requires a client key from the store;
- puts every other request behind the Cloudron login and sets `X-Remote-User`. That header is blanked on bearer requests, so it cannot be forged; the settings API also refuses any request with a bearer.

Cloudron's nginx sets `proxy_intercept_errors on` and maps a 401 from a proxyAuth app to a redirect to the login page. The app therefore answers a missing or unknown client key with **403** (JSON-RPC error body plus `WWW-Authenticate`), never 401. 502 and 504 are replaced by Cloudron's error page too.

Settings changes need `X-Requested-With: cloudron-mcp` (a custom header, which cannot be sent cross-site without a CORS preflight that the app never grants). The signed-in user's role comes from `GET /users?search=` with the stored token, cached for 60 seconds. If that lookup fails with 401/403 (token rejected), setup reopens; any other failure answers 503 rather than granting access.

The token's write ability is probed with `POST /groups {}`. Cloudron checks token scope before validating the body, so a read-only token gets 403, a read-write one gets 400, and nothing is created.

Each MCP request builds a fresh server and stateless transport (`enableJsonResponse`) with the key's effective level: the lowest of the key's level, the maximum level, and `read` when the token is read-only.

## HTTP layer

`HttpClient` (`src/client/http-client.ts`):

- Rejects non-https base URLs except localhost.
- Reads every body as text first. An empty body (204, or 202 with nothing) resolves to `undefined`; anything else must be JSON.
- Errors carry Cloudron's `message`, the HTTP status, and the method and path, never the token.
- `getAllPages()` walks `page`/`per_page` (100 per page) until a short page, because Cloudron defaults to 25 rows and returns no total.
- No retries: most writes start tasks and are not idempotent.

## Access model

`toolAccess()` reads each tool's annotations: `readOnlyHint` means read, `destructiveHint` means destructive, otherwise write. `CLOUDRON_ACCESS` maps to the allowed set (`read` ⊂ `write` ⊂ `all`). `tools/list` only returns allowed tools and `callTool()` refuses the rest, so a client cannot call a hidden tool by name.

Destructive handlers fetch the target first and call `requireConfirmation()` against its fqdn or email before anything is sent. `cloudron_apply_update` compares the given version with the pending update.

## Pre-flight checks

`ValidationService` reads through unvalidated API instances (no recursion) and returns errors (block), warnings and recommendations:

| Operation | Checks |
|---|---|
| uninstall app | app exists; warns if it has no backup from the last 24h |
| restore app | backup is one of the app's own backups and in state `normal`; disk not critical |
| clone app | source installed; target subdomain free; backup belongs to the source |
| delete user | not the last `owner` (all pages of users) |
| install | app exists in the App Store; disk has room |
| update app | app installed; warns if Cloudron recorded no pending update |
| platform update | an update is pending; warns if no full backup in the last 24h |

Backups only block on a critically full root disk: backup sites are usually off-box, so a fixed free-space minimum would block valid backups.

## Cloudron API notes (9.0 / 10.x)

- Field names: `subdomain` and `ports` on writes; apps report `portBindings`. Access restriction is an object `{ users, groups }` or null.
- Settings are per-endpoint: `POST /apps/:id/configure/{env,memory_limit,access_restriction,label,tags,automatic_update,automatic_backup}`. `env` replaces the whole map, hence the merge.
- Memory limits are bytes.
- Backups need a backup site: `POST /apps/:id/backup { backupSiteId }`, `POST /backup_sites/:id/create_backup`.
- Platform update: `GET/POST /updater/box_update`.
- Tasks: `GET /tasks/:id` (`running`, `active`, `success`, `error.code` = `stopped`/`crashed`/`timeout`), `POST /tasks/:id/stop`.
- `GET /appstore/apps` returns the whole catalogue and ignores query parameters.
- API tokens act with the role stored on the token (default `admin`); with an admin token, owner-only operations are refused. Read-only tokens (`scope {"*": "r"}`) may only GET.

## Tests

`tests/helpers/cloudron-fake.ts` checks every mocked and every requested route against `tests/fixtures/cloudron-routes.json`, the routes of each supported Cloudron version extracted from the box source by `scripts/extract-cloudron-routes.mjs`. A route missing from any listed version fails the test. Responses are real `Response` objects. Fixture builders (`makeApp`, `makeBackup`, ...) use Cloudron's real field names.

`tests/integration/readonly.integration.test.ts` runs every read tool against a live Cloudron with `CLOUDRON_ACCESS=read`.
