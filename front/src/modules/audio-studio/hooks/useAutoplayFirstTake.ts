/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { getSharedAudioPlayer } from '@/modules_shared/common/components/ui/media'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import type { Asset } from '@/modules/studio-core'
import { shouldAutoplay } from '../lib/takes'
import { useAudioDraftStore } from '../state/audioDraftStore'

/** Takes already considered for autoplay in this tab (a take is only ever started once, never by a reload of the thread). */
const considered = new Set<string>()

/**
 * Starts the first take of a message by itself when it has just been produced and autoplay is on. Opening an old
 * conversation (takes produced long ago) or having another sound playing starts nothing. A browser that refuses to play
 * without a gesture is left alone: the play button works.
 */
export function useAutoplayFirstTake(first: Asset | undefined): void {
  const enabled = useAudioDraftStore((s) => s.autoplay)
  useEffect(() => {
    if (!enabled || !first || considered.has(first.id)) return
    const store = getSharedAudioPlayer()
    const start = shouldAutoplay({ enabled, first, alreadyPlayed: considered, nowSeconds: Date.now() / 1000, playing: store.getState().playing })
    considered.add(first.id)
    if (start) store.play(first.id, resolveMediaUrl(first.url))
  }, [first, enabled])
}
