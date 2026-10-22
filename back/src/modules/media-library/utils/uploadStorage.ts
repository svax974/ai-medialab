/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { uploadsDir } from './dataDir';

/** Raw uploads are written to `<data>/uploads/tmp_<random>`, without a copy in memory (a video can weigh 500 MB). */
export const uploadStorage = diskStorage({
  destination: (_req, _file, done) => {
    try {
      const dir = uploadsDir();
      mkdirSync(dir, { recursive: true });
      done(null, dir);
    } catch (error) {
      done(error as Error, '');
    }
  },
  filename: (_req, _file, done) => done(null, `tmp_${randomBytes(8).toString('hex')}`),
});

/** The browser sends names as UTF-8 but multer reads them as latin1. */
export const decodeUploadName = (name: string): string => Buffer.from(name, 'latin1').toString('utf8');
