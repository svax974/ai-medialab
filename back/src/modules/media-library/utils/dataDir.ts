/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { join, resolve } from 'path';
import { resolveAppDataDir } from 'src/modules_shared/common/utils/appDataDir';

/**
 * Data folder shared with the engine: `APP_DATA_DIR`, or `IMAGEGEN_DATA_DIR` (the name the engine reads).
 * Read at call time; throws when neither is set (generation and uploads cannot work without it).
 */
export function studioDataDir(env: Record<string, string | undefined> = process.env): string {
  const dir = resolveAppDataDir(env) ?? env.IMAGEGEN_DATA_DIR?.trim();
  if (!dir) throw new Error('APP_DATA_DIR (or IMAGEGEN_DATA_DIR) is not set: the studio needs the engine data folder.');
  return resolve(dir);
}

export const uploadsDir = (env?: Record<string, string | undefined>): string => join(studioDataDir(env), 'uploads');
export const outputsDir = (env?: Record<string, string | undefined>): string => join(studioDataDir(env), 'outputs');

/** Absolute path of an asset's file (`upload` in `uploads/`, anything else in `outputs/`). */
export function assetFilePath(kind: string, filename: string, env?: Record<string, string | undefined>): string {
  return join(kind === 'upload' ? uploadsDir(env) : outputsDir(env), filename);
}
