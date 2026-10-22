/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ChatError, ChatModelService, EngineLlmClient } from 'src/modules/chat';
import { AssetDto, AssetFileService, newId, nowSeconds, type UploadedFile } from 'src/modules/media-library';
import { ConversationService, EngineBusyGate, GenerationQueueService, MessageService, titleFromPrompt } from 'src/modules/studio-core';
import { GRAPH_SCHEMA, GRAPH_SYSTEM, SEQUENCE_SCHEMA, SEQUENCE_SYSTEM } from '../lib/schemas';
import { toMermaid } from '../lib/toMermaid';
import type { GenerateDiagramInput, GenerateDiagramResult, GraphData, SequenceData } from '../types/diagramTypes';

const GATE_OWNER = 'diagram';
const TIMEOUT_MS = 180_000;
const MAX_TOKENS = 4000;

const refusal = (error: ChatError): ConflictException => new ConflictException({ statusCode: 409, message: error.message, code: error.code });

/** Strips a leading/trailing code fence (````json ... ````) a model sometimes wraps its answer in despite the
 * schema; the content itself is already schema-valid JSON once that is removed. */
function stripFence(raw: string): string {
  return raw.replace(/^```[a-z]*\n?|```$/gim, '').trim();
}

/**
 * Generates a diagram: a one-shot, schema-constrained completion (`response_format: json_schema`, same mechanism as
 * `update_advisor.py`'s `EXTRACT_SCHEMA`) converted to Mermaid source (`toMermaid`), stored as a prompt + assistant
 * message pair like any other generation — but synchronous (no job queue: this is a text completion, not a media
 * job, exactly like the chat's own one-shot calls, see `PromptEnhanceService`). The rendered image is attached
 * afterwards by `attachRender` once the front has turned the Mermaid source into a PNG.
 */
@Injectable()
export class DiagramsService {
  constructor(
    private readonly llm: EngineLlmClient,
    private readonly models: ChatModelService,
    private readonly conversations: ConversationService,
    private readonly messages: MessageService,
    private readonly files: AssetFileService,
    private readonly queue: GenerationQueueService,
    private readonly gate: EngineBusyGate,
  ) {}

  async generate(input: GenerateDiagramInput): Promise<GenerateDiagramResult> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new UnprocessableEntityException(tr('diagrams.error.emptyPrompt'));
    if (input.conversationId && !(await this.conversations.getSummary(input.conversationId))) {
      throw new NotFoundException(tr('diagrams.error.conversationNotFound'));
    }
    if (this.queue.occupied) throw refusal(new ChatError('busy', tr('diagrams.error.busyGeneration')));
    await this.gate.preempt();
    if (!this.gate.tryAcquire(GATE_OWNER)) throw refusal(new ChatError('busy', tr('diagrams.error.busyModel')));
    try {
      const model = await this.models.resolve(input.modelId, 'diagram');
      const system = input.diagramType === 'sequence' ? SEQUENCE_SYSTEM : GRAPH_SYSTEM;
      const schema = input.diagramType === 'sequence' ? SEQUENCE_SCHEMA : GRAPH_SCHEMA;
      const { content } = await this.llm.complete(
        {
          model_id: model.id,
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
          params: { temperature: 0.4, max_tokens: MAX_TOKENS },
          reasoning: 'off',
          response_format: { type: 'json_schema', schema },
        },
        AbortSignal.timeout(TIMEOUT_MS),
      );
      const data = this.parse(content);
      const mermaidSource = toMermaid(input.diagramType, data);

      const conversationId = await this.conversationFor(input.conversationId, prompt);
      const now = nowSeconds();
      const user = await this.messages.create({ id: newId(), conversationId, role: 'user', prompt, createdAt: now });
      const assistant = await this.messages.create({
        id: newId(), conversationId, parentId: user.id, role: 'assistant', prompt, modelId: model.id,
        params: { diagramType: input.diagramType, mermaidSource }, status: 'done', createdAt: now + 0.001,
      });
      await this.conversations.touch(conversationId);
      return {
        conversation_id: conversationId, user_message: user, assistant_message: assistant,
        mermaid_source: mermaidSource, diagram_type: input.diagramType,
      };
    } catch (error) {
      if (error instanceof ChatError) throw refusal(error);
      throw error;
    } finally {
      this.gate.release(GATE_OWNER);
    }
  }

  /** Attaches the PNG the front rendered from `mermaid_source` to the assistant message, as a normal generated image
   * asset (gallery, thumbnail, download — like any other generation). The SVG is not stored: it is cheap to redraw
   * client-side from the stored `mermaid_source`/theme whenever the user wants to export it. */
  async attachRender(messageId: string, file: UploadedFile, diagramType: string): Promise<AssetDto> {
    const message = await this.messages.get(messageId);
    if (!message || message.role !== 'assistant') throw new NotFoundException(tr('diagrams.error.notFound'));
    return this.files.ingest(file, {
      kind: 'generated',
      messageId,
      conversationId: message.conversation_id,
      meta: { diagram_type: diagramType, mermaid_source: message.params.mermaidSource },
    });
  }

  private parse(raw: string): GraphData | SequenceData {
    try {
      return JSON.parse(stripFence(raw)) as GraphData | SequenceData;
    } catch {
      throw new ChatError('upstream', tr('diagrams.error.badJson'));
    }
  }

  private async conversationFor(conversationId: string | undefined, prompt: string): Promise<string> {
    if (conversationId) return conversationId;
    return (await this.conversations.create({ title: titleFromPrompt(prompt), mode: 'diagram' })).id;
  }
}
