# Changelog

## 0.7.0

- **Cloudron app**: install as a community app (Cloudron 10+). Serves MCP over Streamable HTTP at `/mcp` and a settings page behind the Cloudron login with:
  - the Cloudron API token, checked when saved and reported as read-only or read-write;
  - a maximum access level (read, read & write, everything);
  - per-client keys with their own levels, stored hashed;
  - recent tool calls per key.
- Only Cloudron owners and admins can change settings once a token is configured.
- The access-denied message now fits both the local server and the app.
- Fixed: the packaging guide could not find its documentation files when run from the built `dist/`; the missing bundled example now points to `cloudron_fetch_package_example`.

## 0.6.0 (fork of halecraft/mcp-cloudron 0.5.0)

Checked against the Cloudron box server source for 9.0.15 and 10.1.6.

### Fixed: tools that failed against Cloudron 9/10

- **Empty responses**: endpoints answering 204 No Content (delete user, update user profile and role, stop task, acknowledge notification) were reported as `Network error: Unexpected end of JSON input` even though Cloudron had done the work.
- **`cloudron_install_app`**: sent `location`/`portBindings` and a string `accessRestriction`; Cloudron requires `subdomain`, `ports` and an object or null.
- **`cloudron_clone_app`**: same field names, and Cloudron requires `backupId` and `domain`. Now defaults to the newest backup and the source domain.
- **`cloudron_configure_app`**: called `PUT /apps/:id/configure`, which does not exist. Now uses the per-setting endpoints, merges env into the existing variables, and treats the memory limit as MB (it was documented as MB but sent as bytes).
- **`cloudron_update_app`**: sent `{ manifest: { version } }`; Cloudron requires `appStoreId` (`id@version` to pin).
- **`cloudron_restore_app`**: validation looked for the backup among full-instance backups, so every app restore was blocked.
- **`cloudron_cancel_task`**: called `DELETE /tasks/:id`; the route is `POST /tasks/:id/stop`.
- **`cloudron_check_updates` / `cloudron_apply_update`**: used `/updater/updates` and `/updater/update`, replaced by `/updater/box_update`.
- **`cloudron_check_storage`, `cloudron_backup_app`, `cloudron_create_backup`**: used `/system/disk_usage` and `/backups/create`, removed in Cloudron 9. Now `/system/filesystems`, backup sites, and `POST /backup_sites/:id/create_backup`.
- **`cloudron_list_users`** and the last-admin check: only saw the first 25 users. Lists now walk every page.
- **`cloudron_search_apps`**: Cloudron ignores the search parameter, so every search returned the whole catalogue. Matching and ranking now happen locally, capped at 25 results.
- **`cloudron_create_user`**: Cloudron returns only `{ id }`; the user is now read back. Password rule matches Cloudron (8-256 characters); username and password are optional, with an invite option.
- **`cloudron_update_user`**: role enum was `admin/user/guest`; now Cloudron's real roles. The advertised `password` field was silently ignored; Cloudron's API has no admin password reset, so it is now refused with an explanation.
- **Last-owner check**: checked for the last `admin`; Cloudron's protected role is `owner`.
- **Backup states**: checked `uploaded`/`created`; Cloudron uses `normal`, so the "recent backup" check never passed.
- **`cloudron_get_logs`**: Cloudron sends `realtimeTimestamp` as microseconds (a number); the parser only accepted strings, so every line showed as raw JSON stamped with the current time. Severity now comes from explicit level markers in the message.
- Groups no longer print `Invalid Date`; task states include `stopped`; the server reports its real version.

### Added

- `CLOUDRON_ACCESS` (`read` default, `write`, `all`) controlling which tools are offered and allowed.
- MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on every tool.
- `confirm` argument on destructive tools (app fqdn or user email); `cloudron_apply_update` requires the pending version.
- `CLOUDRON_BASE_URL` must be https (except localhost) so the token is never sent in clear text.
- Environment variable values are hidden in `cloudron_get_app`.
- Tools: `cloudron_list_app_backups`, `cloudron_list_backup_sites`, `cloudron_list_eventlog`, `cloudron_list_notifications`, `cloudron_acknowledge_notification`, `cloudron_restart_service`; task logs in `cloudron_get_logs`; label, tags, auto-update and auto-backup in `cloudron_configure_app`.
- `cloudron_get_status` adds server info, uptime, reboot-required and pending update; `cloudron_list_services` reports each service's status and memory.
- Packaging helpers no longer need Cloudron credentials.

### Testing

- Unit tests run against a fake Cloudron that rejects any route missing from Cloudron 9.0.15 or 10.1.6 (`tests/fixtures/cloudron-routes.json`, extracted by `scripts/extract-cloudron-routes.mjs`) and returns real `Response` objects. The previous mocks returned a JSON body for every status and were keyed to the same wrong URLs as the code, so they could not catch these bugs.
- Read-only integration smoke test that runs every read tool against a live Cloudron.

### Breaking

- Argument names follow Cloudron: `subdomain` (was `location`), `ports` (was `portBindings`), `appStoreId` (was `manifestId`/`appId` for App Store tools).
- `cloudron_validate_operation`'s `restore_backup` is now `restore_app` and takes `backupId`.
- Write and destructive tools are hidden unless `CLOUDRON_ACCESS` allows them.
- Requires Cloudron 9.0 or later.
