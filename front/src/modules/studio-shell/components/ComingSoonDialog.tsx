/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { Dialog, DialogContent, DialogTitle, Box } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useT } from '../hooks/useT'

interface ComingSoonDialogProps {
  open: boolean
  onClose: () => void
  /** i18n key of the dialog title. */
  titleKey: string
}

/** Empty dialog standing for a panel that a later step fills (settings, models). */
export function ComingSoonDialog({ open, onClose, titleKey }: ComingSoonDialogProps) {
  const t = useT()
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby={titleKey}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 3 }}>
        <DialogTitle id={titleKey}>{t(titleKey)}</DialogTitle>
        <TipIconButton labelId="studio.dialog.close" onClick={onClose} sx={{ borderRadius: '8px' }}>
          <CloseRounded sx={{ fontSize: 16 }} />
        </TipIconButton>
      </Box>
      <DialogContent>{t('studio.dialog.comingSoon')}</DialogContent>
    </Dialog>
  )
}
