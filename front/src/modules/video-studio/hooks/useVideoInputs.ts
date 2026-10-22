/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useActiveModel, useModels, useModelSelectionStore } from '@/modules/model-catalog'
import { assetsApi } from '@/modules/media-library/services/assetsApi'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import { focusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { matchStudioRoute, studioPaths } from '@/modules/studio-shell/lib/routes'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { useT } from '@/modules/studio-shell/hooks/useT'
import type { Asset } from '@/modules/studio-core/types'
import { captureFrame, FrameCaptureError } from '../lib/frameCapture'
import { modelSwitchFor, planImport, SLOT_WHY_KEY, slotForAsset } from '../lib/slots'
import { useVideoDraftStore } from '../state/videoDraftStore'
import type { VideoSlot } from '../types'

/**
 * What puts something in the slots of the video composer, from anywhere: imported files (picker, paste, window drop) with their
 * upload progress, an asset of the library or of a conversation, a clip taken as the video to edit, the last frame of a clip
 * taken as the start of the next one. Each one switches to a model that can use the input when the active one cannot, and
 * brings the user back to the composer (from the library page, to the home page, where it is).
 */
export function useVideoInputs() {
  const t = useT()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data: catalog } = useModels()
  const active = useActiveModel('video')
  const select = useModelSelectionStore((s) => s.select)

  const ensureModel = (slot: VideoSlot) => {
    const better = modelSwitchFor(slot, active, catalog?.models ?? [])
    if (!better) return
    select('video', better.id)
    toast.info(t('videoStudio.switch.done', [better.name, t(SLOT_WHY_KEY[slot])]), { autoClose: 3200 })
  }
  const leaveLibrary = () => {
    if (matchStudioRoute(pathname)?.route.name === 'video-library') navigate(studioPaths.videoHome)
  }
  const taken = () => {
    const draft = useVideoDraftStore.getState()
    return { start: !!draft.start, end: !!draft.end }
  }

  const importOne = async (file: File, slot: VideoSlot) => {
    const id = crypto.randomUUID()
    const { updateUploads, setSlot } = useVideoDraftStore.getState()
    updateUploads((uploads) => [...uploads.filter((u) => u.slot !== slot), { id, slot, name: file.name, progress: 0 }])
    try {
      const [asset] = await assetsApi.upload([file], {
        onProgress: (percent) => useVideoDraftStore.getState().updateUploads((uploads) => uploads.map((u) => (u.id === id ? { ...u, progress: (percent ?? 0) / 100 } : u))),
      })
      setSlot(slot, asset)
      ensureModel(slot)
      focusTarget('composer')
    } catch (error) {
      toast.error(t('videoStudio.import.failed', [(error as Error).message]))
    } finally {
      useVideoDraftStore.getState().updateUploads((uploads) => uploads.filter((u) => u.id !== id))
    }
  }

  /** Imports files (a picker, a paste, a drop): the first video as the source, up to two images as the start and the end (`forced`: the slot aimed at). */
  const importFiles = async (files: File[], forced?: VideoSlot) => {
    const plan = planImport(files, taken(), active?.video ?? undefined, forced)
    for (const warning of plan.warnings) toast.warning(t(`videoStudio.import.${warning}`))
    await Promise.all(plan.jobs.map((job) => importOne(job.file, job.slot)))
  }

  /** An asset of the library or a conversation, as an input: a video is the source, an image the start (then the end). */
  const assignAsset = (asset: Asset) => {
    const slot = slotForAsset(asset, taken(), active?.video ?? undefined)
    useVideoDraftStore.getState().setSlot(slot, asset)
    ensureModel(slot)
    focusTarget('composer')
  }

  /** A clip as the video to edit. */
  const takeAsSource = (asset: Asset) => {
    useLightboxStore.getState().close()
    useVideoDraftStore.getState().setSlot('source', asset)
    ensureModel('source')
    leaveLibrary()
    focusTarget('composer')
    toast.success(t('videoStudio.toast.sourceReady'), { autoClose: 2200 })
  }

  /** The last frame of a clip, taken in the browser and imported, as the start image of the next clip (continues the shot). */
  const continueFromLastFrame = async (asset: Asset) => {
    const id = toast.loading(t('videoStudio.toast.capturing'))
    try {
      const file = await captureFrame(resolveMediaUrl(asset.url), 'last')
      const [image] = await assetsApi.upload([file])
      const draft = useVideoDraftStore.getState()
      useLightboxStore.getState().close()
      draft.setSlot('start', image)
      draft.setSlot('end', null)
      draft.setSlot('source', null)
      ensureModel('start')
      leaveLibrary()
      focusTarget('composer')
      toast.update(id, { render: t('videoStudio.toast.lastFrameReady'), type: 'success', isLoading: false, autoClose: 2600 })
    } catch (error) {
      toast.update(id, { render: error instanceof FrameCaptureError ? t(error.key) : (error as Error).message, type: 'error', isLoading: false, autoClose: 5000 })
    }
  }

  return { importFiles, assignAsset, takeAsSource, continueFromLastFrame }
}
