/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { httpService } from '@/modules_shared/common/core/http/HttpService'
import { configurationService } from '@/modules_shared/common/services/ConfigurationService'
import { EMPTY_ASSET_PAGE, isLibraryListing, isPersistingRequest, privatePath } from '@/modules/private/lib/privateRouting'

/** Error of a studio API call; `status` is the HTTP status (0 when the server was unreachable). */
export class StudioApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The `code` a route adds to its refusal (e.g. `busy`, `no_model`), when it has one. */
    readonly code?: string,
  ) {
    super(message)
    this.name = 'StudioApiError'
  }
}

/**
 * Base URL of the studio routes (`/api/<segment>`, served by Nest modules; media by the engine media relay, see
 * back/src/modules/engine/README.md), which sit next to `/api/v1`.
 */
export function studioApiBase(): string {
  return configurationService.getApiUrl().replace(/\/v\d+\/?$/, '')
}

/** Media files of the engine are relayed by Nest under `/api/media` (the engine returns `/media/...`). */
export function resolveMediaUrl(url: string, apiBase: string = studioApiBase()): string {
  return url.startsWith('/media/') ? `${apiBase}${url}` : url
}

/** The refusal of a request that would keep a trace of a private session (the text is read from the locales when it happens). */
async function privateRefusal(): Promise<never> {
  const { i18n } = await import('@/modules_shared/common/core/i18n/I18n')
  throw new StudioApiError(i18n.get('private.error.unavailable'), 409, 'private')
}

type Payload = { message?: string; statusCode?: number; code?: string } | null

function toError(payload: Payload): StudioApiError {
  return new StudioApiError(payload?.message ?? 'Request failed', payload?.statusCode ?? 0, typeof payload?.code === 'string' ? payload.code : undefined)
}

/**
 * Calls a studio route and resolves the JSON body. `HttpResult` is callback-based; the transport encryption is skipped:
 * these routes answer plain JSON.
 */
export function studioRequest<T>(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown): Promise<T> {
  // Private generation (module `private`): the studio routes answer from memory under `/private`, what would keep a
  // trace in the library or the database is refused, and there is no gallery to list.
  if (isPersistingRequest(method, path)) return privateRefusal()
  if (isLibraryListing(method, path)) return Promise.resolve(EMPTY_ASSET_PAGE as T)
  const url = studioApiBase() + privatePath(path)
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
      .upload(studioApiBase() + privatePath(path), formData, { skipTransport: true, signal, onProgress: onProgress ? (progress) => onProgress(progress.percent) : undefined })
      .then((data) => resolve(data as T))
      .fail((payload) => reject(toError(payload)))
      .error((payload) => reject(toError(payload)))
      .notAuthorized((payload) => reject(toError(payload)))
  })
}
