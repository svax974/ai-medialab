/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { tr } from 'src/modules/i18n';
import { HttpException, Injectable } from '@nestjs/common';
import { VoiceService, type VoiceDto } from 'src/modules/audio-studio';
import { newId } from 'src/modules/media-library';
import { ModelCatalogService, type ModelInfo } from 'src/modules/model-catalog';
import { SettingsService } from 'src/modules/settings';
import { GenerationService, MessageService } from 'src/modules/studio-core';
import {
  ChatError, type ChatGeneration, type CreationKind, type CreationModels, type StoredGeneration, type ToolRun,
} from '../types/chatTypes';
import { ChatStoreService } from './ChatStoreService';
import type { LlmToolCall } from './EngineLlmClient';
import { toChatGeneration } from '../mappers/chatMapper';
import type { ChatMessageEntity } from '../entities/ChatMessageEntity';

/** The three tools of the chat that start a generation in a studio: one per kind, offered when that studio has a ready model. */
export const CREATION_TOOL_NAMES = ['generate_image', 'generate_video', 'generate_audio'] as const;
export type CreationToolName = (typeof CREATION_TOOL_NAMES)[number];

export const isCreationTool = (name: string): name is CreationToolName => (CREATION_TOOL_NAMES as readonly string[]).includes(name);

const KIND_OF: Record<CreationToolName, CreationKind> = { generate_image: 'image', generate_video: 'video', generate_audio: 'audio' };
export const IMAGE_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;
const MAX_PROMPT_CHARS = 8000;
const MAX_ARG_CHARS = 2000;
const MAX_DESCRIPTION_CHARS = 300;

const KIND_WORD: Record<CreationKind, string> = { image: "l'image", video: 'la vidéo', audio: "l'audio" };
const LAUNCHED = 'Génération lancée : le résultat apparaîtra dans ce message dès que le modèle aura terminé.';

type Args = Record<string, unknown>;

const isRecord = (v: unknown): v is Args => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What a reply may do with the creation tools: their schemas, and how a call becomes a stored generation. */
export interface CreationRun {
  /** OpenAI function schemas of the tools this request offers (the models the studios have selected). */
  schemas: Record<string, unknown>[];
  /** Generations started or waiting so far, in call order (written to the reply message). */
  generations: StoredGeneration[];
  begin(call: LlmToolCall): ToolRun;
  run(call: LlmToolCall): Promise<{ run: ToolRun; content: string }>;
}

/** A parsed slash command (`/image …`, `/video [Ns] …`, `/audio [voix :] …`): what was typed, nothing resolved yet. */
export interface CreationCommand {
  kind: CreationKind;
  text: string;
  /** Video only: the `Ns` typed after the command. */
  seconds: number | null;
  /** Audio only: the text before the first colon, a voice name when it matches one. */
  voiceName: string | null;
}

/** Reads a message as a slash command; `null` when it is not one. */
export function parseCommand(content: string): CreationCommand | null {
  const found = /^\s*\/(image|video|audio)(?:\s+([\s\S]*))?$/i.exec(content);
  if (!found) return null;
  const kind = found[1].toLowerCase() as CreationKind;
  let text = (found[2] ?? '').trim();
  let seconds: number | null = null;
  let voiceName: string | null = null;
  if (kind === 'video') {
    const duration = /^(\d+(?:[.,]\d+)?)\s*s(?:\s+|$)/i.exec(text);
    if (duration) {
      seconds = Number(duration[1].replace(',', '.'));
      text = text.slice(duration[0].length).trim();
    }
  } else if (kind === 'audio') {
    const named = /^([^:：\n]{1,60}?)\s*[:：]\s*([\s\S]+)$/.exec(text);
    if (named) {
      voiceName = named[1].trim();
      text = named[2].trim();
    }
  }
  return { kind, text, seconds, voiceName };
}

const norm = (s: string): string => s.trim().toLowerCase();

interface AudioCapsView {
  task: string;
  voices: { id: string; name: string; language?: string }[];
  clone: 'none' | 'optional' | 'required';
  design: boolean;
  instruct: boolean;
  maxChars: number;
  languages: { code: string; label: string }[];
}

function audioCaps(info: ModelInfo): AudioCapsView {
  const a = (info.audio ?? {}) as Record<string, unknown>;
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    task: String(a.task ?? 'tts'),
    voices: list<{ id: string; name: string; language?: string }>(a.voices),
    clone: a.clone === 'required' || a.clone === 'optional' ? a.clone : 'none',
    design: a.design === true,
    instruct: a.instruct === true,
    maxChars: typeof a.max_chars === 'number' ? a.max_chars : 600,
    languages: list<{ code: string; label: string }>(a.languages),
  };
}

interface VideoBounds { min: number; max: number; def: number }

/** Duration bounds of a video model, from its capabilities (`VideoCaps`); the engine's defaults when it says nothing. */
export function videoBounds(info: ModelInfo): VideoBounds {
  const v = (info.video ?? {}) as Record<string, unknown>;
  const num = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
  const max = num(v.max_seconds, 5);
  const min = Math.min(num(v.min_seconds, 1), max);
  return { min, max, def: Math.min(max, Math.max(min, num(v.default_seconds, 5))) };
}

const fn = (name: CreationToolName, description: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required } },
});

const REWRITE_HINT = "Rédige le prompt en anglais, concret et visuel (sujet, décor, lumière, style), sans reprendre les mots de la demande s'ils n'aident pas le modèle.";

/**
 * The creation tools of the chat: `generate_image`, `generate_video`, `generate_audio`, built for every reply from the
 * models the studios have selected (a tool exists only when its studio has a ready model, and only offers what that model
 * accepts), and the slash commands that do the same without the language model.
 *
 * A call stores its generation in the queue of `studio-core` (as a prompt and an answer attached to the chat conversation,
 * so the files belong to it and the chat's deletion removes them) with the model's default parameters and returns at once:
 * the reply holds the engine until it ends and the queue starts the job afterwards. What cannot be decided (a video
 * without a duration, a model that needs a voice and none was named) becomes a `pending` entry: the message shows a card
 * and `confirm` starts the generation.
 */
@Injectable()
export class CreationToolsService {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly voices: VoiceService,
    private readonly settings: SettingsService,
    private readonly generations: GenerationService,
    private readonly studioMessages: MessageService,
    private readonly store: ChatStoreService,
  ) {}

  /** The tools to offer for these models; `null` when no studio has a ready model of the kind asked for. */
  async prepare(conversationId: string, models: CreationModels | undefined): Promise<CreationRun | null> {
    if (!models) return null;
    const infos = await this.readyModels(models);
    if (!infos.size) return null;
    const library = await this.voices.list();
    const schemas = [...infos].map(([kind, info]) => this.schema(kind, info, library));
    const generations: StoredGeneration[] = [];
    return {
      schemas, generations,
      begin: (call) => this.begin(call),
      run: async (call) => {
        const kind = KIND_OF[call.function.name as CreationToolName];
        const info = infos.get(kind);
        const run = this.begin(call);
        if (!info) return this.failed(run, tr('chat.creation.unavailable'));
        try {
          const outcome = await this.fromArguments(conversationId, kind, info, run.arguments, library);
          generations.push(outcome.generation);
          return { run: { ...run, status: 'done', result_preview: outcome.preview }, content: outcome.content };
        } catch (error) {
          return this.failed(run, errorText(error));
        }
      },
    };
  }

  /** `/image`, `/video` and `/audio` typed by the user: starts the generation without the language model. */
  async runCommand(conversationId: string, command: CreationCommand, models: CreationModels | undefined): Promise<StoredGeneration> {
    if (!command.text) throw new ChatError('invalid', tr('chat.creation.commandEmpty', [command.kind]));
    const info = (await this.readyModels(models ?? {})).get(command.kind);
    if (!info) throw new ChatError('no_model', noReadyModel(command.kind));
    const library = await this.voices.list();
    try {
      if (command.kind === 'image') return (await this.imageGeneration(conversationId, info, command.text, {})).generation;
      if (command.kind === 'video') return (await this.videoGeneration(conversationId, info, command.text, command.seconds)).generation;
      const named = command.voiceName && this.findVoice(command.voiceName, info, library) ? command.voiceName : null;
      const text = named ? command.text : [command.voiceName, command.text].filter(Boolean).join(' : ');
      return (await this.audioGeneration(conversationId, info, { text, ...(named ? { voice: named } : {}) }, library)).generation;
    } catch (error) {
      if (error instanceof ChatError) throw error;
      throw new ChatError('invalid', errorText(error));
    }
  }

  /** Starts a generation that waited for a duration or a voice (the card of the message). */
  async confirm(conversationId: string, messageId: string, generationId: string, choice: { seconds?: number; voiceId?: string }): Promise<ChatGeneration> {
    const message = await this.store.requireMessage(conversationId, messageId);
    const stored = (message.generations ?? []).find((g) => g.id === generationId);
    if (!stored?.pending) throw new ChatError('invalid', tr('chat.creation.noLongerWaiting'));
    const info = (await this.catalog.catalog()).models.find((m) => m.id === stored.model_id);
    if (!info?.ready) throw new ChatError('no_model', tr('chat.creation.modelNotReady'));
    const params = { ...stored.params };
    if (stored.pending === 'duration') {
      const { min, max } = videoBounds(info);
      const seconds = choice.seconds;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < min || seconds > max) throw new ChatError('invalid', tr('chat.creation.secondsRange', [min, max]));
      params.seconds = seconds;
    } else {
      if (!choice.voiceId) throw new ChatError('invalid', tr('chat.creation.voiceExpected'));
      params.voice = await this.voiceRef(choice.voiceId, info);
    }
    const started = await this.start(conversationId, stored.kind, info, stored.prompt, params);
    const { pending: _answered, ...rest } = stored;
    const updated: StoredGeneration = { ...rest, message_id: started, params };
    await this.store.updateMessage(messageId, { generations: (message.generations ?? []).map((g) => (g.id === generationId ? updated : g)) });
    const live = await this.studioMessages.get(started);
    return toChatGeneration(updated, conversationId, new Map(live ? [[live.id, live]] : []));
  }

  /** The generations of deleted chat messages go with them: stopped when they run, their files removed. Never fails the deletion. */
  async discard(removed: ChatMessageEntity[]): Promise<void> {
    for (const { message_id: id } of removed.flatMap((m) => m.generations ?? [])) {
      if (!id) continue;
      const run = await this.studioMessages.get(id);
      await this.generations.remove(run?.parent_id ?? id).catch(() => undefined);
    }
  }

  // Schemas ---------------------------------------------------------------------------------------------------------

  private async readyModels(models: CreationModels): Promise<Map<CreationKind, ModelInfo>> {
    const wanted = (['image', 'video', 'audio'] as const).filter((k) => models[k]);
    if (!wanted.length) return new Map();
    const all = (await this.catalog.catalog()).models;
    const out = new Map<CreationKind, ModelInfo>();
    for (const kind of wanted) {
      const info = all.find((m) => m.id === models[kind] && m.kind === kind && m.ready);
      if (info && !(kind === 'audio' && audioCaps(info).task === 'stt')) out.set(kind, info);
    }
    return out;
  }

  private schema(kind: CreationKind, info: ModelInfo, library: VoiceDto[]): Record<string, unknown> {
    if (kind === 'image') {
      return fn('generate_image', `Génère une image avec le modèle « ${info.name} » du studio d'image, puis l'affiche dans ce message. À utiliser quand l'utilisateur demande une image, un dessin, une illustration ou une photo. ${REWRITE_HINT}`, {
        prompt: { type: 'string', description: "Description de l'image à générer." },
        aspect: { type: 'string', enum: [...IMAGE_ASPECTS], description: 'Format (1:1 par défaut).' },
      }, ['prompt']);
    }
    if (kind === 'video') {
      const { min, max, def } = videoBounds(info);
      return fn('generate_video', `Génère une vidéo avec le modèle « ${info.name} » du studio vidéo, puis l'affiche dans ce message. ${REWRITE_HINT} La durée va de ${min} à ${max} s (${def} s par défaut) : ne la donne que si l'utilisateur l'a demandée, sinon omets \`seconds\` (il la choisira lui-même).`, {
        prompt: { type: 'string', description: 'Description de la scène et du mouvement.' },
        seconds: { type: 'number', minimum: min, maximum: max, description: `Durée en secondes (${min} à ${max}).` },
      }, ['prompt']);
    }
    return this.audioSchema(info, audioCaps(info), library);
  }

  private audioSchema(info: ModelInfo, caps: AudioCapsView, library: VoiceDto[]): Record<string, unknown> {
    if (caps.task !== 'tts') {
      return fn('generate_audio', `Génère un son avec le modèle « ${info.name} » du studio audio, puis le joue dans ce message.`, {
        description: { type: 'string', description: 'Description du son à produire.' },
        seconds: { type: 'number', minimum: 1, description: 'Durée en secondes.' },
      }, ['description']);
    }
    const properties: Record<string, unknown> = {
      text: { type: 'string', maxLength: caps.maxChars, description: `Texte à dire à voix haute, tel qu'il doit être lu (${caps.maxChars} caractères au plus).` },
    };
    const names = this.voiceNames(caps, library);
    if (names.length) {
      properties.voice = { type: 'string', description: `Nom de la voix, à omettre si l'utilisateur n'en a pas nommé. Voix disponibles : ${names.join(', ')}.` };
    }
    if (caps.design) properties.voice_description = { type: 'string', maxLength: MAX_DESCRIPTION_CHARS, description: 'Description de la voix à créer (âge, timbre, ton), si l’utilisateur en décrit une.' };
    if (caps.instruct) properties.style = { type: 'string', maxLength: MAX_DESCRIPTION_CHARS, description: 'Consigne de style ou de ton (« voix chaleureuse et calme »), si demandée.' };
    if (caps.languages.length > 1) properties.language = { type: 'string', enum: caps.languages.map((l) => l.code), description: 'Langue du texte (celle du texte par défaut).' };
    return fn('generate_audio', `Dit un texte à voix haute avec le modèle « ${info.name} » du studio audio, puis le joue dans ce message. À utiliser quand l'utilisateur demande de lire, dire ou prononcer un texte.`, properties, ['text']);
  }

  private voiceNames(caps: AudioCapsView, library: VoiceDto[]): string[] {
    const usable = caps.clone !== 'none' ? library.map((v) => v.name) : [];
    return [...new Set([...usable, ...caps.voices.map((v) => v.name)])];
  }

  // Calls -----------------------------------------------------------------------------------------------------------

  private begin(call: LlmToolCall): ToolRun {
    const name = isCreationTool(call.function.name) ? call.function.name : 'generate_image';
    return { id: call.id, name, arguments: safeArguments(call), status: 'running' };
  }

  private failed(run: ToolRun, message: string): { run: ToolRun; content: string } {
    return { run: { ...run, status: 'error', result_preview: message }, content: `Erreur : ${message}` };
  }

  private async fromArguments(conversationId: string, kind: CreationKind, info: ModelInfo, args: Args, library: VoiceDto[]): Promise<Outcome> {
    if (kind === 'audio') return this.audioGeneration(conversationId, info, args, library);
    const prompt = str(args.prompt);
    if (!prompt) throw new Error(tr('chat.creation.emptyPrompt'));
    if (kind === 'image') return this.imageGeneration(conversationId, info, prompt, args);
    return this.videoGeneration(conversationId, info, prompt, typeof args.seconds === 'number' ? args.seconds : null);
  }

  private async imageGeneration(conversationId: string, info: ModelInfo, prompt: string, args: Args): Promise<Outcome> {
    const aspect = str(args.aspect);
    const params: Args = IMAGE_ASPECTS.includes(aspect as (typeof IMAGE_ASPECTS)[number]) ? { aspect } : {};
    return this.started(conversationId, 'image', info, prompt, params);
  }

  private async videoGeneration(conversationId: string, info: ModelInfo, prompt: string, seconds: number | null): Promise<Outcome> {
    if (seconds === null) {
      return this.waiting('video', info, prompt, {}, 'duration', "La durée n'est pas précisée : une carte de choix est affichée à l'utilisateur, qui lancera la génération lui-même. Ne relance pas l'outil.");
    }
    const { min, max } = videoBounds(info);
    if (seconds < min || seconds > max) throw new Error(tr('chat.creation.durationRange', [min, max]));
    return this.started(conversationId, 'video', info, prompt, { seconds });
  }

  private async audioGeneration(conversationId: string, info: ModelInfo, args: Args, library: VoiceDto[]): Promise<Outcome> {
    const caps = audioCaps(info);
    const text = caps.task === 'tts' ? str(args.text) : str(args.description);
    if (!text) throw new Error(caps.task === 'tts' ? tr('chat.creation.emptyText') : tr('chat.creation.emptyDescription'));
    if (caps.task !== 'tts') return this.started(conversationId, 'audio', info, text, typeof args.seconds === 'number' ? { seconds: args.seconds } : {});
    if (text.length > caps.maxChars) throw new Error(tr('chat.creation.textTooLong', [text.length, caps.maxChars]));
    const params: Args = {};
    const language = str(args.language);
    if (language && caps.languages.some((l) => l.code === language)) params.language = language;
    const instruct = str(caps.design ? args.voice_description : '') || str(caps.instruct ? args.style : '');
    if (instruct) params.instruct = instruct;
    const named = str(args.voice);
    if (named) {
      const voice = this.findVoice(named, info, library);
      if (!voice) throw new Error(tr('chat.creation.unknownVoice', [named, this.voiceNames(caps, library).join(', ') || tr('chat.creation.noVoice')]));
      params.voice = voice;
      return this.started(conversationId, 'audio', info, text, params);
    }
    if (caps.clone === 'required' && !caps.voices.length) {
      const fallback = await this.defaultVoice(library);
      if (fallback) return this.started(conversationId, 'audio', info, text, { ...params, voice: { source: 'library', id: fallback.id } });
      return this.waiting('audio', info, text, params, 'voice', "Ce modèle exige une voix et aucune n'est précisée : une carte de choix est affichée à l'utilisateur, qui lancera la génération lui-même. Ne relance pas l'outil.");
    }
    return this.started(conversationId, 'audio', info, text, params);
  }

  private async defaultVoice(library: VoiceDto[]): Promise<VoiceDto | undefined> {
    const id = (await this.settings.getPublic()).chat_voice_id;
    return id ? library.find((v) => v.id === id) : undefined;
  }

  /** A voice by name (library first, then the model's built-in voices, by name or id); `null` when unknown. */
  private findVoice(name: string, info: ModelInfo, library: VoiceDto[]): { source: 'library' | 'preset'; id: string } | null {
    const caps = audioCaps(info);
    const wanted = norm(name);
    const lib = caps.clone !== 'none' ? library.find((v) => norm(v.name) === wanted) : undefined;
    if (lib) return { source: 'library', id: lib.id };
    const preset = caps.voices.find((v) => norm(v.name) === wanted || norm(v.id) === wanted);
    return preset ? { source: 'preset', id: preset.id } : null;
  }

  private async voiceRef(id: string, info: ModelInfo): Promise<{ source: 'library' | 'preset'; id: string }> {
    const caps = audioCaps(info);
    if (caps.voices.some((v) => v.id === id)) return { source: 'preset', id };
    if (!(await this.voices.get(id))) throw new ChatError('invalid', tr('chat.creation.voiceGone'));
    return { source: 'library', id };
  }

  // Generations -----------------------------------------------------------------------------------------------------

  private async started(conversationId: string, kind: CreationKind, info: ModelInfo, prompt: string, params: Args): Promise<Outcome> {
    const messageId = await this.start(conversationId, kind, info, prompt, params);
    const generation: StoredGeneration = { id: newId(), kind, model_id: info.id, message_id: messageId, prompt, params };
    return { generation, preview: tr('chat.creation.launched', [info.name]), content: `${LAUNCHED} Réponds par une courte phrase qui annonce ${KIND_WORD[kind]} en cours de création ; tu ne la vois pas, ne la décris pas.` };
  }

  private waiting(kind: CreationKind, info: ModelInfo, prompt: string, params: Args, pending: 'duration' | 'voice', content: string): Outcome {
    const generation: StoredGeneration = { id: newId(), kind, model_id: info.id, message_id: null, prompt, params, pending };
    return { generation, preview: pending === 'duration' ? tr('chat.creation.chooseDuration') : tr('chat.creation.chooseVoice'), content };
  }

  /** Queues the generation in `studio-core` and returns the id of its message. The queue starts it once the chat gives the engine back. */
  private async start(conversationId: string, kind: CreationKind, info: ModelInfo, prompt: string, params: Args): Promise<string> {
    const created = await this.generations.create({ conversationId, prompt, modelId: info.id, params, referenceIds: [], count: 1 });
    return created.assistant_message.id;
  }
}

interface Outcome {
  generation: StoredGeneration;
  preview: string;
  content: string;
}

const noReadyModel = (kind: CreationKind): string => ({ image: tr('chat.creation.noReadyModel.image'), video: tr('chat.creation.noReadyModel.video'), audio: tr('chat.creation.noReadyModel.audio') })[kind];

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_PROMPT_CHARS) : '';
}

function errorText(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    return typeof body === 'string' ? body : isRecord(body) && typeof body.message === 'string' ? body.message : error.message;
  }
  return error instanceof Error ? error.message : tr('chat.web.failed');
}

/** The arguments the model sent, bounded: what the message shows of the call. */
function safeArguments(call: LlmToolCall): Args {
  let parsed: unknown;
  try {
    parsed = JSON.parse(call.function.arguments || '{}');
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const out: Args = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') out[key] = value.slice(0, MAX_ARG_CHARS);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}
