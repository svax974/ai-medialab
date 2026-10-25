/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { BadGatewayException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { AssetExportService } from './AssetExportService';
import { AssetShareService } from './AssetShareService';
import type { AssetService } from './AssetService';
import { sharePlan } from '../utils/shareCommands';
import type { ShareCommand } from '../utils/shareCommands';

const photo = { id: 'a1', kind: 'generated', media: 'image', filename: 'cat.png' };

function build(entity: unknown, platform: NodeJS.Platform = 'darwin', failing: string[] = []) {
  const assets = { getEntity: jest.fn<(id: string) => Promise<unknown>>().mockResolvedValue(entity) } as unknown as AssetService;
  const exportVideo = jest.fn<(id: string, preset: unknown) => Promise<unknown>>().mockResolvedValue({ url: '/media/exports/clip-360p15.mp4' });
  const service = new AssetShareService(assets, { exportVideo } as unknown as AssetExportService);
  const ran: ShareCommand[] = [];
  service.platform = platform;
  service.exec = async (command) => {
    ran.push(command);
    if (failing.some((part) => command.args.join(' ').includes(part))) throw new Error('boom');
  };
  return { service, ran, exportVideo };
}

describe('AssetShareService', () => {
  const previous = process.env.APP_DATA_DIR;
  beforeAll(() => { process.env.APP_DATA_DIR = '/data'; });
  afterAll(() => { process.env.APP_DATA_DIR = previous; });

  it('attaches the file to a Mail message on macOS, the text passed as an argument', async () => {
    const { service, ran } = build(photo);
    await expect(service.share('a1', { service: 'mail', text: 'a prompt', subject: 'Hi' })).resolves.toEqual({ outcome: 'attached' });
    expect(ran).toHaveLength(1);
    expect(ran[0].file).toBe('osascript');
    expect(ran[0].args.slice(-4)).toEqual(['--', '/data/outputs/cat.png', 'Hi', 'a prompt']);
  });

  it('copies the file to the clipboard then opens the service for the others', async () => {
    const { service, ran } = build(photo);
    await expect(service.share('a1', { service: 'x', text: 'a b' })).resolves.toEqual({ outcome: 'clipboard' });
    expect(ran.map((command) => command.file)).toEqual(['osascript', 'open']);
    expect(ran[1].args).toEqual(['https://x.com/intent/post?text=a%20b']);
  });

  it('opens WhatsApp in its application, or on the web when it is not installed', async () => {
    const { service, ran } = build(photo, 'darwin', ['whatsapp://']);
    await service.share('a1', { service: 'whatsapp', text: 'hi' });
    expect(ran.map((command) => command.args[0])).toEqual([expect.stringContaining('-e'), 'whatsapp://send?text=hi', 'https://wa.me/?text=hi']);
  });

  it('shares a light copy of a video, from the exports folder', async () => {
    const { service, ran, exportVideo } = build({ ...photo, media: 'video', filename: 'clip.mp4' });
    await service.share('a1', { service: 'messages', preset: 'light' });
    expect(exportVideo).toHaveBeenCalledWith('a1', 'light');
    expect(ran[0].args.at(-1)).toBe('/data/exports/clip-360p15.mp4');
  });

  it('opens the service with the text only where no file can be carried', async () => {
    const { service, ran } = build(photo, 'linux');
    await expect(service.share('a1', { service: 'mail', text: 'x', subject: 's' })).resolves.toEqual({ outcome: 'none' });
    expect(ran).toEqual([{ file: 'xdg-open', args: ['mailto:?subject=s&body=x'] }]);
  });

  it('refuses an unknown service, a missing asset and an unknown preset; reports an application that does not open', async () => {
    await expect(build(photo).service.share('a1', { service: 'telegram' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(build(null).service.share('a1', { service: 'mail' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(build(photo).service.share('a1', { service: 'mail', preset: 'huge' })).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(build(photo, 'darwin', ['Mail']).service.share('a1', { service: 'mail' })).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('plans an Instagram share as clipboard + website on macOS', () => {
    const plan = sharePlan('instagram', 'darwin', { path: '/p.png', text: 't', subject: 's' });
    expect(plan.outcome).toBe('clipboard');
    expect(plan.steps[1]).toEqual([{ file: 'open', args: ['https://www.instagram.com/'] }]);
  });
});
