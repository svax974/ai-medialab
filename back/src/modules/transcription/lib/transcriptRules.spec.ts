/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import { describe, expect, it } from '@jest/globals';
import { optionalField, sourceExtension, transcriptFileName, transcriptLanguage, youtubeUrl } from './transcriptRules';

describe('transcript source boundary', () => {
  it('normalizes watch, short and Shorts URLs, stripping playlist and other parameters', () => {
    for (const url of ['https://youtu.be/abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk&list=x', 'https://www.youtube.com/shorts/abcdefghijk']) {
      expect(youtubeUrl(url)).toBe('https://www.youtube.com/watch?v=abcdefghijk');
    }
  });
  it('refuses arbitrary hosts, credentials, paths, ports and playlists', () => {
    for (const url of ['file:///etc/passwd', 'https://localhost/x', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://x@youtube.com/watch?v=abcdefghijk', 'https://youtube.com:444/watch?v=abcdefghijk', 'https://youtube.com/playlist?list=x']) expect(() => youtubeUrl(url)).toThrow();
  });
  it('recognizes audio/video extensions without trusting an executable extension', () => {
    expect(sourceExtension('Video.MP4')).toBe('.mp4');
    expect(sourceExtension('audio.wav')).toBe('.wav');
    expect(() => sourceExtension('video.mp4.exe')).toThrow();
  });
  it('validates fields and language and produces safe download names', () => {
    expect(optionalField('  ')).toBeUndefined();
    expect(() => optionalField({})).toThrow();
    expect(transcriptLanguage('auto')).toBeNull();
    expect(transcriptLanguage('fr')).toBe('fr');
    expect(() => transcriptLanguage('../fr')).toThrow();
    expect(transcriptFileName('film.mp4')).toBe('film.txt');
    expect(transcriptFileName('../x\r\n".mp4')).not.toMatch(/[\/\r\n"]/);
  });
});
