/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { uiLanguageMiddleware } from './UiLanguageMiddleware';

/** Records the language of the interface from each request, for `tr()` (see README). */
@Module({})
export class I18nModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(uiLanguageMiddleware).forRoutes('*path');
  }
}
