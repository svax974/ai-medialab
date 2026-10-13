/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import 'src/testing/sqliteEnv';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DataSource } from 'typeorm';
import { buildServices } from 'src/testing/services';
import { createTestDataSource } from 'src/testing/testDataSource';

describe('VoiceService', () => {
  let dataSource: DataSource;
  let s: ReturnType<typeof buildServices>;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    s = buildServices(dataSource);
  });
  afterEach(() => dataSource.destroy());

  it('creates a cloning voice with the public shape of the legacy API', async () => {
    const voice = await s.voices.create({
      name: ' Ma voix ', kind: 'clone', filename: 'voice_1.wav', transcript: ' Bonjour ', language: 'fr', duration: 4.5, peaks: [0, 1],
    });
    expect(voice).toMatchObject({
      name: 'Ma voix', kind: 'clone', transcript: 'Bonjour', description: '', language: 'fr', duration: 4.5,
      peaks: [0, 1], url: '/media/uploads/voice_1.wav',
    });
    expect(Object.keys(voice).sort()).toEqual(
      ['created_at', 'description', 'duration', 'id', 'kind', 'language', 'name', 'peaks', 'transcript', 'url'],
    );
  });

  it('a designed voice has no sample', async () => {
    const voice = await s.voices.create({ name: '', kind: 'design', description: 'douce' });
    expect(voice).toMatchObject({ name: 'Voix sans nom', url: null, language: null, duration: null, peaks: [] });
  });

  it('lists newest first, edits name / transcript / description / language, deletes', async () => {
    const a = await s.voices.create({ name: 'a', kind: 'clone' });
    await new Promise((r) => setTimeout(r, 5));
    const b = await s.voices.create({ name: 'b', kind: 'clone' });
    expect((await s.voices.list()).map((v) => v.id)).toEqual([b.id, a.id]);
    const edited = await s.voices.update(a.id, { name: 'z'.repeat(100), transcript: 'texte corrigé', language: 'en' });
    expect(edited).toMatchObject({ transcript: 'texte corrigé', language: 'en' });
    expect(edited?.name).toHaveLength(80);
    expect(await s.voices.update('zz', { name: 'x' })).toBeNull();
    expect(await s.voices.remove(a.id)).toMatchObject({ id: a.id });
    expect(await s.voices.remove(a.id)).toBeNull();
    expect(await s.voices.get(a.id)).toBeNull();
  });
});
