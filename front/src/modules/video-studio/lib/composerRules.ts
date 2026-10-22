/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { Help } from '@/modules_shared/common/components/ui/help/helpText'
import { MODEL_HELP, type ModelInfo } from '@/modules/model-catalog'
import type { Asset } from '@/modules/studio-core/types'

/** What is attached to the composer. `uploading`: imports still in progress. */
export interface VideoInputs {
  start: Asset | null
  end: Asset | null
  source: Asset | null
  uploading: number
}

type Caps = Pick<ModelInfo, 'video'>

export interface VideoRequirements {
  /** The model animates an image and none is attached (a source video makes up for it). */
  needStart: boolean
  needSource: boolean
  /** An end image without a start image: the model needs both. */
  endWithoutStart: boolean
  /** A source video is attached and the model edits it: parameters that only make sense when editing apply. */
  editing: boolean
}

export function videoRequirements(model: Caps, inputs: Pick<VideoInputs, 'start' | 'end' | 'source'>): VideoRequirements {
  const caps = model.video
  if (!caps) return { needStart: false, needSource: false, endWithoutStart: false, editing: false }
  return {
    needStart: caps.image_input === 'required' && !inputs.start && !inputs.source,
    needSource: caps.video_input === 'required' && !inputs.source,
    endWithoutStart: caps.last_frame && !!inputs.end && !inputs.start,
    editing: !!inputs.source && caps.video_input !== 'none',
  }
}

/** What stops the send button, in order of priority; `null` when nothing does. */
export type VideoBlock = 'incompatible' | 'notReady' | 'needSource' | 'needStart' | 'uploading' | null

const TIPS: Record<Exclude<VideoBlock, null>, string> = {
  notReady: 'videoStudio.send.notReady',
  incompatible: 'videoStudio.send.incompatible',
  needSource: 'videoStudio.send.needSource',
  needStart: 'videoStudio.send.needStart',
  uploading: 'videoStudio.send.uploading',
}

export interface VideoSendState {
  canSend: boolean
  block: VideoBlock
  /** Locale key of the send button's tooltip. */
  tipKey: string
}

export function videoSendBlock(model: Pick<ModelInfo, 'ready' | 'compatible' | 'video'>, inputs: VideoInputs): VideoBlock {
  const need = videoRequirements(model, inputs)
  if (!model.compatible) return 'incompatible'
  if (!model.ready) return 'notReady'
  if (need.needSource) return 'needSource'
  if (need.needStart || need.endWithoutStart) return 'needStart'
  return inputs.uploading > 0 ? 'uploading' : null
}

/** Whether the clip can be requested, and what the button's tooltip says: the first missing thing, else "Generate". */
export function videoSendState(model: Pick<ModelInfo, 'ready' | 'compatible' | 'video'>, inputs: VideoInputs, input: { prompt: string; sending: boolean }): VideoSendState {
  const block = videoSendBlock(model, inputs)
  return { canSend: input.prompt.trim().length > 0 && block === null && !input.sending, block, tipKey: block ? TIPS[block] : 'videoStudio.send.tip' }
}

export interface VideoNotice {
  id: string
  tone: 'warn' | 'info'
  /** Text from the engine (not translated), else a locale key. */
  text?: string
  key?: string
  params?: (string | number)[]
  help?: Help
}

/** Notices under the prompt: the model cannot run here, the plan's note, what is missing, what will be ignored, language and sound. */
export function videoNotices(model: ModelInfo, inputs: Pick<VideoInputs, 'start' | 'end' | 'source'>): VideoNotice[] {
  const caps = model.video
  if (!caps) return []
  const need = videoRequirements(model, inputs)
  const name = [model.name]
  const notices: VideoNotice[] = []
  if (!model.compatible) notices.push({ id: 'incompatible', tone: 'warn', text: model.engine_reason || model.plan.note || undefined, key: 'videoStudio.notice.incompatible', params: name })
  else if (model.plan.note) notices.push({ id: 'plan', tone: 'info', text: model.plan.note })
  if (need.needSource) notices.push({ id: 'needSource', tone: 'warn', key: 'videoStudio.notice.needSource', params: name })
  if (need.needStart) notices.push({ id: 'needStart', tone: 'warn', key: 'videoStudio.notice.needStart', params: name })
  if (need.endWithoutStart) notices.push({ id: 'endWithoutStart', tone: 'warn', key: 'videoStudio.notice.endWithoutStart' })
  if (inputs.start && caps.image_input === 'none') notices.push({ id: 'startIgnored', tone: 'warn', key: 'videoStudio.notice.startIgnored', params: name })
  if (inputs.end && !caps.last_frame) notices.push({ id: 'endIgnored', tone: 'warn', key: 'videoStudio.notice.endIgnored', params: name })
  if (inputs.source && caps.video_input === 'none') notices.push({ id: 'sourceIgnored', tone: 'warn', key: 'videoStudio.notice.sourceIgnored', params: name })
  if (caps.english_only) notices.push({ id: 'english', tone: 'info', key: 'videoStudio.notice.english', params: name, help: MODEL_HELP.englishOnly })
  if (caps.audio_out) notices.push({ id: 'audio', tone: 'info', key: 'videoStudio.notice.audio', params: name, help: MODEL_HELP.audioOut })
  return notices
}

/** Placeholder of the prompt: describe an edit, a movement from an image, or a scene. */
export function placeholderKey(editing: boolean, hasStart: boolean): string {
  if (editing) return 'videoStudio.prompt.placeholder.edit'
  return hasStart ? 'videoStudio.prompt.placeholder.start' : 'videoStudio.prompt.placeholder.text'
}

/** The slots drawn above the prompt: those the model can use, plus any that still holds something (so it can be removed). */
export function visibleSlots(model: Caps, inputs: Pick<VideoInputs, 'start' | 'end' | 'source'>, uploadSlots: readonly string[]): { start: boolean; end: boolean; source: boolean } {
  const caps = model.video
  return {
    start: caps?.image_input !== 'none' || !!inputs.start || uploadSlots.includes('start'),
    end: !!caps?.last_frame || !!inputs.end || uploadSlots.includes('end'),
    source: caps?.video_input !== 'none' || !!inputs.source || uploadSlots.includes('source'),
  }
}

export interface SlotRole {
  labelKey: string
  shortKey: string
  required: boolean
  /** The model does not use this input: the slot is shown dimmed ("ignored"). */
  unused: boolean
}

/** How a slot presents itself for a model: its name, whether it is required, whether the model ignores it. */
export function slotRole(slot: 'start' | 'end' | 'source', model: Caps, hasSource: boolean): SlotRole {
  const caps = model.video
  if (slot === 'source') return { labelKey: 'videoStudio.slot.source.label', shortKey: 'videoStudio.slot.source.short', required: caps?.video_input === 'required', unused: caps?.video_input === 'none' }
  if (slot === 'end') return { labelKey: 'videoStudio.slot.end.label', shortKey: 'videoStudio.slot.end.short', required: false, unused: !caps?.last_frame }
  const reference = caps?.image_role === 'reference'
  return {
    labelKey: reference ? 'videoStudio.slot.reference.label' : 'videoStudio.slot.start.label',
    shortKey: reference ? 'videoStudio.slot.reference.short' : 'videoStudio.slot.start.short',
    required: caps?.image_input === 'required' && !hasSource,
    unused: caps?.image_input === 'none',
  }
}
