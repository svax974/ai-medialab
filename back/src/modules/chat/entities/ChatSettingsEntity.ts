/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { jsonColumnType } from 'src/modules_shared/common/utils/dbEngine';
import { ConversationEntity } from 'src/modules/studio-core';
import type { ChatParams, ChatReasoning } from '../types/chatTypes';

/** The settings of one chat conversation (model, system prompt, sampling, tools) and its active leaf. Created on first use. */
@Entity({ name: 'chat_conversation_settings' })
export class ChatSettingsEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'varchar' })
  conversationId: string;

  @OneToOne(() => ConversationEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: ConversationEntity;

  @Column({ name: 'model_id', type: 'varchar', nullable: true })
  modelId: string | null;

  @Column({ name: 'system_prompt', type: 'text', default: '' })
  systemPrompt: string;

  @Column({ type: jsonColumnType(), default: () => "'{}'" })
  params: ChatParams;

  @Column({ name: 'context_size', type: 'integer', nullable: true })
  contextSize: number | null;

  @Column({ type: 'varchar', default: 'auto' })
  reasoning: ChatReasoning;

  @Column({ type: jsonColumnType(), default: () => `'{"web":false}'` })
  /** `creation` is absent in rows written before the creation tools existed: it then counts as on. */
  tools: { web: boolean; creation?: boolean };

  /** Last message of the active branch (no foreign key: a deleted branch moves it in code). */
  @Column({ name: 'leaf_id', type: 'varchar', nullable: true })
  leafId: string | null;
}
