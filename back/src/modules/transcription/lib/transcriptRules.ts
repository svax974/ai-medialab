/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { UnprocessableEntityException } from '@nestjs/common';
import { extname } from 'path';
import { tr } from 'src/modules/i18n';

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_TEXT_CHARACTERS = 1_000_000;
const EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.m4a', '.mp3', '.wav', '.flac', '.ogg', '.opus', '.aac']);

/** Canonical YouTube video only: no arbitrary hosts, credentials, playlist or downloader options. */
export function youtubeUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (value.length > 2048 || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error();
    const parts = url.pathname.split('/').filter(Boolean);
    const host = url.hostname.toLowerCase();
    let id = host === 'youtu.be' && parts.length === 1 ? parts[0] : '';
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v') ?? '';
      else if (parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0])) id = parts[1];
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error();
    return `https://www.youtube.com/watch?v=${id}`;
  } catch {
    throw new UnprocessableEntityException(tr('transcription.error.url'));
  }
}

export function sourceExtension(name: string): string {
  const extension = extname(name).toLowerCase();
  if (!EXTENSIONS.has(extension)) throw new UnprocessableEntityException(tr('transcription.error.format'));
  return extension;
}

export function optionalField(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new UnprocessableEntityException(tr('transcription.error.input'));
  return value.trim() || undefined;
}

export function transcriptLanguage(value: unknown): string | null {
  const language = optionalField(value);
  if (!language || language === 'auto') return null;
  if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language)) throw new UnprocessableEntityException(tr('transcription.error.language'));
  return language;
}

export function transcriptFileName(title: string): string {
  return `${title.replace(/[\\/\r\n\x00-\x1f<>:"|?*]/g, '_').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 100) || 'transcription'}.txt`;
}
