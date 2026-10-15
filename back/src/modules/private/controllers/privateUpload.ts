/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { ConflictException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { diskStorage } from 'multer';
import { join } from 'path';
import { activeSessionId, sessionPath } from '../services/privateFiles';

/** Raw uploads of a private session go to `<session>/tmp/tmp_<random>` (the engine consumes them), never to `uploads/`. */
export const privateUploadStorage = diskStorage({
  destination: (_req, _file, done) => {
    const id = activeSessionId();
    if (!id) return done(new ConflictException("Aucune session privée n'est ouverte."), '');
    done(null, join(sessionPath(id), 'tmp'));
  },
  filename: (_req, _file, done) => done(null, `tmp_${randomBytes(8).toString('hex')}`),
});
