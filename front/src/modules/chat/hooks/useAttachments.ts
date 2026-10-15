/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react'
import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { isPrivateMode } from '@/modules/private/state/privateStore'
import { studioRequest } from '@/modules/studio-shell/services/studioHttp'
import { checkAttachment, refusalKey } from '../lib/attachments'
import { chatApi } from '../services/chatApi'
import { useChatDraftStore } from '../state/chatDraftStore'
import type { ChatAttachment } from '../types'

const NONE: ChatAttachment[] = []

/**
 * The files attached to the next message of a draft: each is checked (type, size, the model's vision, the count), then
 * uploaded; a refusal says why. Files are added one after the other and listed as soon as the server has them.
 */
export function useAttachments(draftKey: string, vision: boolean) {
  const attached = useChatDraftStore((s) => s.attachments[draftKey] ?? NONE)
  const setAttachments = useChatDraftStore((s) => s.setAttachments)
  const [uploading, setUploading] = useState(0)

  const add = useCallback(
    async (files: File[]) => {
      let count = useChatDraftStore.getState().attachments[draftKey]?.length ?? 0
      for (const file of files) {
        const verdict = checkAttachment(file, { vision, attached: count })
        if (!verdict.ok) {
          toast.error(i18n.get(refusalKey(verdict.reason), [file.name]))
          continue
        }
        setUploading((n) => n + 1)
        try {
          const uploaded = await chatApi.upload(file)
          const current = useChatDraftStore.getState().attachments[draftKey] ?? []
          setAttachments(draftKey, [...current, uploaded])
          count += 1
        } catch (error) {
          toast.error((error as Error).message)
        } finally {
          setUploading((n) => n - 1)
        }
      }
    },
    [draftKey, vision, setAttachments],
  )
  const remove = useCallback(
    (name: string) => {
      setAttachments(draftKey, (useChatDraftStore.getState().attachments[draftKey] ?? []).filter((a) => a.name !== name))
      // A private session keeps the file only for a message: one taken off before it is sent is removed from the session folder now.
      if (isPrivateMode()) void studioRequest('delete', `/chat/attachments/${encodeURIComponent(name)}`).catch(() => undefined)
    },
    [draftKey, setAttachments],
  )
  return { attached, uploading, add, remove }
}
