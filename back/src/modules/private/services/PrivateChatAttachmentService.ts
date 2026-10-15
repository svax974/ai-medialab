/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { ConflictException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { open, readFile, rename, stat, unlink } from 'fs/promises';
import { join } from 'path';
import {
  ATTACHMENT_NAME, MAX_IMAGE_BYTES, MAX_TEXT_BYTES, cleanName, decodeText, sniffImage,
  type ChatAttachment, type StoredAttachment,
} from 'src/modules/chat';
import { decodeUploadName, mediaUrl } from 'src/modules/media-library';
import type { PrivateAttachmentRef } from './privateChatValidation';
import { PrivateSessionService } from './PrivateSessionService';
import { sessionPath } from './privateFiles';

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as const;

const textExtension = (original: string): string => {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(original)?.[1]?.toLowerCase();
  return ext && !(ext in IMAGE_TYPES) ? ext : 'txt';
};

/**
 * Files attached to the messages of the private chat: they live in `<session>/inputs/` as `chat_<16 hex>.<ext>`, with no
 * description file and no row anywhere, and go with the session folder. Images are recognised from their bytes and read
 * by the engine from there; text files are read into the prompt. The same rules and limits as the normal chat.
 */
@Injectable()
export class PrivateChatAttachmentService {
  constructor(private readonly session: PrivateSessionService) {}

  private folder(): string {
    this.session.touch();
    if (!this.session.active) throw new ConflictException("Aucune session privée n'est ouverte.");
    return join(sessionPath(this.session.sessionId), 'inputs');
  }

  /** Checks an upload (`file.path` is the raw file multer wrote in `<session>/tmp`) and gives it its final name. 422 when refused. */
  async accept(file: { path: string; originalname: string }): Promise<ChatAttachment> {
    try {
      const folder = this.folder();
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
        if (size > MAX_IMAGE_BYTES) throw new UnprocessableEntityException('Image trop lourde (10 Mo au plus).');
        stored = { kind: 'image', name: this.newName(image), original_name: original, mime: IMAGE_TYPES[image], size };
      } else {
        if (size > MAX_TEXT_BYTES) throw new UnprocessableEntityException('Fichier texte trop lourd (1 Mo au plus).');
        if (decodeText(await readFile(file.path)) === null) {
          throw new UnprocessableEntityException('Type de fichier non pris en charge : images (png, jpeg, webp, gif) et fichiers texte seulement.');
        }
        stored = { kind: 'text', name: this.newName(textExtension(original)), original_name: original, mime: 'text/plain', size };
      }
      await rename(file.path, join(folder, stored.name));
      return { ...stored, ...(stored.kind === 'image' ? { url: mediaUrl(`private/${this.session.sessionId}/inputs`, stored.name) ?? undefined } : {}) };
    } catch (error) {
      await unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  /** The stored attachments for the references of a request (422 when one is not in the session folder). */
  async resolve(refs: PrivateAttachmentRef[]): Promise<StoredAttachment[]> {
    const out: StoredAttachment[] = [];
    for (const ref of refs) {
      const size = await stat(this.pathOf(ref.name)).then((s) => (s.isFile() ? s.size : null), () => null);
      if (size === null) throw new UnprocessableEntityException(`Pièce jointe introuvable : ${ref.name}.`);
      const mime = IMAGE_TYPES[ref.name.split('.').pop() as keyof typeof IMAGE_TYPES];
      out.push({ kind: mime ? 'image' : 'text', name: ref.name, original_name: ref.originalName, mime: mime ?? 'text/plain', size });
    }
    return out;
  }

  /** Absolute path of an attachment of the session (what the engine reads for an image). */
  pathOf(name: string): string {
    if (!ATTACHMENT_NAME.test(name)) throw new Error('Nom de pièce jointe invalide.');
    return join(this.folder(), name);
  }

  async readText(name: string): Promise<string> {
    return decodeText(await readFile(this.pathOf(name))) ?? '[fichier illisible]';
  }

  /** Removes one attachment the user took off before sending (the rest goes with the session). */
  async remove(name: string): Promise<void> {
    if (!ATTACHMENT_NAME.test(name)) throw new UnprocessableEntityException('Nom de pièce jointe invalide.');
    await unlink(join(this.folder(), name)).catch(() => undefined);
  }

  private newName(ext: string): string {
    return `chat_${randomBytes(8).toString('hex')}.${ext}`;
  }
}
