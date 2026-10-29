// Cloudron MCP settings page. Plain DOM, no innerHTML with data.

const ACCESS = {
  read: {
    label: "Read only",
    text: "List and inspect apps, backups, users, logs, services, updates.",
  },
  write: {
    label: "Read & write",
    text: "Also start/stop, configure, install, update, back up, manage users and groups.",
  },
  all: {
    label: "Everything",
    text: "Also uninstall, restore, delete users and update the platform. Each still needs a typed confirmation.",
  },
}

let state = null

const $ = id => document.getElementById(id)

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value)
    else node[key] = value
  }
  for (const child of children) {
    if (child !== null && child !== undefined) {
      node.append(child instanceof Node ? child : String(child))
    }
  }
  return node
}

function when(iso) {
  if (!iso) return "never"
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function showBanner(message, kind = "error") {
  const banner = $("banner")
  banner.textContent = message
  banner.className = kind === "info" ? "banner info" : "banner"
  banner.hidden = !message
}

async function api(method, path, body) {
  const options = { method, headers: {} }
  if (method !== "GET") {
    options.headers["X-Requested-With"] = "cloudron-mcp"
    options.headers["Content-Type"] = "application/json"
    options.body = JSON.stringify(body ?? {})
  }
  const res = await fetch(path, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || `${res.status} ${res.statusText}`)
    error.status = res.status
    throw error
  }
  return data
}

async function run(action) {
  showBanner("")
  try {
    const result = await action()
    if (result && result.version) render(result)
    return result
  } catch (error) {
    showBanner(error.message)
    return null
  }
}

// ==================== Rendering ====================

function renderToken() {
  const { tokenConfigured, tokenStatus } = state.settings
  const box = $("token-status")
  box.replaceChildren()

  if (!tokenConfigured) {
    box.className = "status warn"
    box.append("No token yet. Clients can connect, but Cloudron tools will fail until a token is saved.")
  } else if (!tokenStatus || !tokenStatus.ok) {
    box.className = "status bad"
    box.append(`Token not working: ${tokenStatus?.error ?? "unknown error"}`)
  } else {
    const scope =
      tokenStatus.writable === true
        ? "read-write"
        : tokenStatus.writable === false
          ? "read-only (all clients limited to read tools)"
          : "scope unknown"
    box.className = tokenStatus.writable === false ? "status warn" : "status ok"
    box.append(
      `Connected to ${state.cloudronOrigin} (Cloudron ${tokenStatus.cloudronVersion ?? "?"}). Token is ${scope}. Checked ${when(tokenStatus.checkedAt)}.`,
    )
  }

  $("token-input").placeholder = tokenConfigured
    ? "Paste a new token to replace the current one"
    : "Paste a Cloudron API token"
  $("token-check").hidden = !tokenConfigured
  $("token-remove").hidden = !tokenConfigured
}

function renderAccess() {
  const box = $("access-options")
  box.replaceChildren()
  for (const [level, info] of Object.entries(ACCESS)) {
    const selected = state.settings.maxAccess === level
    const option = el(
      "label",
      {
        class: `option${selected ? " selected" : ""}${level === "all" ? " danger-option" : ""}`,
      },
      el("input", {
        type: "radio",
        name: "maxAccess",
        value: level,
        checked: selected,
        onchange: () => {
          if (
            level === "all" &&
            !confirm(
              "Allow destructive tools (uninstall, restore, delete users, platform updates) for keys set to Everything?",
            )
          ) {
            render(state)
            return
          }
          run(() => api("PUT", "/api/settings", { maxAccess: level }))
        },
      }),
      el("strong", {}, `${info.label} · ${state.toolCounts[level]} tools`),
      el("span", { class: "muted" }, info.text),
    )
    box.append(option)
  }
}

function accessSelect(value, onChange) {
  const select = el("select", { onchange: () => onChange(select.value) })
  for (const [level, info] of Object.entries(ACCESS)) {
    select.append(el("option", { value: level, selected: level === value }, info.label))
  }
  return select
}

function renderKeys() {
  const body = $("keys-table").querySelector("tbody")
  body.replaceChildren()
  $("keys-empty").hidden = state.keys.length > 0
  $("keys-table").hidden = state.keys.length === 0

  for (const key of state.keys) {
    const capped = key.effectiveAccess !== key.access
    body.append(
      el(
        "tr",
        {},
        el("td", {}, el("strong", {}, key.name), el("br"), el("code", { class: "muted" }, `${key.hint}…`)),
        el(
          "td",
          {},
          accessSelect(key.access, access =>
            run(() => api("PATCH", `/api/keys/${key.id}`, { access })),
          ),
          capped ? el("div", { class: "muted" }, `effective: ${ACCESS[key.effectiveAccess].label}`) : null,
        ),
        el("td", {}, when(key.createdAt), el("br"), el("span", { class: "muted" }, `by ${key.createdBy}`)),
        el("td", {}, when(key.lastUsedAt)),
        el(
          "td",
          {},
          el(
            "button",
            {
              class: "danger small",
              onclick: () => {
                if (confirm(`Revoke "${key.name}"? Clients using it stop working immediately.`)) {
                  run(() => api("DELETE", `/api/keys/${key.id}`))
                }
              },
            },
            "Revoke",
          ),
        ),
      ),
    )
  }

  const select = $("key-access")
  if (!select.options.length) {
    for (const [level, info] of Object.entries(ACCESS)) {
      select.append(el("option", { value: level }, info.label))
    }
    select.value = state.settings.maxAccess === "all" ? "write" : state.settings.maxAccess
  }
}

function renderActivity() {
  const body = $("activity-table").querySelector("tbody")
  body.replaceChildren()
  $("activity-empty").hidden = state.activity.length > 0
  $("activity-table").hidden = state.activity.length === 0
  for (const entry of state.activity) {
    body.append(
      el(
        "tr",
        {},
        el("td", {}, when(entry.at)),
        el("td", {}, entry.key),
        el("td", {}, el("code", {}, entry.tool.replace(/^cloudron_/, ""))),
        el(
          "td",
          {},
          el("span", { class: entry.ok ? "pill ok" : "pill bad" }, entry.ok ? "ok" : "error"),
          " ",
          el("span", { class: "muted" }, entry.summary),
        ),
      ),
    )
  }
}

function render(next) {
  state = next
  $("subtitle").textContent = `Signed in as ${state.viewer.username}${state.viewer.role ? ` (${state.viewer.role})` : ""}`
  $("footer").textContent = `Cloudron MCP v${state.version} · MCP endpoint: ${state.mcpUrl}`
  if (state.viewer.bootstrap) {
    showBanner(
      "Setup mode: anyone who can open this app may configure it until a working token is saved. After that, only Cloudron owners and admins can.",
      "info",
    )
  }
  $("content").hidden = false
  renderToken()
  renderAccess()
  renderKeys()
  renderActivity()
}

// ==================== Actions ====================

function showNewKey(secret) {
  $("new-key-secret").textContent = secret
  $("snippet-claude").textContent =
    `claude mcp add --transport http cloudron ${state.mcpUrl} \\\n  --header "Authorization: Bearer ${secret}"`
  $("snippet-opencode").textContent = JSON.stringify(
    {
      cloudron: {
        type: "remote",
        url: state.mcpUrl,
        headers: { Authorization: `Bearer ${secret}` },
      },
    },
    null,
    2,
  )
  $("new-key").hidden = false
}

document.addEventListener("DOMContentLoaded", () => {
  $("token-form").addEventListener("submit", async event => {
    event.preventDefault()
    const token = $("token-input").value.trim()
    if (!token) return
    const result = await run(() => api("PUT", "/api/token", { token }))
    if (result) $("token-input").value = ""
  })

  $("token-check").addEventListener("click", () =>
    run(() => api("POST", "/api/token/check")),
  )

  $("token-remove").addEventListener("click", () => {
    if (confirm("Remove the Cloudron token? Clients keep their keys, but Cloudron tools stop working.")) {
      run(() => api("DELETE", "/api/token"))
    }
  })

  $("key-form").addEventListener("submit", async event => {
    event.preventDefault()
    const name = $("key-name").value.trim()
    if (!name) return
    const result = await run(() =>
      api("POST", "/api/keys", { name, access: $("key-access").value }),
    )
    if (result) {
      render(result.state)
      $("key-name").value = ""
      showNewKey(result.secret)
    }
  })

  $("copy-key").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("new-key-secret").textContent)
    $("copy-key").textContent = "Copied"
    setTimeout(() => {
      $("copy-key").textContent = "Copy"
    }, 1500)
  })

  api("GET", "/api/state")
    .then(render)
    .catch(error => {
      $("subtitle").textContent = ""
      if (error.status === 403 || error.status === 401) {
        $("denied-text").textContent = error.message
        $("denied").hidden = false
      } else {
        showBanner(error.message)
      }
    })
})
