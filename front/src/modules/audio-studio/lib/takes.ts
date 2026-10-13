/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { AudioCaps } from '@/modules/model-catalog'
import type { Asset, GenParams, JobProgress, Message } from '@/modules/studio-core'
import { isActive } from '@/modules/studio-core/lib/messageState'
import type { VoiceFromAssetBody, VoiceRef } from '@/modules/voices'

/** A take a character speaks from: where it starts (seconds) and who speaks. */
export interface TakeMarker {
  start: number
  label: string
  segment?: number
}

/** What the audio worker records about a take (`Asset.meta`). All of it optional: an older take may miss some. */
export interface TakeMeta {
  peaks: number[]
  markers: TakeMarker[]
  voice: string | null
  prompt: string
  instruct: string
  language: string
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** The metadata of a take, typed and defaulted (peaks, the speaker markers that have a name, voice, text, style, language). */
export function takeMeta(asset: Pick<Asset, 'meta'>): TakeMeta {
  const meta = asset.meta ?? {}
  const peaks = Array.isArray(meta['peaks']) ? (meta['peaks'] as number[]) : []
  const markers = (Array.isArray(meta['markers']) ? (meta['markers'] as { start?: unknown; label?: unknown; segment?: unknown }[]) : [])
    .filter((marker) => typeof marker.label === 'string' && marker.label !== '' && typeof marker.start === 'number')
    .map((marker) => ({ start: marker.start as number, label: marker.label as string, ...(typeof marker.segment === 'number' ? { segment: marker.segment } : {}) }))
  return { peaks, markers, voice: text(meta['voice']) || null, prompt: text(meta['prompt']), instruct: text(meta['instruct']), language: text(meta['language']) }
}

/** One cell of a generation: a produced take, or one still to come (the one being computed shows its progress). */
export type TakeSlot = { kind: 'take'; asset: Asset } | { kind: 'pending'; running: boolean }

/** Cells of a generation: one per requested take; produced takes first, the missing ones only while the generation goes on. */
export function takeSlots(message: Pick<Message, 'status' | 'outputs' | 'params'>, progressIndex: number | undefined): TakeSlot[] {
  const count = message.params.count ?? 1
  const active = isActive(message.status)
  const slots: TakeSlot[] = []
  for (let i = 0; i < count; i += 1) {
    const asset = message.outputs[i]
    if (asset) slots.push({ kind: 'take', asset })
    else if (active) slots.push({ kind: 'pending', running: message.status === 'running' && i === (progressIndex ?? 0) })
  }
  return slots
}

/** Share of the current take done (0..1). */
export function takeFraction(progress: Pick<JobProgress, 'step' | 'total'> | undefined, running: boolean): number {
  return running && progress?.total ? Math.min(1, Math.max(0, (progress.step ?? 0) / progress.total)) : 0
}

/** A take produced less than 8 s ago is revealed with the "develop" animation. */
export const isFreshTake = (asset: Pick<Asset, 'created_at'>, nowSeconds: number): boolean => nowSeconds - asset.created_at < 8

/** The line of a take under its player: "take N" when there are several, the voice, the seed. */
export type TakeLabelPart = { kind: 'take'; number: number } | { kind: 'voice'; name: string } | { kind: 'seed'; seed: number }
export function takeLabel(asset: Pick<Asset, 'seed' | 'meta'>, index: number, total: number): TakeLabelPart[] {
  const voice = takeMeta(asset).voice
  return [
    ...(total > 1 ? [{ kind: 'take', number: index + 1 } as const] : []),
    ...(voice ? [{ kind: 'voice', name: voice } as const] : []),
    ...(asset.seed != null ? [{ kind: 'seed', seed: asset.seed } as const] : []),
  ]
}

/** Colors of the characters of a dialogue, in order of first appearance (the first uses the accent). */
export const SPEAKER_COLORS = ['var(--safe)', '#7fb8e8', '#9bd18a', '#e2b25c', '#c79be0', '#e88a9e'] as const
export function speakerColors(names: readonly string[]): Record<string, string> {
  const colors: Record<string, string> = {}
  for (const name of new Set(names)) colors[name] = SPEAKER_COLORS[Object.keys(colors).length % SPEAKER_COLORS.length]
  return colors
}

/** Where a marker sits on the timeline, as a percentage of the duration. */
export const markerPosition = (start: number, duration: number): number => (duration > 0 ? Math.min(100, Math.max(0, (start / duration) * 100)) : 0)

/** Download name: slug of the text (or "audio"), seed or id, `.wav`. */
export function audioDownloadName(asset: Pick<Asset, 'meta' | 'seed' | 'id'>): string {
  const slug = (takeMeta(asset).prompt || 'audio')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-|-$/g, '')
  return `${slug || 'audio'}-${asset.seed ?? asset.id}.wav`
}

/**
 * Whether the first take of a message should start playing by itself: autoplay is on, the take exists, it was not already
 * started in this tab, it was produced a moment ago (not when an old conversation is opened) and nothing is playing.
 */
export function shouldAutoplay(input: { enabled: boolean; first: Pick<Asset, 'id' | 'created_at'> | undefined; alreadyPlayed: ReadonlySet<string>; nowSeconds: number; playing: boolean }): boolean {
  const { enabled, first, alreadyPlayed, nowSeconds, playing } = input
  return enabled && !!first && !alreadyPlayed.has(first.id) && isFreshTake(first, nowSeconds) && !playing
}

/**
 * Body to keep a take as a library voice. A take of a described voice becomes a designed voice, a take of a cloned one a
 * clone; the name says it is a copy (or "Voice created" for a described voice, which has no name of its own).
 */
export function voiceFromTake(asset: Pick<Asset, 'id' | 'meta'>, labels: { copy: (name: string) => string; created: string }): VoiceFromAssetBody {
  const meta = takeMeta(asset)
  const described = !meta.voice || meta.voice === 'Voix décrite'
  return {
    asset_id: asset.id,
    name: described ? labels.created : labels.copy(meta.voice as string),
    description: meta.instruct,
    transcript: meta.prompt,
    language: meta.language || null,
    kind: meta.instruct && !meta.voice?.includes('(') ? 'design' : 'clone',
  }
}

/** The settings of a generation that "reuse text and settings" restores: the voice, language, style, seed and the model's own parameters. */
export interface ReusedAudio {
  modelId: string
  voice: VoiceRef | undefined
  language: string | undefined
  instruct: string | undefined
  params: GenParams
  count: number | null
  seed: number | null
}

const HIDDEN_PARAMS = ['cast', 'references_used']
export function reusedAudio(message: Pick<Message, 'model_id' | 'params'>): ReusedAudio | null {
  if (!message.model_id) return null
  const { voice, language, instruct, seeds, count, steps: _steps, seed: _seed, ...rest } = message.params as GenParams & { voice?: VoiceRef; instruct?: string }
  void _steps
  void _seed
  return {
    modelId: message.model_id,
    voice: voice as VoiceRef | undefined,
    language: typeof language === 'string' ? language : undefined,
    instruct: typeof instruct === 'string' ? instruct : undefined,
    params: Object.fromEntries(Object.entries(rest).filter(([key]) => !HIDDEN_PARAMS.includes(key))),
    count: typeof count === 'number' ? count : null,
    seed: Array.isArray(seeds) ? (seeds[0] ?? null) : null,
  }
}

/** Language label of a take for the status line (from the model's languages; absent for an unknown language). */
export function languageLabel(caps: AudioCaps | null | undefined, code: unknown): string | null {
  return caps?.languages.find((language) => language.code === code)?.label ?? null
}
