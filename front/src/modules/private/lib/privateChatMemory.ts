/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ChatAttachment, ChatMessage, ChatSettings } from '@/modules/chat/types'

/** A private chat conversation as the browser holds it: its settings and its tree of messages, in creation order. */
export interface PrivateChat {
  settings: ChatSettings
  messages: Map<string, ChatMessage>
}

/**
 * Where the conversations of a private chat live: this page's memory and nowhere else (never `localStorage`, never the
 * server: it only gets the history with each request). Dropped when the session ends, is erased, or the conversation
 * is deleted; the streams still running are aborted at the same time.
 */
const chats = new Map<string, PrivateChat>()
const uploads = new Map<string, ChatAttachment>()
const streams = new Set<AbortController>()
const cleanups = new Set<() => void>()

export const privateChats = {
  get: (id: string): PrivateChat | undefined => chats.get(id),
  set: (id: string, chat: PrivateChat): PrivateChat => {
    chats.set(id, chat)
    return chat
  },
  /** Every conversation (for the search). */
  all: (): [string, PrivateChat][] => [...chats.entries()],
  /** The files uploaded in this session, by stored name: the history names a text file by what the user picked. */
  rememberUpload: (attachment: ChatAttachment): void => void uploads.set(attachment.name, attachment),
  upload: (name: string): ChatAttachment | undefined => uploads.get(name),
}

/** An answer being read: aborted when what it writes into is forgotten. Returns the function that stops tracking it. */
export function trackPrivateStream(controller: AbortController): () => void {
  streams.add(controller)
  return () => void streams.delete(controller)
}

/** Registers what else the chat holds that must go with the session (live state, blob links of an export...). */
export function registerPrivateCleanup(cleanup: () => void): void {
  cleanups.add(cleanup)
}

/** Forgets one conversation (deleted from the list): its tree, and the answer it may be writing. */
export function forgetPrivateChat(id: string): void {
  chats.delete(id)
}

/** Forgets every private conversation and upload, aborts the answers in progress and runs the registered cleanups. */
export function forgetPrivateChats(): void {
  streams.forEach((controller) => controller.abort())
  streams.clear()
  chats.clear()
  uploads.clear()
  cleanups.forEach((cleanup) => cleanup())
}
