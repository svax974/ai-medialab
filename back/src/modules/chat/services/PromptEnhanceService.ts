/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { ConflictException, Injectable } from '@nestjs/common';
import { EngineClient } from 'src/modules/engine';
import { EngineBusyGate, GenerationQueueService } from 'src/modules/studio-core';
import { ChatModelService } from './ChatModelService';
import { EngineLlmClient } from './EngineLlmClient';
import type { PromptKind } from './chatValidation';
import { ChatError } from '../types/chatTypes';

const GATE_OWNER = 'chat';
const TIMEOUT_MS = 180_000;

/** What the model is asked to do for each studio: the prompt of an image or a video, the text of a speech. */
export const ENHANCE_INSTRUCTIONS: Record<PromptKind, string> = {
  image: "Tu améliores des prompts pour un modèle de génération d'image. Réécris le prompt de l'utilisateur en un seul paragraphe précis et visuel, en anglais : sujet, action, décor, style, lumière, couleurs, composition, matière. Garde strictement l'intention et tous les éléments demandés, n'invente aucun sujet nouveau, n'ajoute ni texte à afficher ni signature. Réponds uniquement par le prompt, sans guillemets ni explication.",
  video: "Tu améliores des prompts pour un modèle de génération de vidéo. Réécris le prompt de l'utilisateur en un seul paragraphe précis, en anglais : sujet, mouvement et action dans le temps, mouvement de caméra, décor, lumière, ambiance, style. Garde strictement l'intention et tous les éléments demandés, n'invente aucun sujet nouveau. Réponds uniquement par le prompt, sans guillemets ni explication.",
  audio: "Tu améliores le texte qu'un modèle de synthèse vocale va lire. Corrige l'orthographe, la ponctuation et les tournures pour une lecture naturelle à voix haute (phrases courtes, nombres et sigles écrits comme ils se prononcent), sans changer le sens, la langue ni la longueur de façon notable. Réponds uniquement par le texte corrigé, sans guillemets ni explication.",
};

/** The first line of the answer, without wrapping quotes, a leading label or code fences. */
export function cleanPrompt(raw: string): string {
  const text = raw.replace(/^```[a-z]*\n?|```$/gim, '').trim();
  return text.replace(/^(prompt(\s+amélioré)?|improved prompt)\s*:\s*/i, '').replace(/^["«“'`]+|["»”'`]+$/g, '').trim();
}

const refusal = (error: ChatError): ConflictException => new ConflictException({ statusCode: 409, message: error.message, code: error.code });

/**
 * The ✨ button of the composers: asks the language model to improve a generation prompt. It uses the model that is
 * loaded when there is one (no reload), else the engine's default, and refuses cleanly when a generation or a reply
 * holds the engine (409 with a `code`: `busy`, `no_model`, `no_engine`).
 */
@Injectable()
export class PromptEnhanceService {
  constructor(
    private readonly llm: EngineLlmClient,
    private readonly models: ChatModelService,
    private readonly engine: EngineClient,
    private readonly queue: GenerationQueueService,
    private readonly gate: EngineBusyGate,
  ) {}

  async enhance(kind: PromptKind, prompt: string, requested: string | undefined): Promise<{ prompt: string; model_id: string }> {
    if (this.queue.occupied) throw refusal(new ChatError('busy', "Une génération est en cours ou en attente : attendez sa fin avant d'améliorer le prompt."));
    await this.gate.preempt(); // a chat title being written gives the engine up
    if (!this.gate.tryAcquire(GATE_OWNER)) throw refusal(new ChatError('busy', 'Une réponse du chat est en cours : attendez sa fin.'));
    try {
      const model = await this.models.resolve(requested ?? (await this.loadedModel()));
      const { content } = await this.llm.complete({
        model_id: model.id,
        messages: [{ role: 'system', content: ENHANCE_INSTRUCTIONS[kind] }, { role: 'user', content: prompt }],
        params: { temperature: 0.7, max_tokens: 500 },
        reasoning: 'off',
      }, AbortSignal.timeout(TIMEOUT_MS));
      const improved = cleanPrompt(content);
      if (!improved) throw new ChatError('upstream', "Le modèle n'a rien renvoyé : réessayez.");
      return { prompt: improved, model_id: model.id };
    } catch (error) {
      throw error instanceof ChatError ? refusal(error) : error;
    } finally {
      this.gate.release(GATE_OWNER);
    }
  }

  /** The chat model already in memory, if any (best effort: an unreachable engine just means "none"). */
  private async loadedModel(): Promise<string | undefined> {
    try {
      const status = await this.engine.get('/engine/v1/llm/status');
      return status.state === 'ready' || status.state === 'generating' ? (status.model_id ?? undefined) : undefined;
    } catch {
      return undefined;
    }
  }
}
