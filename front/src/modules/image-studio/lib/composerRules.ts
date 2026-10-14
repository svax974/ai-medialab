/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { ModelInfo } from '@/modules/model-catalog'

/** Message about the model and the references, shown under the prompt. */
export interface Notice {
  id: string
  tone: 'warn' | 'info'
  /** Locale key and its parameters, or a text that the engine wrote (not translated). */
  key?: string
  params?: (string | number)[]
  text?: string
  /** Offers to switch to `Alternative` (a model that accepts all the attached images). */
  withSwitch?: boolean
}

type ModelLike = Pick<ModelInfo, 'id' | 'reference_mode' | 'max_references' | 'compatible' | 'ready' | 'download_size_gb'>

/**
 * A model that accepts all the attached images (`multi` mode with enough slots), compatible with this machine: the ones
 * ready to use first, then those to install, the lightest download first.
 */
export function multiAlternative<T extends ModelLike>(models: readonly T[], current: Pick<ModelInfo, 'id'>, referenceCount: number): T | undefined {
  return models
    .filter((m) => m.id !== current.id && m.reference_mode === 'multi' && m.compatible && m.max_references >= referenceCount)
    .sort((a, b) => Number(b.ready) - Number(a.ready) || (a.download_size_gb ?? 0) - (b.download_size_gb ?? 0))[0]
}

/** The notices of a composer: what the model needs or ignores about the references, and what the machine says about it. */
export function composerNotices(model: ModelInfo, referenceCount: number, hasAlternative: boolean): Notice[] {
  const notices: Notice[] = []
  const name = model.name
  if (model.requires_references && referenceCount === 0) notices.push({ id: 'requires', tone: 'warn', key: 'imageStudio.notice.requiresReferences', params: [name] })
  if (model.reference_mode === 'none' && referenceCount > 0) notices.push({ id: 'none', tone: 'warn', key: 'imageStudio.notice.noReferences', params: [name], withSwitch: hasAlternative })
  if (model.reference_mode === 'init' && referenceCount > 1) notices.push({ id: 'init', tone: 'warn', key: 'imageStudio.notice.initOnly', params: [name], withSwitch: hasAlternative })
  if ((model.reference_mode === 'multi' || model.reference_mode === 'face') && referenceCount > model.max_references) notices.push({ id: 'max', tone: 'info', key: 'imageStudio.notice.maxReferences', params: [name, model.max_references] })
  if (!model.compatible) {
    const text = model.engine_reason || model.plan.note
    notices.push(text ? { id: 'incompatible', tone: 'warn', text } : { id: 'incompatible', tone: 'warn', key: 'imageStudio.notice.cannotRun', params: [name] })
  } else if (model.plan.note && model.plan.strategy !== 'full') notices.push({ id: 'plan', tone: 'info', text: model.plan.note })
  return notices
}

/** What a reference thumbnail says about its role for the model (its badge, and the tooltip). */
export interface ReferenceRole {
  /** Locale keys of the badge and of the tooltip; `ignored` dims the thumbnail. */
  noteKey: string
  helpKey: string
  /** Parameters of the tooltip (`{0}` model name, `{1}` max, or the number of the image in the badge). */
  noteParams?: (string | number)[]
  helpParams?: (string | number)[]
  ignored: boolean
}

/**
 * Role of the reference at `index` (0-based) for a model: ignored, the start image (img2img), "image N" of a multi-image
 * edit, or in "face" mode the face to follow (1st) then the start image (2nd).
 */
export function referenceRole(model: Pick<ModelInfo, 'name' | 'reference_mode' | 'max_references'>, index: number): ReferenceRole {
  if (model.reference_mode === 'none') return { noteKey: 'imageStudio.ref.note.ignored', helpKey: 'imageStudio.ref.help.none', helpParams: [model.name], ignored: true }
  if (model.reference_mode === 'face') {
    if (index === 0) return { noteKey: 'imageStudio.ref.note.face', helpKey: 'imageStudio.ref.help.face', ignored: false }
    if (index === 1) return { noteKey: 'imageStudio.ref.note.start', helpKey: 'imageStudio.ref.help.faceStart', ignored: false }
    return { noteKey: 'imageStudio.ref.note.ignored', helpKey: 'imageStudio.ref.help.multiIgnored', helpParams: [model.max_references], ignored: true }
  }
  if (model.reference_mode === 'init') {
    return index === 0
      ? { noteKey: 'imageStudio.ref.note.start', helpKey: 'imageStudio.ref.help.start', ignored: false }
      : { noteKey: 'imageStudio.ref.note.ignored', helpKey: 'imageStudio.ref.help.initIgnored', ignored: true }
  }
  return index < model.max_references
    ? { noteKey: 'imageStudio.ref.note.image', noteParams: [index + 1], helpKey: 'imageStudio.ref.help.image', helpParams: [index + 1], ignored: false }
    : { noteKey: 'imageStudio.ref.note.ignored', helpKey: 'imageStudio.ref.help.multiIgnored', helpParams: [model.max_references], ignored: true }
}

/** Placeholder of the prompt field. */
export function placeholderKey(model: Pick<ModelInfo, 'requires_references' | 'reference_mode'>, hasRefs: boolean): string {
  if (!hasRefs && model.reference_mode === 'face') return 'imageStudio.placeholder.faceNeedsImage'
  if (!hasRefs) return model.requires_references ? 'imageStudio.placeholder.editNeedsImage' : 'imageStudio.placeholder.default'
  if (model.reference_mode === 'multi') return 'imageStudio.placeholder.multi'
  if (model.reference_mode === 'face') return 'imageStudio.placeholder.face'
  if (model.reference_mode === 'init') return 'imageStudio.placeholder.init'
  return 'imageStudio.placeholder.plain'
}

export interface SendState {
  canSend: boolean
  /** Locale key of the tooltip of the "Generate" button. */
  tipKey: string
}

/**
 * Whether the prompt can be sent, and what the button's tooltip says: a model that edits images needs one, a model not
 * installed or not compatible cannot run; an empty prompt, an import in progress or a send in progress also disable it.
 */
export function sendState(
  model: Pick<ModelInfo, 'requires_references' | 'ready' | 'compatible'>,
  input: { prompt: string; referenceCount: number; uploading: number; sending: boolean },
): SendState {
  const missingReference = model.requires_references && input.referenceCount === 0
  const blocked = missingReference || !model.ready || !model.compatible
  const canSend = input.prompt.trim().length > 0 && !blocked && input.uploading === 0 && !input.sending
  const tipKey = !model.ready && model.compatible ? 'imageStudio.send.tip.install' : !model.compatible ? 'imageStudio.send.tip.incompatible' : blocked ? 'imageStudio.send.tip.needReference' : 'imageStudio.send.tip.generate'
  return { canSend, tipKey }
}
