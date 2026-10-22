/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { Injectable } from '@nestjs/common';
import { ModelCatalogService, type LlmCapabilities, type ModelCatalog, type ModelKind } from 'src/modules/model-catalog';
import { ChatError } from '../types/chatTypes';

export interface ResolvedModel {
  id: string;
  name: string;
  caps: LlmCapabilities;
}

const NONE: LlmCapabilities = { context_default: 16384, context_max: 32768, vision: false, tools: false, reasoning: 'none', moe: false, params_b: null, active_params_b: null };

/**
 * Which language model answers: the one asked for, else the kind's default, else the engine's. `kind` is `'llm'`
 * for the chat (the default) or `'diagram'` for the Diagrams tab — both are llama.cpp/GGUF models, resolved the
 * same way, just offered under a different catalog entry (see `engine/app/engines/diagram_models.py`). It must be
 * downloaded, with its runtime (llama.cpp) installed. Each refusal is a `ChatError` with a text that tells the user
 * what to do.
 */
@Injectable()
export class ChatModelService {
  constructor(private readonly catalog: ModelCatalogService) {}

  async resolve(requested: string | null | undefined, kind: ModelKind = 'llm'): Promise<ResolvedModel> {
    let catalog: ModelCatalog;
    try {
      catalog = await this.catalog.catalog();
    } catch (error) {
      throw new ChatError('upstream', error instanceof Error ? tr('chat.error.engineDownDetail', [error.message]) : tr('chat.error.engineDown'));
    }
    const id = requested || (kind === 'diagram' ? catalog.diagram : catalog.llm)?.default_model_id;
    const diagram = kind === 'diagram';
    if (!id) throw new ChatError('no_model', diagram ? tr('chat.error.noModel.diagram') : tr('chat.error.noModel.chat'));
    const model = catalog.models.find((m) => m.id === id && m.kind === kind);
    if (!model) throw new ChatError('no_model', diagram ? tr('chat.error.unknownModel.diagram') : tr('chat.error.unknownModel.chat'));
    if (model.engine_available === false) throw new ChatError('no_engine', tr('chat.error.noEngine'));
    if (!model.ready) throw new ChatError('no_model', tr('chat.error.modelNotDownloaded', [model.name]));
    return { id: model.id, name: model.name, caps: { ...NONE, ...(model.llm ?? {}) } };
  }
}
