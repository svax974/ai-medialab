/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { forwardRef, useEffect, useState } from 'react'
import { Box, Button, CircularProgress, InputAdornment, TextField } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import DownloadRounded from '@mui/icons-material/DownloadRounded'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import SearchRounded from '@mui/icons-material/SearchRounded'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'
import { formatGb } from '@/modules/hardware'
import { useLang, useT } from '@/modules/studio-shell/hooks/useT'
import { chosenOption, compactCount, HUB_HELP_KEY, HUB_PLACEHOLDER_KEY, HUB_TASK_KEY, isAddBlocked, optionDoesNotFit, optionDownloadGb, sharedDownloadGb } from '../lib/hubSearch'
import { useAddCustomModel, useDebouncedQuery, useHubInspect, useHubSearch } from '../hooks/useHubSearch'
import type { HubOption, HubResult, ModelKind } from '../types'
import { Notice, Section, Tag } from './panels'

function OptionPicker({ options, chosenKey, onPick }: { options: HubOption[]; chosenKey: string; onPick: (key: string) => void }) {
  const t = useT()
  const lang = useLang()
  return (
    <Box>
      <Box sx={{ mb: '6px', fontSize: 11.5, color: 'var(--muted)' }}>{t('models.hub.quantization')}</Box>
      <Box role="group" aria-label={t('models.hub.quantization')} sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {options.map((o) => (
          <Box
            component="button"
            type="button"
            key={o.key}
            aria-pressed={o.key === chosenKey}
            onClick={() => onPick(o.key)}
            title={o.fit_note || undefined}
            sx={{
              border: 0,
              cursor: 'pointer',
              px: 1,
              py: '4px',
              borderRadius: '6px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 11,
              color: o.key === chosenKey ? 'var(--ink)' : 'var(--muted)',
              backgroundColor: o.key === chosenKey ? 'var(--safe-soft)' : 'var(--surface)',
              boxShadow: o.key === chosenKey ? 'inset 0 0 0 1px color-mix(in oklab, var(--safe) 50%, transparent)' : 'inset 0 0 0 1px var(--line)',
              opacity: optionDoesNotFit(o) ? 0.6 : 1,
              textDecoration: optionDoesNotFit(o) ? 'line-through' : 'none',
              textDecorationColor: 'color-mix(in oklab, var(--warn) 60%, transparent)',
              '&:hover': { color: 'var(--ink)' },
            }}
          >
            {o.label}{' '}
            <Box component="span" sx={{ color: 'var(--faint)' }}>
              {t('models.size.gb', [formatGb(optionDownloadGb(o), lang)])}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** Detail of an opened result: quantizations, licence, notes, memory remarks and the "add and download" button (also used by "What's new"). */
export function Detail({ result: r }: { result: Pick<HubResult, 'repo' | 'already'> }) {
  const t = useT()
  const lang = useLang()
  const { data, error, isLoading } = useHubInspect(r.repo)
  const [pick, setPick] = useState<string | null>(null)
  const add = useAddCustomModel(r.repo)
  const options = data?.options ?? []
  const chosen = chosenOption(options, pick)
  const blocked = isAddBlocked(data, chosen)
  return (
    <Box sx={{ display: 'grid', gap: 1.25, borderTop: '1px solid var(--line)', px: 1.5, pb: 1.5, pt: 1.25 }}>
      {isLoading && (
        <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12.5, color: 'var(--muted)' }}>
          <CircularProgress size={14} /> {t('models.hub.reading')}
        </Box>
      )}
      {error && <Notice tone="warn">{(error as Error).message}</Notice>}
      {data && chosen && (
        <>
          {options.length > 1 && <OptionPicker options={options} chosenKey={chosen.key} onPick={setPick} />}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--faint)' }}>
            <span>
              {t('models.hub.precision')} <Box component="b" sx={{ fontWeight: 400, color: 'var(--ink-2)' }}>{chosen.precision || '?'}</Box>
            </span>
            <span>
              {t('models.hub.toDownload', [formatGb(optionDownloadGb(chosen), lang)])}
              {data.template && (sharedDownloadGb(chosen) > 0
                ? t('models.hub.withShared', [formatGb(chosen.size_gb, lang), formatGb(sharedDownloadGb(chosen), lang), data.template.name])
                : t('models.hub.sharedPresent', [data.template.name]))}
            </span>
            <span>
              {t('models.hub.license')} <Box component="b" sx={{ fontWeight: 400, color: 'var(--ink-2)' }}>{data.license || t('models.hub.seeRepo')}</Box>
            </span>
          </Box>
          {data.notes.map((note) => (
            <Box key={note} component="p" sx={{ m: 0, fontSize: 12, lineHeight: 1.4, color: 'var(--faint)' }}>
              {note}
            </Box>
          ))}
          {data.compatible && chosen.fit_note && (
            <Notice tone={chosen.fits === false ? 'warn' : 'neutral'} icon={<WarningAmberRounded sx={{ fontSize: 14 }} />} sx={{ fontSize: 12 }}>
              {chosen.fit_note}
            </Notice>
          )}
          {!data.compatible && (
            <Notice tone="warn" icon={<WarningAmberRounded sx={{ fontSize: 14 }} />} sx={{ fontSize: 12 }}>
              {data.reason || t('models.hub.cannotRun')}
            </Notice>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {r.already ? (
              <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 12.5, color: 'var(--ok)' }}>
                <CheckRounded sx={{ fontSize: 14 }} /> {t('models.hub.already')}
              </Box>
            ) : (
              <Button variant="contained" disabled={add.isPending || blocked} onClick={() => add.mutate(chosen.key)} startIcon={add.isPending ? <CircularProgress size={14} /> : <DownloadRounded />}>
                {t('models.hub.addAndDownload')}
              </Button>
            )}
            <Box component="a" href={`https://huggingface.co/${r.repo}`} target="_blank" rel="noreferrer" sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: '4px', fontSize: 12, color: 'var(--muted)', textDecoration: 'none', '&:hover': { color: 'var(--ink)' } }}>
              <OpenInNewRounded sx={{ fontSize: 14 }} /> {t('models.hub.openLink')}
            </Box>
          </Box>
        </>
      )}
    </Box>
  )
}

/** Quantizations listed on a collapsed result; the others are in the tooltip and in the detail. */
const MAX_PRECISIONS = 5

function ResultRow({ result: r, open, onToggle }: { result: HubResult; open: boolean; onToggle: () => void }) {
  const t = useT()
  const lang = useLang()
  return (
    <Box sx={{ borderRadius: '12px', border: '1px solid', borderColor: open ? 'var(--line-strong)' : 'var(--line)', backgroundColor: 'color-mix(in oklab, var(--surface) 60%, transparent)', opacity: r.compatible ? 1 : 0.75 }}>
      <Box component="button" type="button" aria-expanded={open} onClick={onToggle} sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: '10px', px: 1.5, py: 1, border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
        <ChevronRightRounded sx={{ fontSize: 16, color: 'var(--faint)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.repo}</Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 6px', fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: 'var(--faint)' }}>
            <Tag>{r.family_label}</Tag>
            {r.precisions.length > 0 && (
              <Box component="span" title={t('models.hub.quantizations', [r.precisions.join(', ')])} sx={{ color: 'var(--ink-2)' }}>
                {r.precisions.slice(0, MAX_PRECISIONS).join(' · ')}
                {r.precisions.length > MAX_PRECISIONS && ` +${r.precisions.length - MAX_PRECISIONS}`}
              </Box>
            )}
            <span>· {t(HUB_TASK_KEY[r.task])}</span>
            <span>· {t('models.hub.downloads', [compactCount(r.downloads, lang)])}</span>
            {r.already && <Box component="span" sx={{ color: 'var(--ok)' }}>· {t('models.hub.alreadyListed')}</Box>}
            {!r.compatible && <Box component="span" sx={{ color: 'var(--warn)' }}>· {t('models.hub.incompatible')}</Box>}
          </Box>
        </Box>
      </Box>
      {open && <Detail result={r} />}
    </Box>
  )
}

/** Hugging Face search, limited to formats the app can run. The input is focusable from the outside (`ref`). */
export const HubSearch = forwardRef<HTMLInputElement, { kind: ModelKind }>(function HubSearch({ kind }, inputRef) {
  const t = useT()
  const { text, setText, query } = useDebouncedQuery()
  const [opened, setOpened] = useState<string | null>(null)
  useEffect(() => setOpened(null), [kind, query])
  const search = useHubSearch(kind, query)
  return (
    <Section title={t('models.hub.title')} hint={`${t(HUB_HELP_KEY[kind])} ${t('models.hub.onlyCompatible')}`}>
      <TextField
        fullWidth
        size="small"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t(HUB_PLACEHOLDER_KEY[kind])}
        inputRef={inputRef}
        slotProps={{
          htmlInput: { 'aria-label': t('models.hub.title') },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRounded sx={{ fontSize: 16 }} />
              </InputAdornment>
            ),
            endAdornment: search.isFetching ? <CircularProgress size={14} /> : undefined,
          },
        }}
      />
      <Box sx={{ mt: 1.5, display: 'grid', gap: '6px' }}>
        {search.isError && (
          <Notice framed tone="danger">
            {(search.error as Error).message}
          </Notice>
        )}
        {search.data?.length === 0 && (
          <Box component="p" sx={{ m: 0, py: 1, fontSize: 12.5, color: 'var(--muted)' }}>
            {t('models.hub.empty')}
          </Box>
        )}
        {search.data?.map((r) => (
          <ResultRow key={r.repo} result={r} open={opened === r.repo} onToggle={() => setOpened(opened === r.repo ? null : r.repo)} />
        ))}
      </Box>
    </Section>
  )
})
