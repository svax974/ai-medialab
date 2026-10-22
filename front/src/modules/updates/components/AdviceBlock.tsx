/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Box, Button, Link } from '@mui/material'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { sortFindings, verdictTone } from '../lib/advice'
import type { AdviceFinding, UpdateAdvisory } from '../types'

const TONE = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)' } as const
const DOT: Record<AdviceFinding['severity'], string> = { critical: 'var(--danger)', warning: 'var(--warn)', info: 'var(--faint)' }

/** `analysed on <date> with <model>`: the date in the interface language. */
function useWhen(seconds: number): string {
  const lang = useLang()
  return new Date(seconds * 1000).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })
}

function Finding({ finding }: { finding: AdviceFinding }) {
  const t = useT()
  return (
    <Box component="li" sx={{ display: 'grid', gap: '2px', listStyle: 'none' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: 12, color: 'var(--ink)' }}>
        <Box component="span" aria-hidden sx={{ width: 6, height: 6, flexShrink: 0, borderRadius: '50%', backgroundColor: DOT[finding.severity], alignSelf: 'center' }} />
        {finding.title}
      </Box>
      {finding.quote && finding.quote !== finding.title && (
        <Box component="blockquote" sx={{ m: 0, ml: '12px', pl: '8px', borderLeft: '2px solid var(--line)', fontSize: 11.5, lineHeight: 1.4, color: 'var(--muted)' }}>
          « {finding.quote} »
        </Box>
      )}
      <Box sx={{ ml: '12px', fontSize: 11 }}>
        {finding.url ? (
          <Link href={finding.url} target="_blank" rel="noopener noreferrer" underline="hover">{t('updates.advice.source')}</Link>
        ) : (
          <Box component="span" sx={{ color: 'var(--faint)' }}>{t('updates.advice.known')}</Box>
        )}
      </Box>
    </Box>
  )
}

export interface AdviceBlockProps {
  advice: UpdateAdvisory
  /** Runs the analysis again (the advice is out of date, or the user wants a new one). */
  onRerun?: () => void
  onForget?: () => void
}

/**
 * An advice: the verdict as a quiet badge, the summary, the findings (each with the excerpt it rests on and its link), what could not be
 * read, when and with which model it was made, and the standing reminder that it is automatic and to be checked. It never blocks anything.
 */
export function AdviceBlock({ advice, onRerun, onForget }: AdviceBlockProps) {
  const t = useT()
  const when = useWhen(advice.created_at)
  const color = TONE[verdictTone(advice.verdict)]
  const findings = sortFindings(advice.findings)
  return (
    <Box role="group" aria-label={t('updates.advice.aria')} sx={{ mt: '6px', display: 'grid', gap: '6px', borderLeft: `2px solid ${color}`, pl: '10px' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px' }}>
        <Box component="span" sx={{ border: `1px solid ${color}`, borderRadius: '6px', px: '6px', fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5, color }}>
          {t(`updates.advice.badge.${advice.verdict}`)}
        </Box>
        <Box component="span" sx={{ fontSize: 10.5, color: 'var(--faint)' }}>{t('updates.advice.meta', [when, advice.llm_model_id])}</Box>
      </Box>
      <Box component="p" sx={{ m: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--ink-2)' }}>{advice.summary}</Box>
      {findings.length > 0 && (
        <Box component="details" sx={{ fontSize: 12 }}>
          <Box component="summary" sx={{ cursor: 'pointer', color: 'var(--muted)' }}>{t('updates.advice.findings', [findings.length])}</Box>
          <Box component="ul" sx={{ m: 0, mt: 1, p: 0, display: 'grid', gap: 1.25 }}>
            {findings.map((f, i) => <Finding key={`${i}-${f.quote}`} finding={f} />)}
          </Box>
        </Box>
      )}
      {advice.notes.length > 0 && <Box component="p" sx={{ m: 0, fontSize: 11, color: 'var(--faint)' }}>{t('updates.advice.notes', [advice.notes.join(' ')])}</Box>}
      {advice.stale === true && <Box role="status" sx={{ fontSize: 11, color: 'var(--warn)' }}>{t('updates.advice.stale')}</Box>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 12px', fontSize: 11, color: 'var(--faint)' }}>
        <span>{t('updates.advice.automatic')}</span>
        {onRerun && <Button size="small" variant="text" onClick={onRerun} sx={{ px: 0.5, fontSize: 11 }}>{t('updates.advice.rerun')}</Button>}
        {onForget && <Button size="small" variant="text" onClick={onForget} sx={{ px: 0.5, fontSize: 11, color: 'var(--faint)' }}>{t('updates.advice.forget')}</Button>}
      </Box>
    </Box>
  )
}
