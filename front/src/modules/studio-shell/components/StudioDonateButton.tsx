/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Button } from '@mui/material'
import FavoriteIcon from '@mui/icons-material/Favorite'
import { useQuery } from '@tanstack/react-query'
import { DonateButton } from '@/modules_shared/common/components/ui/DonateButton'
import { validationTrace } from '@/modules_shared/common/utils/validationTrace'
import { useT } from '../hooks/useT'
import { studioRequest } from '../services/studioHttp'
import { DesktopDonationDialog, type DesktopDonationMethods } from './DesktopDonationDialog'

const traceActivation = () => validationTrace('studio.donation_button_activated', 'ok')

/** The packaged studio gets its recipients from its own desktop configuration. */
export function StudioDonateButton() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ['desktop-donation-methods'],
    queryFn: () => studioRequest<{ methods: DesktopDonationMethods | null }>('get', '/studio/desktop-donations'),
    staleTime: Infinity,
  })

  if (data?.methods === null) return <DonateButton size="small" fullWidth onClickCapture={traceActivation} />

  const activate = () => {
    if (!data) {
      void refetch()
      return
    }
    traceActivation()
    setOpen(true)
  }

  return (
    <>
      <Button variant="outlined" size="small" fullWidth startIcon={<FavoriteIcon />} loading={isFetching} onClick={activate}>
        {t(isError ? 'studio.donation.retry' : 'common.donations.buttonLabel')}
      </Button>
      {open && data && <DesktopDonationDialog methods={data.methods} onClose={() => setOpen(false)} />}
    </>
  )
}
