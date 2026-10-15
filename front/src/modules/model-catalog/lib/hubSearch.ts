/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { HubInspect, HubOption, HubResult, ModelKind } from '../types'

/** Delay before a typed query is sent to Hugging Face. */
export const SEARCH_DEBOUNCE_MS = 350

/** Number of downloads as the old interface wrote it: `1,2 M`, `12 k`, or the plain number. */
export function compactCount(n: number, lang = 'fr'): string {
  const number = (value: number, digits: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
  if (n >= 1e6) return `${number(n / 1e6, 1)} M`
  if (n >= 1e3) return `${Math.round(n / 1e3)} k`
  return String(n)
}

/**
 * The quantization selected by default: among those this machine can run (all of them when none can), Q4_K if there
 * is one, else the middle one. Never a variant known not to fit when another one fits.
 */
export function defaultOption(options: HubOption[]): HubOption | null {
  const runnable = options.filter((o) => o.fits !== false)
  const pool = runnable.length ? runnable : options
  if (!pool.length) return null
  return pool.find((o) => /^Q4_K/.test(o.label)) ?? pool[Math.floor(pool.length / 2)]
}

/** The option to show as chosen: the user's pick, else the default one. */
export function chosenOption(options: HubOption[], pickedKey: string | null): HubOption | null {
  return options.find((o) => o.key === pickedKey) ?? defaultOption(options)
}

/** The add button is blocked when the machine cannot run the model at all or the chosen variant does not fit. */
export function isAddBlocked(inspect: Pick<HubInspect, 'compatible'> | undefined, chosen: HubOption | null): boolean {
  return !inspect?.compatible || chosen?.fits === false
}

/** Option state for the picker: struck through and dimmed when the variant does not fit in memory. */
export const optionDoesNotFit = (o: Pick<HubOption, 'fits'>): boolean => o.fits === false

/** What adding the variant downloads: its file plus the reference model's shared files still missing (engine
 *  `download_gb`); the file alone when the engine gave no figure. */
export const optionDownloadGb = (o: Pick<HubOption, 'size_gb' | 'download_gb'>): number => o.download_gb ?? o.size_gb

/** Part of the download that is the reference model's shared files (text encoder, VAE...), 0 when already present. */
export const sharedDownloadGb = (o: Pick<HubOption, 'size_gb' | 'download_gb'>): number =>
  Math.max(0, Math.round((optionDownloadGb(o) - o.size_gb) * 100) / 100)

export const HUB_PLACEHOLDER_KEY: Record<ModelKind, string> = {
  image: 'models.hub.placeholder.image',
  audio: 'models.hub.placeholder.audio',
  video: 'models.hub.placeholder.video',
  llm: 'models.hub.placeholder.llm',
}
export const HUB_HELP_KEY: Record<ModelKind, string> = {
  image: 'models.hub.help.image',
  audio: 'models.hub.help.audio',
  video: 'models.hub.help.video',
  llm: 'models.hub.help.llm',
}
export const HUB_TASK_KEY: Record<HubResult['task'], string> = {
  image: 'models.hub.task.image',
  tts: 'models.hub.task.tts',
  stt: 'models.hub.task.stt',
  video: 'models.hub.task.video',
  llm: 'models.hub.task.llm',
}
