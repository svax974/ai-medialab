/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
import { parseTranscribeVoice, parseUpdateVoice, parseUploadVoice, parseVoiceFromAsset } from './voiceParams';

describe('voice parameters', () => {
  it('upload: missing fields are empty, the kind is clone unless "design"', () => {
    expect(parseUploadVoice(undefined)).toEqual({ name: '', transcript: '', language: null, description: '', kind: 'clone' });
    expect(parseUploadVoice({ name: 'A', language: 'fr', kind: 'design', description: 'd', transcript: 't' })).toEqual({
      name: 'A', transcript: 't', language: 'fr', description: 'd', kind: 'design',
    });
    expect(parseUploadVoice({ kind: 'weird', language: '' }).kind).toBe('clone');
    expect(parseUploadVoice({ language: '' }).language).toBeNull();
  });

  it('from-asset: asset_id required, kind design unless "clone"', () => {
    expect(parseVoiceFromAsset({ asset_id: 'a' })).toEqual({ assetId: 'a', name: '', description: '', transcript: '', language: null, kind: 'design' });
    expect(parseVoiceFromAsset({ asset_id: 'a', kind: 'clone', name: 'N' })).toMatchObject({ kind: 'clone', name: 'N' });
    expect(() => parseVoiceFromAsset({})).toThrow(UnprocessableEntityException);
    expect(() => parseVoiceFromAsset(null)).toThrow(UnprocessableEntityException);
    expect(() => parseVoiceFromAsset({ asset_id: 'a', name: 3 })).toThrow('name : texte attendu.');
  });

  it('patch: only the present text fields, an empty string is kept (clears the transcript)', () => {
    expect(parseUpdateVoice({ transcript: '', name: 'x', other: 1 })).toEqual({ transcript: '', name: 'x' });
    expect(parseUpdateVoice({})).toEqual({});
    expect(() => parseUpdateVoice([])).toThrow(UnprocessableEntityException);
    expect(() => parseUpdateVoice({ language: false })).toThrow('language : texte attendu.');
  });

  it('transcribe: optional language and model', () => {
    expect(parseTranscribeVoice(undefined)).toEqual({ language: null, modelId: null });
    expect(parseTranscribeVoice({ language: 'fr', model_id: 'whisper-small' })).toEqual({ language: 'fr', modelId: 'whisper-small' });
  });
});
