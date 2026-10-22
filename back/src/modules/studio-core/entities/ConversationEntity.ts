/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** The studio a conversation belongs to (`mode` of the legacy database, added after the first release). */
export type ConversationMode = 'image' | 'audio' | 'video' | 'chat' | 'diagram';

/** A thread of generations. Timestamps are epoch seconds (floats), as in the legacy database. */
@Entity({ name: 'conversations' })
@Index('idx_conv_mode', ['mode', 'updatedAt'])
export class ConversationEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ type: 'varchar', default: 'image' })
  mode: ConversationMode;

  @Column({ name: 'created_at', type: 'float' })
  createdAt: number;

  @Column({ name: 'updated_at', type: 'float' })
  updatedAt: number;
}
