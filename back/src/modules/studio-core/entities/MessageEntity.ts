/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { jsonColumnType } from 'src/modules_shared/common/utils/dbEngine';
import { ConversationEntity } from './ConversationEntity';

export type MessageRole = 'user' | 'assistant';
/** `queued`, `loading` and `running` are the busy states; a stopped server turns them into `error`. */
export type MessageStatus = 'queued' | 'loading' | 'running' | 'done' | 'error' | 'cancelled';

/**
 * A prompt (`user`) or a generation (`assistant`, whose `parentId` is the prompt it answers).
 * Deleting a conversation deletes its messages; deleting a prompt deletes the generations that answer it.
 */
@Entity({ name: 'messages' })
@Index('idx_messages_conv', ['conversationId', 'createdAt'])
export class MessageEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ name: 'conversation_id', type: 'varchar' })
  conversationId: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: ConversationEntity;

  @Column({ name: 'parent_id', type: 'varchar', nullable: true })
  parentId: string | null;

  @ManyToOne(() => MessageEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent?: MessageEntity | null;

  @Column({ type: 'varchar' })
  role: MessageRole;

  @Column({ type: 'text', default: '' })
  prompt: string;

  @Column({ name: 'model_id', type: 'varchar', nullable: true })
  modelId: string | null;

  /** Generation parameters (size, steps, seeds, voice, ...): free-form, owned by the engine contract. */
  @Column({ type: jsonColumnType(), default: () => "'{}'" })
  params: Record<string, unknown>;

  @Column({ type: 'varchar', default: 'done' })
  status: MessageStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** Why the engine refused or failed the job, when the user can act on it (`memory`: free-memory check, "go on anyway"). */
  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode: string | null;

  @Column({ name: 'created_at', type: 'float' })
  createdAt: number;

  @Column({ name: 'started_at', type: 'float', nullable: true })
  startedAt: number | null;

  @Column({ name: 'finished_at', type: 'float', nullable: true })
  finishedAt: number | null;
}
