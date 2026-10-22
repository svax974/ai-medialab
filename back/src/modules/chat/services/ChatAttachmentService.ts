/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { decodeUploadName, uploadsDir } from 'src/modules/media-library';
import { toPublicAttachment } from '../mappers/chatMapper';
import { ChatStoreService } from './ChatStoreService';
import { ATTACHMENT_NAME } from './chatValidation';
import { MAX_IMAGE_BYTES, MAX_TEXT_BYTES, type ChatAttachment, type StoredAttachment } from '../types/chatTypes';

/** Folder (inside `uploads/`) of the small description files kept next to each attachment. */
export const META_DIR = 'chat-meta';
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as const;
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** The image format of the first bytes of a file (the declared type is never trusted), or null. */
export function sniffImage(head: Buffer): keyof typeof IMAGE_TYPES | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (head.length >= 6 && /^GIF8[79]a$/.test(head.subarray(0, 6).toString('latin1'))) return 'gif';
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** Plain text (UTF-8, no NUL byte), or null: a binary file is refused instead of being sent to the model as noise. */
export function decodeText(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** A name safe to show and store: no path, no control characters, at most 120 characters. */
export function cleanName(raw: string): string {
  const printable = [...raw].filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127).join('');
  const base = basename(printable.replace(/\\/g, '/')).trim();
  return (base || 'fichier').slice(0, 120);
}

const textExtension = (original: string): string => {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(original)?.[1]?.toLowerCase();
  return ext && !(ext in IMAGE_TYPES) ? ext : 'txt';
};

/**
 * Files attached to chat messages, kept in `<data>/uploads/` as `chat_<16 hex>.<ext>` (never anywhere else: names are
 * generated here and checked against `ATTACHMENT_NAME` before any path is built). Images are recognised from their bytes
 * and sent to the engine by path (it reads them from the data folder), text files are read into the prompt.
 */
@Injectable()
export class ChatAttachmentService {
  private readonly logger = new Logger(ChatAttachmentService.name);

  constructor(private readonly store: ChatStoreService) {}

  /** Checks an upload (`file.path` is the raw file multer wrote in `uploads/`) and gives it its final name. 422 when refused. */
  async accept(file: { path: string; originalname: string; size: number }): Promise<ChatAttachment> {
    try {
      const original = cleanName(decodeUploadName(file.originalname));
      const handle = await open(file.path, 'r');
      const head = Buffer.alloc(16);
      try {
        await handle.read(head, 0, 16, 0);
      } finally {
        await handle.close();
      }
      const image = sniffImage(head);
      const size = (await stat(file.path)).size;
      let stored: StoredAttachment;
      if (image) {
        if (size > MAX_IMAGE_BYTES) throw new UnprocessableEntityException(tr('chat.error.imageTooBig'));
        stored = { kind: 'image', name: this.newName(image), original_name: original, mime: IMAGE_TYPES[image], size };
      } else {
        if (size > MAX_TEXT_BYTES) throw new UnprocessableEntityException(tr('chat.error.textTooBig'));
        if (decodeText(await readFile(file.path)) === null) {
          throw new UnprocessableEntityException(tr('chat.error.unsupportedFile'));
        }
        stored = { kind: 'text', name: this.newName(textExtension(original)), original_name: original, mime: 'text/plain', size };
      }
      await rename(file.path, this.pathOf(stored.name));
      await this.writeMeta(stored);
      return toPublicAttachment(stored);
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  /** The stored attachments for names a client sent back (422 when one does not exist). */
  async resolve(names: string[]): Promise<StoredAttachment[]> {
    const out: StoredAttachment[] = [];
    for (const name of names) {
      const meta = await this.readMeta(name);
      if (meta) out.push(meta);
      else if (await this.exists(name)) out.push(await this.describe(name));
      else throw new UnprocessableEntityException(tr('chat.error.attachmentNotFound', [name]));
    }
    return out;
  }

  /** Absolute path of a stored attachment (what the engine reads for an image). */
  pathOf(name: string): string {
    if (!ATTACHMENT_NAME.test(name)) throw new Error(tr('chat.error.attachmentNameInvalid'));
    return join(uploadsDir(), name);
  }

  async readText(name: string): Promise<string> {
    return decodeText(await readFile(this.pathOf(name))) ?? '[fichier illisible]';
  }

  /** Deletes the files of attachments that no message of the conversation uses any more. */
  async purgeUnused(conversationId: string, candidates: StoredAttachment[]): Promise<void> {
    if (!candidates.length) return;
    const used = new Set((await this.store.all(conversationId)).flatMap((m) => (m.attachments ?? []).map((a) => a.name)));
    await this.remove(candidates.map((a) => a.name).filter((name) => !used.has(name)));
  }

  /** Deletes every attachment of a conversation (before its rows go). */
  async purgeConversation(conversationId: string): Promise<void> {
    await this.remove((await this.store.all(conversationId)).flatMap((m) => (m.attachments ?? []).map((a) => a.name)));
  }

  /** At startup: files uploaded but never sent (a day old and referenced by no message) are removed. */
  async sweepOrphans(referenced: Set<string>): Promise<number> {
    let files: string[];
    try {
      files = (await readdir(uploadsDir())).filter((f) => ATTACHMENT_NAME.test(f));
    } catch {
      return 0;
    }
    const old: string[] = [];
    for (const name of files) {
      if (referenced.has(name)) continue;
      const age = Date.now() - (await stat(this.pathOf(name)).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      if (age > ORPHAN_AGE_MS) old.push(name);
    }
    await this.remove(old);
    return old.length;
  }

  private async remove(names: string[]): Promise<void> {
    for (const name of new Set(names)) {
      if (!ATTACHMENT_NAME.test(name)) continue;
      await unlink(this.pathOf(name)).catch(() => undefined);
      await unlink(join(uploadsDir(), META_DIR, `${name}.json`)).catch(() => undefined);
    }
  }

  private newName(ext: string): string {
    return `chat_${randomBytes(8).toString('hex')}.${ext}`;
  }

  private async writeMeta(stored: StoredAttachment): Promise<void> {
    await mkdir(join(uploadsDir(), META_DIR), { recursive: true });
    await writeFile(join(uploadsDir(), META_DIR, `${stored.name}.json`), JSON.stringify(stored));
  }

  private async readMeta(name: string): Promise<StoredAttachment | null> {
    if (!ATTACHMENT_NAME.test(name)) return null;
    try {
      const meta = JSON.parse(await readFile(join(uploadsDir(), META_DIR, `${name}.json`), 'utf8')) as StoredAttachment;
      return meta.name === name && (await this.exists(name)) ? meta : null;
    } catch {
      return null;
    }
  }

  private async exists(name: string): Promise<boolean> {
    return stat(this.pathOf(name)).then((s) => s.isFile(), () => false);
  }

  /** An attachment without its description file (lost): its kind and type come from the extension and its size from the disk. */
  private async describe(name: string): Promise<StoredAttachment> {
    const ext = name.split('.').pop() as string;
    const mime = IMAGE_TYPES[ext as keyof typeof IMAGE_TYPES];
    const size = (await stat(this.pathOf(name))).size;
    return { kind: mime ? 'image' : 'text', name, original_name: name, mime: mime ?? 'text/plain', size };
  }
}
