/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MessageEntity } from './MessageEntity';

/** Link between a prompt and an asset it uses as reference (image, voice sample, source clip), in display order. */
@Entity({ name: 'message_refs' })
export class MessageRefEntity {
  @PrimaryColumn({ name: 'message_id', type: 'varchar' })
  messageId: string;

  @ManyToOne(() => MessageEntity, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'message_id' })
  message?: MessageEntity;

  @PrimaryColumn({ name: 'asset_id', type: 'varchar' })
  assetId: string;

  /** Asset of media-library, referenced by name (studio-core depends on media-library, not the other way round). */
  @ManyToOne('AssetEntity', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'asset_id' })
  asset?: unknown;

  @Column({ type: 'integer' })
  position: number;
}
