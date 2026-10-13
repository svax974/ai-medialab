/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { httpService } from '@/modules_shared/common/core/http/HttpService'
import { configurationService } from '@/modules_shared/common/services/ConfigurationService'

/** Error of a studio API call; `status` is the HTTP status (0 when the server was unreachable). */
export class StudioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'StudioApiError'
  }
}

/**
 * Base URL of the studio routes (`/api/<segment>`, served by Nest modules or, until H6, by the transitional engine proxy: see
 * back/src/modules/engine/README.md), which sit next to `/api/v1`.
 */
export function studioApiBase(): string {
  return configurationService.getApiUrl().replace(/\/v\d+\/?$/, '')
}

/** Media files of the engine are served by the proxy under `/api/media` (the engine returns `/media/...`). */
export function resolveMediaUrl(url: string, apiBase: string = studioApiBase()): string {
  return url.startsWith('/media/') ? `${apiBase}${url}` : url
}

type Payload = { message?: string; statusCode?: number } | null

function toError(payload: Payload): StudioApiError {
  return new StudioApiError(payload?.message ?? 'Request failed', payload?.statusCode ?? 0)
}

/**
 * Calls the proxy and resolves the JSON body. `HttpResult` is callback-based; the transport encryption is skipped:
 * the proxy relays plain JSON to the engine.
 */
export function studioRequest<T>(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown): Promise<T> {
  const url = studioApiBase() + path
  const options = { skipTransport: true }
  return new Promise<T>((resolve, reject) => {
    const result =
      method === 'get'
        ? httpService.get(url, options)
        : method === 'delete'
          ? httpService.delete(url, options)
          : httpService[method](url, body ?? {}, options)
    result
      .then((data) => resolve(data as T))
      .fail((payload) => reject(toError(payload)))
      .error((payload) => reject(toError(payload)))
      .notAuthorized((payload) => reject(toError(payload)))
  })
}

export interface StudioUploadOptions {
  /** Real progress of the upload, 0..100 (`null` while the browser does not know the total). */
  onProgress?: (percent: number | null) => void
  signal?: AbortSignal
}

/** Multipart upload (`HttpService.upload`) with progress; same error mapping and clear transport as `studioRequest`. */
export function studioUpload<T>(path: string, formData: FormData, options: StudioUploadOptions = {}): Promise<T> {
  const { onProgress, signal } = options
  return new Promise<T>((resolve, reject) => {
    httpService
      .upload(studioApiBase() + path, formData, { skipTransport: true, signal, onProgress: onProgress ? (progress) => onProgress(progress.percent) : undefined })
      .then((data) => resolve(data as T))
      .fail((payload) => reject(toError(payload)))
      .error((payload) => reject(toError(payload)))
      .notAuthorized((payload) => reject(toError(payload)))
  })
}
