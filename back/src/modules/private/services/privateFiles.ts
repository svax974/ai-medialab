/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { randomBytes } from 'crypto';
import { mkdirSync, readdirSync, rmSync } from 'fs';
import { rm } from 'fs/promises';
import { basename, join } from 'path';
import { studioDataDir } from 'src/modules/media-library';

/** Subfolders of a session: references, outputs, thumbnails, previews (the engine's) and the raw uploads waiting to be ingested. */
export const SESSION_FOLDERS = ['inputs', 'outputs', 'thumbs', 'previews', 'tmp'] as const;
export type SessionFolder = (typeof SESSION_FOLDERS)[number];
/** Marker that keeps Spotlight (macOS) from indexing a folder. */
export const NEVER_INDEX = '.metadata_never_index';

let activeId: string | null = null;
/** The session whose folders receive uploads (multer decides the destination of a file before any service runs). */
export const setActiveSessionId = (id: string | null): void => { activeId = id; };
export const activeSessionId = (): string | null => activeId;

/** Random, unguessable, accepted by the engine (`[A-Za-z0-9_-]{16,64}`). */
export const newSessionId = (): string => `s${randomBytes(16).toString('hex')}`;

export const privateRoot = (): string => join(studioDataDir(), 'private');
export const sessionPath = (id: string): string => join(privateRoot(), id);

/** A file name without any folder part (`..`, separators): what the engine and the browser may name. */
export function safeName(name: string): string {
  if (!name || basename(name) !== name || name === '.' || name === '..') throw new Error('invalid private file name');
  return name;
}

export function createSessionFolders(id: string): string {
  const dir = sessionPath(id);
  for (const folder of SESSION_FOLDERS) mkdirSync(join(dir, folder), { recursive: true, mode: 0o700 });
  return dir;
}

/** Removes a file of a session folder; a missing one is fine. */
export async function removeSessionFile(id: string, folder: SessionFolder, name: string | null | undefined): Promise<void> {
  if (name) await rm(join(sessionPath(id), folder, safeName(name)), { force: true });
}

export async function removeSession(id: string): Promise<void> {
  await rm(sessionPath(id), { recursive: true, force: true });
}

/** Synchronous variants for the last moments of the process (`exit`, signals), where nothing asynchronous runs. */
export function removeSessionSync(id: string): void {
  rmSync(sessionPath(id), { recursive: true, force: true });
}

/** Removes every folder under `<data>/private` (what an earlier run left behind); the root itself stays. */
export function sweepPrivateRoot(): number {
  const root = privateRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let removed = 0;
  for (const entry of readdirSync(root)) {
    if (entry === NEVER_INDEX) continue;
    rmSync(join(root, entry), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}
