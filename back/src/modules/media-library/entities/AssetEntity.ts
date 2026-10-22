/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { jsonColumnType } from 'src/modules_shared/common/utils/dbEngine';

export type AssetKind = 'upload' | 'generated';
export type AssetMedia = 'image' | 'audio' | 'video';

/**
 * A file known to the app: an upload (reference image, sample, source clip) or a generated output.
 * `filename` and `thumb` are file names relative to `<data>/uploads|outputs` and `<data>/thumbs`
 * (the engine and the media route resolve them). Timestamps are epoch seconds (floats), as in the legacy database.
 *
 * `conversationId` / `messageId` point at studio-core entities by name only: media-library never imports studio-core
 * (the dependency goes the other way), and deleting a conversation or message keeps the asset (`SET NULL`).
 */
@Entity({ name: 'assets' })
@Index('idx_assets_kind', ['kind', 'createdAt'])
@Index('idx_assets_media', ['media', 'kind', 'createdAt'])
@Index('idx_assets_message', ['messageId'])
export class AssetEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  kind: AssetKind;

  @Column({ type: 'varchar', default: 'image' })
  media: AssetMedia;

  @Column({ name: 'conversation_id', type: 'varchar', nullable: true })
  conversationId: string | null;

  @ManyToOne('ConversationEntity', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: unknown;

  @Column({ name: 'message_id', type: 'varchar', nullable: true })
  messageId: string | null;

  @ManyToOne('MessageEntity', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'message_id' })
  message?: unknown;

  @Column({ type: 'varchar' })
  filename: string;

  @Column({ type: 'varchar', nullable: true })
  thumb: string | null;

  @Column({ name: 'original_name', type: 'varchar', nullable: true })
  originalName: string | null;

  @Column({ type: 'integer', nullable: true })
  width: number | null;

  @Column({ type: 'integer', nullable: true })
  height: number | null;

  /** The engine draws seeds in [0, 2^31 - 1]. */
  @Column({ type: 'integer', nullable: true })
  seed: number | null;

  /** Seconds, audio and video only. */
  @Column({ type: 'float', nullable: true })
  duration: number | null;

  @Column({ type: 'integer', default: 0 })
  position: number;

  @Column({ type: 'boolean', default: false })
  favorite: boolean;

  @Column({ type: jsonColumnType(), default: () => "'{}'" })
  meta: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'float' })
  createdAt: number;
}
