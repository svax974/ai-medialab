/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../types'
import { message } from './fixtures'
import {
  activeBranch, branchTo, childrenOf, historyTo, leafAfterRemoval, newestLeafBelow, nextCreatedAt, siblingsOf, subtreeIds, toMarkdown, withSiblings,
} from './privateTree'

/** u1 -> a1, a2 (two answers) ; a1 -> u2 -> a3 ; u1b is another first question. */
function tree(): Map<string, ChatMessage> {
  const list = [
    message('u1', { role: 'user', created_at: 1, content: 'Q1' }),
    message('a1', { role: 'assistant', parent_id: 'u1', created_at: 2, content: 'R1' }),
    message('a2', { role: 'assistant', parent_id: 'u1', created_at: 3, content: 'R1 bis' }),
    message('u2', { role: 'user', parent_id: 'a1', created_at: 4, content: 'Q2' }),
    message('a3', { role: 'assistant', parent_id: 'u2', created_at: 5, content: 'R2' }),
    message('u1b', { role: 'user', created_at: 6, content: 'Q1 bis' }),
  ]
  return new Map(list.map((m) => [m.id, m]))
}

describe('the tree of a private chat', () => {
  it('lists children and siblings oldest first, by parent and role', () => {
    const t = tree()
    expect(childrenOf(t, 'u1').map((m) => m.id)).toEqual(['a1', 'a2'])
    expect(childrenOf(t, null).map((m) => m.id)).toEqual(['u1', 'u1b'])
    expect(siblingsOf(t, t.get('a2') as ChatMessage).map((m) => m.id)).toEqual(['a1', 'a2'])
    expect(siblingsOf(t, t.get('u2') as ChatMessage).map((m) => m.id)).toEqual(['u2'])
  })

  it('reads the active branch root to leaf with the position among the siblings', () => {
    const t = tree()
    expect(branchTo(t, 'a3').map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a3'])
    expect(branchTo(t, null)).toEqual([])
    expect(branchTo(t, 'nope')).toEqual([])
    const branch = activeBranch(t, 'a3')
    expect(branch.map((m) => [m.id, m.sibling_index, m.sibling_ids.length])).toEqual([['u1', 0, 2], ['a1', 0, 2], ['u2', 0, 1], ['a3', 0, 1]])
    expect(withSiblings(t, t.get('a2') as ChatMessage)).toMatchObject({ sibling_index: 1, sibling_ids: ['a1', 'a2'] })
  })

  it('shows the newest leaf of a branch when it is picked', () => {
    const t = tree()
    expect(newestLeafBelow(t, 'a1')).toBe('a3')
    expect(newestLeafBelow(t, 'a2')).toBe('a2')
    expect(newestLeafBelow(t, 'u1')).toBe('a2') // the most recent answer wins
  })

  it('removes a message with what follows it and moves the leaf to the nearest branch', () => {
    const t = tree()
    expect(subtreeIds(t, 'a1').sort()).toEqual(['a1', 'a3', 'u2'])
    expect(leafAfterRemoval(t, t.get('a1') as ChatMessage)).toBe('a2') // the sibling branch
    expect(leafAfterRemoval(t, t.get('a2') as ChatMessage)).toBe('a3') // its older sibling, down to its leaf
    expect(leafAfterRemoval(t, t.get('u2') as ChatMessage)).toBe('a1') // no sibling: the parent
    expect(leafAfterRemoval(t, t.get('u1b') as ChatMessage)).toBe('a2') // another root: its newest branch
    t.delete('u1b')
    expect(leafAfterRemoval(t, t.get('u1') as ChatMessage)).toBeNull()
  })

  it('stamps a message strictly after every other one', () => {
    const t = tree()
    expect(nextCreatedAt(t, 100)).toBe(100)
    expect(nextCreatedAt(t, 2)).toBeCloseTo(6.001, 6)
  })

  it('sends the branch up to the question, final texts only, files by stored and picked name', () => {
    const t = tree()
    t.set('u2', { ...(t.get('u2') as ChatMessage), attachments: [{ kind: 'text', name: 'chat_0123456789abcdef.md', original_name: 'notes.md', mime: 'text/plain', size: 3 }] })
    t.set('a1', { ...(t.get('a1') as ChatMessage), content: '   ' }) // an answer without text is left out
    expect(historyTo(t, 'u2')).toEqual([
      { role: 'user', content: 'Q1', attachments: [] },
      { role: 'user', content: 'Q2', attachments: [{ name: 'chat_0123456789abcdef.md', original_name: 'notes.md' }] },
    ])
  })

  it('exports the branch as Markdown', () => {
    const t = tree()
    expect(toMarkdown('Titre', branchTo(t, 'a1'), () => 'Modèle')).toBe('# Titre\n\n## Vous\n\nQ1\n\n## Modèle\n\nR1\n')
  })
})
