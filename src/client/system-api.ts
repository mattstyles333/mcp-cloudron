/**
 * System API
 * System status, storage, domains, and services operations
 */

import {
  STORAGE_CRITICAL_THRESHOLD,
  STORAGE_WARNING_THRESHOLD,
} from "../config.js"
import { CloudronError } from "../errors.js"
import type {
  Domain,
  Filesystem,
  FilesystemsResponse,
  Service,
  ServiceStatusResponse,
  ServicesResponse,
  StorageInfo,
  SystemInfo,
  SystemStatus,
} from "../types.js"
import type { HttpClient } from "./http-client.js"

const BYTES_PER_MB = 1024 * 1024

/**
 * Turn the root filesystem entry into StorageInfo
 */
export function toStorageInfo(
  filesystems: Record<string, Filesystem>,
  requiredMB?: number,
): StorageInfo {
  const all = Object.values(filesystems)
  const rootFs = all.find(fs => fs.mountpoint === "/") ?? all[0]
  if (!rootFs) {
    throw new CloudronError("Disk information not available")
  }

  const available_mb = Math.floor(rootFs.available / BYTES_PER_MB)
  const total_mb = Math.floor(rootFs.size / BYTES_PER_MB)
  const used_mb = Math.floor(rootFs.used / BYTES_PER_MB)

  return {
    mountpoint: rootFs.mountpoint,
    available_mb,
    total_mb,
    used_mb,
    sufficient: requiredMB === undefined || available_mb >= requiredMB,
    warning: available_mb < total_mb * STORAGE_WARNING_THRESHOLD,
    critical: available_mb < total_mb * STORAGE_CRITICAL_THRESHOLD,
  }
}

/**
 * System API for Cloudron system operations
 */
export class SystemApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/cloudron/status (only reports the version)
   */
  async getStatus(): Promise<SystemStatus> {
    return await this.http.get<SystemStatus>("/api/v1/cloudron/status")
  }

  /**
   * GET /api/v1/system/info (vendor, uptime, reboot required)
   */
  async getInfo(): Promise<SystemInfo> {
    const response = await this.http.get<{ info: SystemInfo }>(
      "/api/v1/system/info",
    )
    return response.info
  }

  /**
   * GET /api/v1/system/filesystems (sizes in bytes)
   */
  async getFilesystems(): Promise<Record<string, Filesystem>> {
    const response = await this.http.get<FilesystemsResponse>(
      "/api/v1/system/filesystems",
    )
    return response.filesystems
  }

  /**
   * Check free space on the root filesystem
   * @param requiredMB - Optional required disk space in MB
   */
  async checkStorage(requiredMB?: number): Promise<StorageInfo> {
    return toStorageInfo(await this.getFilesystems(), requiredMB)
  }

  /**
   * GET /api/v1/domains
   */
  async listDomains(): Promise<Domain[]> {
    const response = await this.http.get<{ domains: Domain[] }>(
      "/api/v1/domains",
    )
    return response.domains
  }

  /**
   * GET /api/v1/services/:service
   */
  async getService(serviceId: string): Promise<Service> {
    if (!serviceId) {
      throw new CloudronError("serviceId is required")
    }
    const response = await this.http.get<ServiceStatusResponse>(
      `/api/v1/services/${encodeURIComponent(serviceId)}`,
    )
    const { service } = response
    return {
      id: serviceId,
      name: service.name ?? serviceId,
      status: service.status ?? "unknown",
      ...(service.memoryUsed !== undefined && {
        memoryUsed: service.memoryUsed,
      }),
      ...(service.memoryPercent !== undefined && {
        memoryPercent: service.memoryPercent,
      }),
      ...(service.error && { error: service.error }),
    }
  }

  /**
   * GET /api/v1/services, then each service's status in parallel.
   * A service whose status call fails is reported as "unknown".
   */
  async listServices(): Promise<Service[]> {
    const response = await this.http.get<ServicesResponse>("/api/v1/services")
    return await Promise.all(
      response.services.map(async ({ id, name }) => {
        try {
          return { ...(await this.getService(id)), name }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return { id, name, status: "unknown", error: message }
        }
      }),
    )
  }

  /**
   * POST /api/v1/services/:service/restart
   */
  async restartService(serviceId: string): Promise<void> {
    if (!serviceId) {
      throw new CloudronError("serviceId is required")
    }
    await this.http.post(
      `/api/v1/services/${encodeURIComponent(serviceId)}/restart`,
    )
  }
}
