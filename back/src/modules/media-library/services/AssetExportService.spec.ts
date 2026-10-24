/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { EngineClient } from 'src/modules/engine';
import { AssetExportService, EXPORT_PRESETS } from './AssetExportService';
import type { AssetService } from './AssetService';

const video = { id: 'a1', kind: 'generated', media: 'video', filename: 'clip.mp4' };

function build(entity: unknown, reply: Record<string, unknown> = { filename: 'clip-360p15.mp4', width: 640, height: 360, fps: 15, bytes: 1234 }) {
  const post = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(reply);
  const assets = { getEntity: jest.fn<(id: string) => Promise<unknown>>().mockResolvedValue(entity) } as unknown as AssetService;
  return { service: new AssetExportService(assets, { post } as unknown as EngineClient), post };
}

describe('AssetExportService', () => {
  const previous = process.env.APP_DATA_DIR;
  beforeAll(() => { process.env.APP_DATA_DIR = '/data'; });
  afterAll(() => { process.env.APP_DATA_DIR = previous; });

  it('asks the engine for the weight of the preset and returns the media URL of the copy', async () => {
    const { service, post } = build(video);
    await expect(service.exportVideo('a1', 'light')).resolves.toEqual({ url: '/media/exports/clip-360p15.mp4', width: 640, height: 360, fps: 15, bytes: 1234 });
    expect(post).toHaveBeenCalledWith('/engine/v1/media/video-export', expect.objectContaining({
      body: { source_path: '/data/outputs/clip.mp4', short_side: EXPORT_PRESETS.light.shortSide, max_fps: EXPORT_PRESETS.light.maxFps, format: 'mp4' },
    }));
  });

  it('asks for a GIF with the GIF presets', async () => {
    const { service, post } = build(video, { filename: 'clip-320p12.gif', width: 568, height: 320, fps: 12, bytes: 99 });
    await expect(service.exportVideo('a1', 'gif')).resolves.toMatchObject({ url: '/media/exports/clip-320p12.gif' });
    expect(post).toHaveBeenCalledWith('/engine/v1/media/video-export', expect.objectContaining({ body: expect.objectContaining({ format: 'gif', short_side: 320, max_fps: 12 }) }));
  });

  it('refuses an unknown preset, a missing asset and anything but a video', async () => {
    await expect(build(video).service.exportVideo('a1', 'huge')).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(build(null).service.exportVideo('a1', 'tiny')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ ...video, media: 'image' }).service.exportVideo('a1', 'tiny')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
