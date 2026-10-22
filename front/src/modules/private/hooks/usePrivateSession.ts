/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { i18n } from '@/modules_shared/common/core/i18n/I18n'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { enterPrivate, eraseNow, leavePrivate } from '../lib/privateSession'
import { usePrivateStore } from '../state/privateStore'

/** Home of the studio: where a private session starts and ends (nothing of the normal side is shown in it). */
const HOME = '/'

/** The three things the user does with the private mode, each with its confirmation and its navigation. */
export function usePrivateSession() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const enter = useCallback(async () => {
    const ok = await confirm({ titleId: 'private.enter.title', messageId: 'private.enter.message', confirmLabelId: 'private.enter.confirm' })
    if (!ok) return
    if (await enterPrivate(queryClient)) navigate(HOME, { replace: true })
    else toast.error(i18n.get('private.error.start'))
  }, [queryClient, navigate])

  const leave = useCallback(async () => {
    const results = usePrivateStore.getState().info?.results ?? 0
    const ok = await confirm({ titleId: 'private.leave.title', messageId: 'private.leave.message', params: [results], confirmLabelId: 'private.leave.confirm', danger: true })
    if (!ok) return
    await leavePrivate(queryClient)
    navigate(HOME, { replace: true })
  }, [queryClient, navigate])

  const erase = useCallback(async () => {
    const results = usePrivateStore.getState().info?.results ?? 0
    const ok = await confirm({ titleId: 'private.erase.title', messageId: 'private.erase.message', params: [results], confirmLabelId: 'private.erase.confirm', danger: true })
    if (!ok) return
    await eraseNow(queryClient)
    navigate(HOME, { replace: true })
  }, [queryClient, navigate])

  return { enter, leave, erase }
}
