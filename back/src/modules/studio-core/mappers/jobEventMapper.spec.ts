/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { mergeProgress, outputToAssetInput, previewToProgress, toBrowserProgress } from './jobEventMapper';

describe('job event mapping', () => {
  it('merges progress payloads into one state and drops the engine job id', () => {
    const a = mergeProgress(undefined, { job_id: 'j', phase: 'loading', load_started_at: 1 });
    const b = mergeProgress(a, { job_id: 'j', phase: 'running', count: 2 });
    const c = mergeProgress(b, { job_id: 'j', index: 0, step: 1, total: 4, preview_url: null });
    expect(c).toEqual({ phase: 'running', load_started_at: 1, count: 2, index: 0, step: 1, total: 4, preview_url: null });
  });

  it('turns a preview event into a preview URL update', () => {
    expect(previewToProgress({ job_id: 'j', index: 0, url: '/media/previews/x.jpg?t=1', path: '/p' })).toEqual({ preview_url: '/media/previews/x.jpg?t=1' });
    expect(previewToProgress({ job_id: 'j' })).toEqual({ preview_url: null });
  });

  it('gives the browser the legacy progress shape: message and conversation ids next to the fields', () => {
    expect(toBrowserProgress('m', 'c', { phase: 'running', step: 2 })).toEqual({ message_id: 'm', conversation_id: 'c', phase: 'running', step: 2 });
  });

  it('maps an output event to an asset row linked to its message', () => {
    expect(
      outputToAssetInput(
        { index: 1, media: 'video', asset_id: 'a', path: '/d/o.mp4', filename: 'o.mp4', thumb: 'a.webp', width: 640, height: 480, seed: 3, duration: 5.2, meta: { fps: 24 } },
        'c1',
        'm1',
      ),
    ).toEqual({
      id: 'a', kind: 'generated', media: 'video', filename: 'o.mp4', thumb: 'a.webp', conversationId: 'c1', messageId: 'm1',
      width: 640, height: 480, seed: 3, duration: 5.2, position: 1, meta: { fps: 24 },
    });
    expect(outputToAssetInput({ index: 0, media: 'audio', asset_id: 'b', path: '/d/a.wav', filename: 'a.wav' }, 'c', 'm')).toMatchObject({
      thumb: null, width: null, height: null, seed: null, duration: null, meta: {},
    });
  });
});
