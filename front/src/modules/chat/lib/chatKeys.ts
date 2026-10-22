/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** TanStack Query keys of the chat module. */
export const chatKeys = {
  conversation: (id: string) => ['chat', 'conversation', id] as const,
  search: (query: string) => ['chat', 'search', query] as const,
  siblings: (conversationId: string, messageId: string) => ['chat', 'siblings', conversationId, messageId] as const,
}
