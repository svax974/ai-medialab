/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { BadRequestException, Body, Controller, Param, Post, UnprocessableEntityException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import { decodeUploadName, uploadStorage, type AssetDto } from 'src/modules/media-library';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { AdminOnlyInterceptor } from 'src/modules_shared/common/interceptors/AdminOnlyInterceptor';
import { DiagramsService } from '../services/DiagramsService';
import { DIAGRAM_TYPES, type DiagramType, type GenerateDiagramResult } from '../types/diagramTypes';

/** The size of a rendered diagram PNG stays small (vector source, no photo content): well under an upload of a photo. */
const MAX_RENDER_BYTES = 10 * 1024 * 1024;

function asDiagramType(value: unknown): DiagramType {
  if (typeof value === 'string' && (DIAGRAM_TYPES as readonly string[]).includes(value)) return value as DiagramType;
  throw new BadRequestException(`"diagramType" must be one of: ${DIAGRAM_TYPES.join(', ')}`);
}

function asText(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new BadRequestException(`"${name}" must be a string`);
  return value;
}

/** `/api/diagrams/*`: the Diagrams tab (organization charts, flowcharts, schemas). Admin only. See README.md. */
@ApiExcludeController()
@Controller('api/diagrams')
@NoTransportCrypt()
@UseInterceptors(AdminOnlyInterceptor)
export class DiagramsController {
  constructor(private readonly diagrams: DiagramsService) {}

  @Post('generate')
  generate(@Body() body: { conversation_id?: unknown; prompt?: unknown; model_id?: unknown; diagram_type?: unknown }): Promise<GenerateDiagramResult> {
    return this.diagrams.generate({
      conversationId: body.conversation_id === undefined ? undefined : asText(body.conversation_id, 'conversation_id'),
      prompt: asText(body.prompt, 'prompt'),
      modelId: body.model_id === undefined ? undefined : asText(body.model_id, 'model_id'),
      diagramType: asDiagramType(body.diagram_type),
    });
  }

  @Post('messages/:id/render')
  @UseInterceptors(FileInterceptor('file', { storage: uploadStorage, limits: { fileSize: MAX_RENDER_BYTES, files: 1 } }))
  render(
    @Param('id') id: string,
    @Body() body: { diagram_type?: unknown },
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<AssetDto> {
    if (!file) throw new UnprocessableEntityException(tr('diagrams.error.noFile'));
    return this.diagrams.attachRender(
      id,
      { path: file.path, originalName: decodeUploadName(file.originalname), mimeType: file.mimetype },
      asDiagramType(body.diagram_type),
    );
  }
}
