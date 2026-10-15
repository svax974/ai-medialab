/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import 'reflect-metadata';
import { installFileLogging } from './fileLogger';
import { AppModule } from './modules/app/AppModule';
import { startApp } from 'src/modules_shared/common/bootstrap';

// Common startup steps: modules_shared/common/bootstrap/startApp.ts. Only what is specific to AI MediaLab is here.
startApp({
  appModule: AppModule,
  swagger: { title: 'AI MediaLab API', tag: 'ai-medialab' },
  // Timestamp every console line and tee it to <LOG_DIR>/back-<day>.log (LOG_TO_FILE=false disables the file).
  beforeCreate: installFileLogging,
});
