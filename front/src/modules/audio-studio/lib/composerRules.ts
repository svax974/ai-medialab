/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'
import { LONG_TEXT_LENGTH, MAX_TEXT_LENGTH } from './audioText'

export interface AudioNotice {
  id: string
  tone: 'warn' | 'info'
  /** Text from the engine (not translated), else a locale key. */
  text?: string
  key?: string
  params?: (string | number)[]
}

/** What stops the send button, in order of priority; `null` when nothing does. */
export type SendBlock = 'notReady' | 'incompatible' | 'needsDescription' | 'needsVoice' | null

export interface AudioSendInput {
  prompt: string
  hasVoice: boolean
  instruct: string
  sending: boolean
}

export interface AudioSendState {
  canSend: boolean
  block: SendBlock
  /** Locale key of the send button's tooltip. */
  tipKey: string
}

export function sendBlock(model: Pick<ModelInfo, 'ready' | 'compatible' | 'audio'>, input: Pick<AudioSendInput, 'hasVoice' | 'instruct'>): SendBlock {
  const design = !!model.audio?.design
  if (!model.compatible) return 'incompatible'
  if (!model.ready) return 'notReady'
  if (design && !input.instruct.trim()) return 'needsDescription'
  if (!design && !input.hasVoice) return 'needsVoice'
  return null
}

const TIPS: Record<Exclude<SendBlock, null>, string> = {
  notReady: 'audioStudio.send.notReady',
  incompatible: 'audioStudio.send.incompatible',
  needsDescription: 'audioStudio.send.needsDescription',
  needsVoice: 'audioStudio.send.needsVoice',
}

/** Whether the text can go, and what the button's tooltip says: the first missing thing, else "Synthesize". */
export function audioSendState(model: Pick<ModelInfo, 'ready' | 'compatible' | 'audio'>, input: AudioSendInput): AudioSendState {
  const block = sendBlock(model, input)
  const canSend = input.prompt.trim().length > 0 && block === null && !input.sending && input.prompt.length <= MAX_TEXT_LENGTH
  return { canSend, block, tipKey: block ? TIPS[block] : 'audioStudio.send.tip' }
}

/** Notices under the text: the model cannot run here, the plan's note, a missing voice, a very long text. */
export function audioNotices(model: ModelInfo, input: { prompt: string; needsVoice: boolean }): AudioNotice[] {
  const notices: AudioNotice[] = []
  if (!model.compatible) notices.push({ id: 'incompatible', tone: 'warn', text: model.engine_reason || model.plan.note || undefined, key: 'audioStudio.notice.incompatible', params: [model.name] })
  else if (model.plan.note) notices.push({ id: 'plan', tone: 'info', text: model.plan.note })
  if (input.needsVoice && model.compatible) notices.push({ id: 'needsVoice', tone: 'warn', key: 'audioStudio.notice.needsVoice' })
  if (input.prompt.length > LONG_TEXT_LENGTH) notices.push({ id: 'long', tone: 'info', key: 'audioStudio.notice.long' })
  return notices
}
