/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode } from 'react'
import { Box, Switch } from '@mui/material'
import { InfoTip, type Help } from '@/modules_shared/common/components/ui/help'

/** Heading of a section: small caps title and its `InfoTip`. */
export function SectionTitle({ title, help }: { title: string; help: Help }) {
  return (
    <Box component="h3" className="cn-eyebrow" sx={{ m: 0, mb: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
      {title}
      <InfoTip {...help} />
    </Box>
  )
}

export function SectionText({ children }: { children: ReactNode }) {
  return (
    <Box component="p" sx={{ m: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--muted)' }}>
      {children}
    </Box>
  )
}

interface SwitchRowProps {
  title: string
  description: string
  help: Help
  checked: boolean
  onChange: (checked: boolean) => void
}

/** A boolean setting: title with its `InfoTip`, explanation, and the switch on the right. */
export function SwitchRow({ title, description, help, checked, onChange }: SwitchRowProps) {
  return (
    <Box component="section" sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 3 }}>
      <div>
        <SectionTitle title={title} help={help} />
        <SectionText>{description}</SectionText>
      </div>
      <Switch checked={checked} onChange={(_event, value) => onChange(value)} slotProps={{ input: { 'aria-label': title } }} sx={{ mt: '4px', flexShrink: 0 }} />
    </Box>
  )
}
