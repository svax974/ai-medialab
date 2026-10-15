/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ChatMessage } from '../types'

/**
 * The tree of messages of a private chat conversation, held by the browser. It follows what the server does for the
 * persistent chat (`back/src/modules/chat/README.md`, « Arbre et réglages »): a message has a `parent_id`, its siblings
 * share its parent and role, the active branch is the path from the root to the leaf, and a message deleted takes what
 * follows it. All functions are pure and work on the map `id -> message` in creation order.
 */
export type Tree = ReadonlyMap<string, ChatMessage>

/** Creation time in seconds, strictly after every message of the tree (two messages of the same millisecond keep their order). */
export function nextCreatedAt(tree: Tree, now: number = Date.now() / 1000): number {
  let latest = 0
  for (const m of tree.values()) latest = Math.max(latest, m.created_at)
  return Math.max(now, latest + 0.001)
}

/** The messages that answer `parentId` (`null`: the roots), oldest first. */
export function childrenOf(tree: Tree, parentId: string | null): ChatMessage[] {
  return [...tree.values()].filter((m) => m.parent_id === parentId).sort((a, b) => a.created_at - b.created_at)
}

/** Same parent and same role, itself included, oldest first. */
export function siblingsOf(tree: Tree, message: ChatMessage): ChatMessage[] {
  return childrenOf(tree, message.parent_id).filter((m) => m.role === message.role)
}

/** The path from the root to `leafId` (empty without a leaf or when it is unknown). */
export function branchTo(tree: Tree, leafId: string | null): ChatMessage[] {
  const path: ChatMessage[] = []
  let current = leafId ? tree.get(leafId) : undefined
  while (current) {
    path.unshift(current)
    current = current.parent_id ? tree.get(current.parent_id) : undefined
  }
  return path
}

/** A message as the interface reads it: with its siblings and its position among them. */
export function withSiblings(tree: Tree, message: ChatMessage): ChatMessage {
  const siblings = siblingsOf(tree, message)
  return { ...message, sibling_ids: siblings.map((m) => m.id), sibling_index: Math.max(0, siblings.findIndex((m) => m.id === message.id)) }
}

/** The active branch as the interface reads it. */
export function activeBranch(tree: Tree, leafId: string | null): ChatMessage[] {
  return branchTo(tree, leafId).map((m) => withSiblings(tree, m))
}

/** Following the most recent child down from `id` to the last message of that branch: the leaf a branch change shows. */
export function newestLeafBelow(tree: Tree, id: string): string {
  let current = id
  for (;;) {
    const children = childrenOf(tree, current)
    if (children.length === 0) return current
    current = children[children.length - 1].id
  }
}

/** The ids of a message and of everything below it. */
export function subtreeIds(tree: Tree, id: string): string[] {
  const ids = [id]
  for (const child of childrenOf(tree, id)) ids.push(...subtreeIds(tree, child.id))
  return ids
}

/** Where the leaf goes once `removed` (and what follows it) is gone: the most recent sibling branch, else the parent, else nowhere. */
export function leafAfterRemoval(tree: Tree, removed: ChatMessage): string | null {
  const sibling = siblingsOf(tree, removed).filter((m) => m.id !== removed.id).pop()
  return sibling ? newestLeafBelow(tree, sibling.id) : removed.parent_id
}

/** What the server needs of a message to rebuild the conversation the model reads. */
export interface HistoryItem {
  role: 'user' | 'assistant'
  content: string
  attachments: { name: string; original_name: string }[]
}

/** The history sent with a request: the branch up to the user message being answered, the final texts only. */
export function historyTo(tree: Tree, userMessageId: string): HistoryItem[] {
  return branchTo(tree, userMessageId)
    .filter((m) => m.role === 'user' || m.content.trim() !== '')
    .map((m) => ({
      role: m.role,
      content: m.content,
      attachments: m.role === 'user' ? m.attachments.map((a) => ({ name: a.name, original_name: a.original_name || a.name })) : [],
    }))
}

/** The text of an exported conversation: the active branch in Markdown. */
export function toMarkdown(title: string, branch: ChatMessage[], names: (message: ChatMessage) => string): string {
  const blocks = branch.map((m) => `## ${m.role === 'user' ? 'Vous' : names(m)}\n\n${m.content.trim()}`)
  return `# ${title}\n\n${blocks.join('\n\n')}\n`
}
