/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { Injectable } from '@nestjs/common';
import { ModelCatalogService, type LlmCapabilities, type ModelCatalog } from 'src/modules/model-catalog';
import { ChatError } from '../types/chatTypes';

export interface ResolvedModel {
  id: string;
  name: string;
  caps: LlmCapabilities;
}

const NONE: LlmCapabilities = { context_default: 16384, context_max: 32768, vision: false, tools: false, reasoning: 'none', moe: false, params_b: null, active_params_b: null };

/**
 * Which chat model answers: the one asked for, else the conversation's, else the engine's default; it must be a
 * language model, downloaded, with its runtime (llama.cpp) installed. Each refusal is a `ChatError` with a text that
 * tells the user what to do.
 */
@Injectable()
export class ChatModelService {
  constructor(private readonly catalog: ModelCatalogService) {}

  async resolve(requested: string | null | undefined): Promise<ResolvedModel> {
    let catalog: ModelCatalog;
    try {
      catalog = await this.catalog.catalog();
    } catch (error) {
      throw new ChatError('upstream', error instanceof Error ? `Le moteur ne répond pas : ${error.message}` : 'Le moteur ne répond pas.');
    }
    const id = requested || catalog.llm?.default_model_id;
    if (!id) throw new ChatError('no_model', "Aucun modèle de chat n'est installé : ouvrez « Modèles » pour en télécharger un.");
    const model = catalog.models.find((m) => m.id === id && m.kind === 'llm');
    if (!model) throw new ChatError('no_model', 'Modèle de chat inconnu : choisissez-en un autre.');
    if (model.engine_available === false) throw new ChatError('no_engine', "Le moteur de chat (llama.cpp) n'est pas installé : ouvrez « Modèles » pour l'installer.");
    if (!model.ready) throw new ChatError('no_model', `« ${model.name} » n'est pas (entièrement) téléchargé : ouvrez « Modèles » pour le télécharger.`);
    return { id: model.id, name: model.name, caps: { ...NONE, ...(model.llm ?? {}) } };
  }
}
