/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { assetFilePath, outputsDir } from 'src/modules/media-library';
import { MessageEntity } from '../entities/MessageEntity';
import type { EngineJobSubmit, JobKind } from '../types/jobTypes';
import { MessageService } from './MessageService';

/**
 * The engine's view of a generation message: model, prompt, parameters, the absolute paths of the prompt's reference
 * files (in order) and the folder to write to. The engine knows nothing of conversations or messages: the message id
 * is the job id.
 */
@Injectable()
export class JobRequestBuilder {
  constructor(private readonly messages: MessageService) {}

  async build(message: MessageEntity, kind: JobKind): Promise<EngineJobSubmit> {
    const references = message.parentId ? await this.messages.referencesOf(message.parentId) : [];
    return {
      job_id: message.id,
      kind,
      model_id: message.modelId ?? '',
      prompt: message.prompt,
      params: message.params ?? {},
      inputs: references.map((asset) => assetFilePath(asset.kind, asset.filename)),
      output_dir: outputsDir(),
    };
  }
}
