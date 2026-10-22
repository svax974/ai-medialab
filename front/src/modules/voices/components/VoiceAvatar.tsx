/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box } from '@mui/material'
import MicRounded from '@mui/icons-material/MicRounded'
import { avatarGradient, initialOf } from '../lib/voiceMeta'

/** Round avatar of a voice: a gradient picked from its name, the initial of a built-in voice or a microphone for the library's. */
export function VoiceAvatar({ name, size = 28, library = false }: { name: string; size?: number; library?: boolean }) {
  return (
    <Box component="span" sx={{ display: 'grid', flexShrink: 0, placeItems: 'center', width: size, height: size, borderRadius: '50%', fontSize: size * 0.42, fontWeight: 500, color: 'rgba(255,255,255,0.95)', boxShadow: '0 0 0 1px rgba(255,255,255,0.1)', background: avatarGradient(name) }}>
      {library ? <MicRounded sx={{ fontSize: size * 0.5 }} /> : initialOf(name)}
    </Box>
  )
}
