/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { jsonColumnType } from 'src/modules_shared/common/utils/dbEngine';
import { ConversationEntity } from 'src/modules/studio-core';
import type { ChatRole, ChatStats, ChatStatus, StoredAttachment, StoredGeneration, ToolRun } from '../types/chatTypes';

/**
 * One message of a chat conversation. Messages form a tree: a reply, an edit or a regeneration is a new child of the
 * same parent, and the active branch is the path from the root to the conversation's `leaf_id`. Deleting a message
 * deletes its subtree, deleting the conversation deletes everything (foreign keys with cascade).
 */
@Entity({ name: 'chat_messages' })
@Index('idx_chat_messages_conv', ['conversationId', 'createdAt'])
@Index('idx_chat_messages_parent', ['parentId'])
export class ChatMessageEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ name: 'conversation_id', type: 'varchar' })
  conversationId: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: ConversationEntity;

  @Column({ name: 'parent_id', type: 'varchar', nullable: true })
  parentId: string | null;

  @ManyToOne(() => ChatMessageEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: ChatMessageEntity | null;

  @Column({ type: 'varchar' })
  role: ChatRole;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'text', nullable: true })
  reasoning: string | null;

  @Column({ name: 'tool_runs', type: jsonColumnType(), default: () => "'[]'" })
  toolRuns: ToolRun[];

  /** Images, videos and sounds the reply asked the studios for (the creation tools of the chat); `null` for a message that has none. */
  @Column({ type: jsonColumnType(), nullable: true })
  generations: StoredGeneration[] | null;

  @Column({ type: jsonColumnType(), default: () => "'[]'" })
  attachments: StoredAttachment[];

  @Column({ name: 'model_id', type: 'varchar', nullable: true })
  modelId: string | null;

  @Column({ type: jsonColumnType(), nullable: true })
  params: Record<string, unknown> | null;

  @Column({ type: 'varchar', default: 'done' })
  status: ChatStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: jsonColumnType(), nullable: true })
  stats: ChatStats | null;

  /** Epoch seconds (float), like every timestamp of the studio tables. */
  @Column({ name: 'created_at', type: 'float' })
  createdAt: number;
}
