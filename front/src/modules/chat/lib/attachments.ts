/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ChatAttachment } from '../types'

/** Limits of the contract (`POST /api/chat/attachments`): the server checks them again, by content. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TEXT_BYTES = 1024 * 1024
export const MAX_ATTACHMENTS = 8
/** Longest message the server takes (422 beyond). */
export const MAX_CONTENT_CHARS = 200_000

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs',
  'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql', 'swift', 'lua', 'r', 'tex', 'diff', 'patch',
])

export type AttachmentVerdict =
  | { ok: true; kind: 'image' | 'text' }
  | { ok: false; reason: 'type' | 'size' | 'noVision' | 'tooMany' }

const extensionOf = (name: string): string => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '')

/** Which kind of attachment a file is, by its type and extension (`null`: not accepted). */
export function attachmentKind(file: Pick<File, 'name' | 'type'>): 'image' | 'text' | null {
  if (IMAGE_TYPES.has(file.type)) return 'image'
  if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extensionOf(file.name)) || file.type === 'application/json') return 'text'
  return null
}

/** Whether a file may be attached to the next message: its type, its size, the model's vision and the count. */
export function checkAttachment(file: Pick<File, 'name' | 'type' | 'size'>, options: { vision: boolean; attached: number }): AttachmentVerdict {
  if (options.attached >= MAX_ATTACHMENTS) return { ok: false, reason: 'tooMany' }
  const kind = attachmentKind(file)
  if (!kind) return { ok: false, reason: 'type' }
  if (kind === 'image' && !options.vision) return { ok: false, reason: 'noVision' }
  if (file.size > (kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES)) return { ok: false, reason: 'size' }
  return { ok: true, kind }
}

/** What a send or an edit gives back for the files kept: the STORED names (never the display names), explicitly (`[]` removes them all). */
export const attachmentRefs = (attachments: Pick<ChatAttachment, 'name'>[]): { name: string }[] => attachments.map((a) => ({ name: a.name }))

/** What the interface shows for an attachment: the name the user picked (older rows may lack it: the stored name then). */
export const displayName = (attachment: Pick<ChatAttachment, 'name' | 'original_name'>): string => attachment.original_name || attachment.name

/** Locale key of the refusal shown to the user. */
export const refusalKey = (reason: Extract<AttachmentVerdict, { ok: false }>['reason']): string => `chat.attach.refused.${reason}`
