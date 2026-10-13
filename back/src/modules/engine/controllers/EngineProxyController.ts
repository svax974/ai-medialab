/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { All, Controller, Req, Res, UseInterceptors } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { EngineProxyService, MEDIA_SEGMENT, PROXIED_SEGMENTS, toEnginePath } from '../services/EngineProxyService';

const ROUTES = [...PROXIED_SEGMENTS, MEDIA_SEGMENT].flatMap((s) => [`api/${s}`, `api/${s}/*rest`]);

/**
 * TRANSITIONAL (removed in H6): relays `/api/<segment>[/...]` to the engine (`/engine/v1/...`, or `/media/...`).
 * Only the segments of `PROXIED_SEGMENTS` are matched, so `/api/v1/*` (Nest) and Swagger (`/api`) are untouched.
 * Admin only (the `local-trust` principal included): the engine is an internal service.
 */
@ApiExcludeController()
@Controller()
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class EngineProxyController {
  constructor(private readonly proxy: EngineProxyService) {}

  @All(ROUTES)
  relay(@Req() req: Request, @Res() res: Response): void {
    const target = toEnginePath(req.originalUrl);
    if (!target) {
      res.status(404).json({ statusCode: 404, message: 'Not Found' });
      return;
    }
    this.proxy.forward(req, res, target);
  }
}
