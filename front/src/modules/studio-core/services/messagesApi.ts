/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { studioRequest } from '@/modules/studio-shell/services/studioHttp'
import type { Message, QueueState, RetryRequest, SendMessageRequest, SendMessageResponse } from '../types'

const path = (id: string, action = '') => `/messages/${encodeURIComponent(id)}${action}`

/** `/api/messages*` (Nest, module `studio-core`; same URLs and shapes as the former engine API). */
export const messagesApi = {
  /** Creates a prompt and its queued generation (a new conversation when `conversation_id` is null). */
  send(body: SendMessageRequest): Promise<SendMessageResponse> {
    return studioRequest<SendMessageResponse>('post', '/messages', body)
  },
  retry(id: string, body: RetryRequest = {}): Promise<Message> {
    return studioRequest<Message>('post', path(id, '/retry'), body)
  },
  cancel(id: string): Promise<{ ok: true }> {
    return studioRequest<{ ok: true }>('post', path(id, '/cancel'))
  },
  /** Deleting a prompt takes its generations with it. */
  remove(id: string): Promise<{ ok: true; deleted: string[] }> {
    return studioRequest<{ ok: true; deleted: string[] }>('delete', path(id))
  },
  /** The generation queue (running message and waiting ones, in order): initial state, then `studio.queue.updated`. */
  queue(): Promise<QueueState> {
    return studioRequest<QueueState>('get', '/queue')
  },
}
