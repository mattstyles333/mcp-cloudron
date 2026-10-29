/**
 * Parse a single log line into a structured LogEntry.
 *
 * Handles multiple log formats:
 * 1. NDJSON: {"realtimeTimestamp": "...", "message": "..."}
 * 2. ISO timestamp: "2025-12-24T12:00:00Z [INFO] message"
 * 3. Syslog: "Dec 24 12:00:00 host service[pid]: [INFO] message"
 * 4. Bracket severity: "[INFO] message"
 * 5. Plain text fallback
 */

import type { LogEntry } from "../types.js"

const SEVERITY_LEVELS = [
  "DEBUG",
  "INFO",
  "WARN",
  "WARNING",
  "ERROR",
  "FATAL",
  "TRACE",
] as const

/**
 * Cloudron sends realtimeTimestamp as microseconds since the epoch
 * (0 when unknown); older formats used an ISO string.
 */
function formatRealtimeTimestamp(value: unknown): string | null {
  if (typeof value === "string") return value
  if (typeof value === "number") {
    return value > 0 ? new Date(value / 1000).toISOString() : "unknown time"
  }
  return null
}

/**
 * NDJSON lines carry no severity; take it from a level word near the start
 * of the message (e.g. "[ERROR] ...", "level=warn", "WARNING: ...").
 */
const LEVEL = "(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)"
const LEVEL_PATTERNS = [
  new RegExp(`^\\s*\\[?${LEVEL}\\]?(?::|\\s)`, "i"), // "ERROR: x", "[warn] x"
  new RegExp(`\\[${LEVEL}\\]`, "i"), // "app [ERROR] x"
  new RegExp(`\\blevel=["']?${LEVEL}\\b`, "i"), // "level=warn"
]

function severityFromMessage(message: string): string {
  const head = message.slice(0, 80)
  for (const pattern of LEVEL_PATTERNS) {
    const level = head.match(pattern)?.[1]
    if (level) return level.toUpperCase()
  }
  return "INFO"
}

/**
 * Try to parse a line as NDJSON (newline-delimited JSON).
 * The Cloudron logs API returns NDJSON with format=json, where each line
 * is a JSON object with `realtimeTimestamp` and `message` fields.
 */
function tryParseNdjson(line: string): LogEntry | null {
  try {
    const parsed = JSON.parse(line)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.message === "string"
    ) {
      const timestamp = formatRealtimeTimestamp(parsed.realtimeTimestamp)
      if (timestamp === null) return null
      return {
        timestamp,
        severity: severityFromMessage(parsed.message),
        message: parsed.message,
      }
    }
  } catch {
    // Not valid JSON — fall through to regex parsing
  }
  return null
}

/**
 * Parse a single log line into a structured LogEntry.
 * Tries NDJSON first, then falls back to regex-based log format patterns.
 */
export function parseLogLine(line: string): LogEntry {
  if (!line) {
    return {
      timestamp: new Date().toISOString(),
      severity: "INFO",
      message: "",
    }
  }

  // 1. Try NDJSON format (Cloudron default)
  const ndjson = tryParseNdjson(line)
  if (ndjson) return ndjson

  // 2. ISO timestamp at start: "2025-12-24T12:00:00Z [INFO] message"
  const isoMatch = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+\[?(\w+)\]?\s*(.*)$/,
  )
  if (isoMatch?.[1] && isoMatch[2] && isoMatch[3]) {
    return {
      timestamp: isoMatch[1],
      severity: isoMatch[2].toUpperCase(),
      message: isoMatch[3].trim(),
    }
  }

  // 3. Syslog format: "Dec 24 12:00:00 host service[pid]: [INFO] message"
  const syslogMatch = line.match(
    /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+.*?\[\d+\]:\s*\[?(\w+)\]?\s*(.*)$/,
  )
  if (syslogMatch?.[1] && syslogMatch[2] && syslogMatch[3]) {
    return {
      timestamp: syslogMatch[1],
      severity: syslogMatch[2].toUpperCase(),
      message: syslogMatch[3].trim(),
    }
  }

  // 4. Simple bracket format: "[INFO] message" or "INFO message"
  const simpleMatch = line.match(/^\[?(\w+)\]?\s+(.*)$/)
  if (
    simpleMatch?.[1] &&
    simpleMatch[2] &&
    (SEVERITY_LEVELS as readonly string[]).includes(
      simpleMatch[1].toUpperCase(),
    )
  ) {
    return {
      timestamp: new Date().toISOString(),
      severity: simpleMatch[1].toUpperCase(),
      message: simpleMatch[2].trim(),
    }
  }

  // 5. Fallback: plain text log line
  return {
    timestamp: new Date().toISOString(),
    severity: "INFO",
    message: line.trim(),
  }
}
