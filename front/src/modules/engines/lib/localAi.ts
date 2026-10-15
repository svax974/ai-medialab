/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import type { DownloadProgress, ModelInfo } from '@/modules/model-catalog'
import type { EngineInstallState } from '../types'

/** The small chat model the local helpers (update adviser, prompt improver) are built around; the catalogue's recommended one wins when it says so. */
export const ADVISOR_MODEL_ID = 'llm-qwen3-4b-instruct-2507'
/** Free disk space to keep once everything is downloaded (GB). */
export const DISK_MARGIN_GB = 2

/**
 * `unknown`: catalogue or machine not read yet. `ready`: llama.cpp and a chat model are installed. `needs-setup`: something is missing.
 * `installing` / `downloading`: the engine / the model is on its way. `error`: the last attempt failed. `no-space`: not enough disk.
 */
export type LocalAiState = 'unknown' | 'ready' | 'needs-setup' | 'installing' | 'downloading' | 'error' | 'no-space'

export interface LocalAiProgress {
  step: 'engine' | 'model'
  done: number
  total: number
  rate?: number
  eta?: number | null
  /** What the installer says it is doing (the engine's install steps). */
  message?: string
}

/** What `useLocalAiSetup` reads: the live and the stored state of the engine, the model and the disk. */
export interface LocalAiInput {
  models: ModelInfo[] | undefined
  recommendedId?: string | null
  /** llama.cpp is installed and runs here (`system.engines.llamacpp.available`), when known. */
  engineInstalled?: boolean
  engineSizeMb?: number | null
  /** Live installer state of llama.cpp (event stream). */
  engineInstall: EngineInstallState
  downloads: Record<string, DownloadProgress>
  /** Model whose download follows the engine install (`useInstallStore.pendingModelId`). */
  pendingModelId: string | null
  freeDiskGb: number | null
}

export interface LocalAiView {
  state: LocalAiState
  /** The model that gets installed when none is: the catalogue's recommended one (null before the catalogue is read). */
  modelId: string | null
  modelName: string | null
  engineInstalled: boolean
  /** Some chat model is installed (not necessarily `modelId`: any one will do). */
  modelInstalled: boolean
  /** What still has to come over, MB for the engine and GB for the model (0 when installed). */
  engineSizeMb: number
  modelSizeGb: number
  /** Disk needed in total (GB) and free now (null when unknown). */
  neededGb: number
  freeGb: number | null
  progress: LocalAiProgress | null
  error: string | null
}

export function pickAdvisor(models: ModelInfo[], recommendedId?: string | null): ModelInfo | null {
  const chat = models.filter((m) => m.kind === 'llm')
  return chat.find((m) => m.id === recommendedId) ?? chat.find((m) => m.id === ADVISOR_MODEL_ID) ?? chat[0] ?? null
}

function engineStep(install: EngineInstallState): LocalAiProgress | null {
  return install.state === 'running' ? { step: 'engine', done: install.done ?? 0, total: install.total ?? 0, message: install.message } : null
}

function modelStep(advisor: ModelInfo | null, downloads: Record<string, DownloadProgress>): LocalAiProgress | null {
  if (!advisor) return null
  const live = downloads[advisor.id]
  const d = live?.state === 'running' ? live : advisor.download?.state === 'running' ? advisor.download : null
  return d ? { step: 'model', done: d.done, total: d.total, rate: d.rate, eta: d.eta } : null
}

function failure(install: EngineInstallState, advisor: ModelInfo | null, downloads: Record<string, DownloadProgress>): string | null {
  if (install.state === 'error') return install.error ?? ''
  const d = advisor ? (downloads[advisor.id] ?? advisor.download) : null
  return d?.state === 'error' ? (d.error ?? '') : null
}

/** What the local AI setup looks like now, from the catalogue, the installers and the disk: pure, so it can be tested. */
export function deriveLocalAi(input: LocalAiInput): LocalAiView {
  const { models, engineInstall, downloads, pendingModelId, freeDiskGb } = input
  const advisor = models ? pickAdvisor(models, input.recommendedId) : null
  const modelInstalled = !!models?.some((m) => m.kind === 'llm' && m.install === 'installed')
  const engineInstalled = input.engineInstalled ?? (!!advisor && !advisor.needs_engine_install)
  const engineSizeMb = engineInstalled ? 0 : Math.round(input.engineSizeMb ?? advisor?.engine_install_size_mb ?? 0)
  const modelSizeGb = modelInstalled || !advisor ? 0 : Math.max(0, (advisor.download_size_gb ?? 0) - advisor.installed_gb)
  const neededGb = engineSizeMb / 1024 + modelSizeGb
  const base = { modelId: advisor?.id ?? null, modelName: advisor?.name ?? null, engineInstalled, modelInstalled, engineSizeMb, modelSizeGb, neededGb, freeGb: freeDiskGb }
  const progress = engineStep(engineInstall) ?? modelStep(advisor, downloads)
  const error = failure(engineInstall, advisor, downloads)
  const view = (state: LocalAiState): LocalAiView => ({ ...base, state, progress, error })
  if (!models) return view('unknown')
  if (progress) return view(progress.step === 'engine' ? 'installing' : 'downloading')
  if (pendingModelId && pendingModelId === advisor?.id && engineInstall.state === 'done') return view('downloading') // between the two steps
  if (engineInstalled && modelInstalled) return view('ready')
  if (error !== null) return view('error')
  return view(freeDiskGb !== null && neededGb + DISK_MARGIN_GB > freeDiskGb ? 'no-space' : 'needs-setup')
}
