/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import { jsonColumnType } from 'src/modules_shared/common/utils/dbEngine';

export type VoiceKind = 'clone' | 'design';

/**
 * A voice of the library: a cloning sample (`clone`) or a voice invented from a description (`design`).
 * `filename` is relative to `<data>/uploads` (the 24 kHz reference clip written by the engine).
 */
@Entity({ name: 'voices' })
export class VoiceEntity {
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  kind: VoiceKind;

  @Column({ type: 'varchar', nullable: true })
  filename: string | null;

  @Column({ type: 'text', default: '' })
  transcript: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', nullable: true })
  language: string | null;

  /** Seconds. */
  @Column({ type: 'float', nullable: true })
  duration: number | null;

  /** Waveform preview: 120 values in [0, 1]. */
  @Column({ type: jsonColumnType(), default: () => "'[]'" })
  peaks: number[];

  /** Epoch seconds. */
  @Column({ name: 'created_at', type: 'float' })
  createdAt: number;
}
