/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Tab, Tabs, TextField } from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'
import { toastService } from '@/modules_shared/common/core/toast/ToastService'
import { validationTrace } from '@/modules_shared/common/utils/validationTrace'
import { useT } from '../hooks/useT'

export interface DesktopDonationMethods {
  btc: string
  eth: string
  sol: string
  stripeUrl: string
}

const WALLETS = {
  btc: { label: 'BTC', network: 'Bitcoin', uri: (address: string) => `bitcoin:${address}` },
  eth: { label: 'ETH', network: 'Ethereum', uri: (address: string) => `ethereum:${address}@1` },
  sol: { label: 'SOL', network: 'Solana', uri: (address: string) => `solana:${address}` },
} as const

type Wallet = keyof typeof WALLETS

async function copyAddress(address: string) {
  try {
    await navigator.clipboard.writeText(address)
    toastService.success('common.donations.copy.address.success')
  } catch {
    toastService.error('common.donations.copy.error')
  }
}

/** Lets the donor choose the amount in their wallet or on the hosted Stripe page. */
export function DesktopDonationDialog({ methods, onClose }: { methods: DesktopDonationMethods; onClose: () => void }) {
  const t = useT()
  const [wallet, setWallet] = useState<Wallet>('btc')
  const { network, uri } = WALLETS[wallet]
  const address = methods[wallet]

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="desktop-donation-title">
      <DialogTitle id="desktop-donation-title">{t('common.donations.dialogTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Button variant="contained" href={methods.stripeUrl} target="_blank" rel="noopener noreferrer"
            onClick={() => validationTrace('studio.desktop_donation_stripe_selected', 'ok')}>
            {t('studio.donation.stripe')}
          </Button>
          <Tabs value={wallet} onChange={(_, value: Wallet) => setWallet(value)} aria-label={t('studio.donation.crypto')}>
            {(Object.keys(WALLETS) as Wallet[]).map((id) => (
              <Tab key={id} value={id} label={WALLETS[id].label} id={`donation-tab-${id}`} aria-controls="donation-wallet" />
            ))}
          </Tabs>
          <Stack id="donation-wallet" role="tabpanel" aria-labelledby={`donation-tab-${wallet}`} spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ bgcolor: 'var(--common-cryptopay-qr-bg)', p: 1.5, borderRadius: 1, display: 'flex' }}>
              <QRCodeSVG value={uri(address)} size={160} aria-hidden />
            </Box>
            <TextField fullWidth label={t('studio.donation.networkAddress', [network])} value={address}
              slotProps={{ input: { readOnly: true } }} />
            <Button onClick={() => { void copyAddress(address) }}>{t('common.donations.copy')}</Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>{t('settings.close')}</Button></DialogActions>
    </Dialog>
  )
}
