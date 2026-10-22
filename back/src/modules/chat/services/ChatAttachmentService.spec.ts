/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ChatMessageEntity } from '../entities/ChatMessageEntity';
import { ChatAttachmentService, META_DIR, cleanName, decodeText, sniffImage } from './ChatAttachmentService';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(40, 3)]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1'), Buffer.alloc(30, 4)]);

describe('sniffing', () => {
  it('recognises the images by their first bytes and nothing else', () => {
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(JPG)).toBe('jpg');
    expect(sniffImage(GIF)).toBe('gif');
    expect(sniffImage(WEBP)).toBe('webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull(); // SVG can carry scripts: not an image here
    expect(sniffImage(Buffer.from('%PDF-1.4'))).toBeNull();
    expect(sniffImage(Buffer.from('RIFF....WAVEfmt '))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it('accepts UTF-8 text and refuses binary content', () => {
    expect(decodeText(Buffer.from('Bonjour — été ✓'))).toBe('Bonjour — été ✓');
    expect(decodeText(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]))).toBeNull(); // a zip: NUL bytes
    expect(decodeText(Buffer.from([0xff, 0xfe, 0xfa]))).toBeNull(); // not UTF-8
  });

  it('cleans a file name for display', () => {
    expect(cleanName('../../etc/passwd')).toBe('passwd');
    expect(cleanName('C:\\Users\\me\\notes.txt')).toBe('notes.txt');
    expect(cleanName('a\u0000b\nc.txt')).toBe('abc.txt');
    expect(cleanName('')).toBe('fichier');
    expect(cleanName('x'.repeat(300)).length).toBe(120);
  });
});

describe('ChatAttachmentService', () => {
  const root = mkdtempSync(join(tmpdir(), 'chat-attachments-'));
  const uploads = join(root, 'uploads');
  let messages: Pick<ChatMessageEntity, 'attachments'>[] = [];
  let service: ChatAttachmentService;
  let counter = 0;

  beforeAll(() => {
    process.env.APP_DATA_DIR = root;
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  beforeEach(() => {
    rmSync(uploads, { recursive: true, force: true });
    mkdirSync(uploads, { recursive: true });
    messages = [];
    service = new ChatAttachmentService({ all: async () => messages } as never);
  });

  /** What multer leaves: a raw file in `uploads/`, under its temporary name. */
  const upload = (content: Buffer | string, originalname: string) => {
    const path = join(uploads, `tmp_${counter++}`);
    writeFileSync(path, content);
    return { path, originalname, size: Buffer.byteLength(content) };
  };

  it('stores an image under a generated name, with its description, and gives the browser a preview URL', async () => {
    const a = await service.accept(upload(PNG, 'ma photo.PNG'));
    expect(a).toMatchObject({ kind: 'image', original_name: 'ma photo.PNG', mime: 'image/png', size: PNG.length });
    expect(a.name).toMatch(/^chat_[0-9a-f]{16}\.png$/);
    expect(a.url).toBe(`/api/media/uploads/${a.name}`);
    expect(existsSync(join(uploads, a.name))).toBe(true);
    expect(readdirSync(uploads).filter((f) => f.startsWith('tmp_'))).toEqual([]);
    expect(existsSync(join(uploads, META_DIR, `${a.name}.json`))).toBe(true);
  });

  it('recognises the type from the bytes, whatever the declared name says', async () => {
    expect((await service.accept(upload(JPG, 'faux.txt'))).name).toMatch(/\.jpg$/);
    expect((await service.accept(upload(WEBP, 'x.png'))).name).toMatch(/\.webp$/);
    expect((await service.accept(upload(GIF, 'x'))).mime).toBe('image/gif');
    const text = await service.accept(upload('# titre\ncontenu', 'faux.png'));
    expect(text).toMatchObject({ kind: 'text', mime: 'text/plain' });
    expect(text.name).toMatch(/\.txt$/); // a text file never keeps an image extension
    expect(text.url).toBeUndefined();
  });

  it('keeps a plausible extension for text files', async () => {
    expect((await service.accept(upload('print(1)', 'script.PY'))).name).toMatch(/\.py$/);
    expect((await service.accept(upload('a', 'weird.toolongext'))).name).toMatch(/\.txt$/);
  });

  it('refuses binary files and removes the raw upload', async () => {
    const raw = upload(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0]), 'archive.zip');
    await expect(service.accept(raw)).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(existsSync(raw.path)).toBe(false);
    expect(readdirSync(uploads).filter((f) => f.startsWith('chat_'))).toEqual([]);
  });

  it('refuses a text file above 1 MB and an image above 10 MB', async () => {
    await expect(service.accept(upload('a'.repeat(1024 * 1024 + 1), 'big.txt'))).rejects.toThrow(/1 Mo/);
    const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
    await expect(service.accept(upload(big, 'big.png'))).rejects.toThrow(/10 Mo/);
  });

  it('resolves the names a client sends back, and refuses an unknown one', async () => {
    const a = await service.accept(upload(PNG, 'a.png'));
    expect(await service.resolve([a.name])).toEqual([{ kind: 'image', name: a.name, original_name: 'a.png', mime: 'image/png', size: PNG.length }]);
    await expect(service.resolve(['chat_00000000deadbeef.png'])).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('describes a file whose description was lost', async () => {
    const name = 'chat_aaaaaaaaaaaaaaaa.png';
    writeFileSync(join(uploads, name), PNG);
    expect(await service.resolve([name])).toEqual([{ kind: 'image', name, original_name: name, mime: 'image/png', size: PNG.length }]);
  });

  it('builds paths only for generated names (no traversal)', () => {
    expect(service.pathOf('chat_0123456789abcdef.png')).toBe(join(uploads, 'chat_0123456789abcdef.png'));
    for (const bad of ['../x', 'chat_x.png', '/etc/passwd', 'chat_0123456789abcdef.png/../../x', 'chat_0123456789abcdef.', 'CHAT_0123456789abcdef.png']) {
      expect(() => service.pathOf(bad)).toThrow();
    }
  });

  it('reads a text attachment', async () => {
    const a = await service.accept(upload('ligne', 'n.txt'));
    expect(await service.readText(a.name)).toBe('ligne');
  });

  it('deletes only the attachments no message uses any more', async () => {
    const a = await service.accept(upload(PNG, 'a.png'));
    const b = await service.accept(upload(JPG, 'b.jpg'));
    const stored = await service.resolve([a.name, b.name]);
    messages = [{ attachments: [stored[1]] }]; // a message still uses b (an edit shares its files with the original)
    await service.purgeUnused('c', stored);
    expect(existsSync(join(uploads, a.name))).toBe(false);
    expect(existsSync(join(uploads, META_DIR, `${a.name}.json`))).toBe(false);
    expect(existsSync(join(uploads, b.name))).toBe(true);
  });

  it('deletes every attachment of a conversation', async () => {
    const a = await service.accept(upload(PNG, 'a.png'));
    messages = [{ attachments: await service.resolve([a.name]) }];
    await service.purgeConversation('c');
    expect(existsSync(join(uploads, a.name))).toBe(false);
  });

  it('never deletes anything but chat attachments', async () => {
    writeFileSync(join(uploads, 'photo.png'), PNG);
    messages = [{ attachments: [{ kind: 'image', name: 'photo.png', original_name: 'x', mime: 'image/png', size: 1 }] }];
    await service.purgeConversation('c');
    await service.purgeUnused('c', [{ kind: 'image', name: '../photo.png', original_name: 'x', mime: 'image/png', size: 1 }]);
    expect(existsSync(join(uploads, 'photo.png'))).toBe(true);
  });

  it('sweeps uploads that were never sent once they are a day old', async () => {
    const fresh = await service.accept(upload(PNG, 'fresh.png'));
    const stale = await service.accept(upload(JPG, 'stale.jpg'));
    const kept = await service.accept(upload(GIF, 'kept.gif'));
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    for (const n of [stale.name, kept.name]) utimesSync(join(uploads, n), old, old);
    expect(await service.sweepOrphans(new Set([kept.name]))).toBe(1);
    expect(existsSync(join(uploads, fresh.name))).toBe(true);
    expect(existsSync(join(uploads, stale.name))).toBe(false);
    expect(existsSync(join(uploads, kept.name))).toBe(true);
    expect(statSync(uploads).isDirectory()).toBe(true);
  });
});
