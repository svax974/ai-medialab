/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Controller, Get, Head, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { EngineMediaService, toEngineMediaPath } from '../services/EngineMediaService';

const MEDIA_ROUTES = ['api/media/*rest'];

/**
 * Serves the engine's media files (`/api/media/<folder>/<file>`) to the browser: the engine is internal, only Nest
 * is reachable. Admin only (the `local-trust` principal included). `/api/v1/*` and Swagger (`/api`) are untouched.
 */
@ApiExcludeController()
@Controller()
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class EngineMediaController {
  constructor(private readonly media: EngineMediaService) {}

  @Get(MEDIA_ROUTES)
  @Head(MEDIA_ROUTES)
  relay(@Req() req: Request, @Res() res: Response): void {
    const target = toEngineMediaPath(req.originalUrl);
    if (!target) {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }
    this.media.forward(req, res, target);
  }
}
