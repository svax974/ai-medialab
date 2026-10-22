/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState, type MouseEvent } from 'react'
import { Box, Menu, MenuItem } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import MemoryOutlined from '@mui/icons-material/MemoryOutlined'
import SearchRounded from '@mui/icons-material/SearchRounded'
import TuneRounded from '@mui/icons-material/TuneRounded'
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined'
import { useEngineStatus } from '@/modules/hardware'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import { pickerBackendKey, pickerModels, pickerSize, remainingGb } from '../lib/catalogFormat'
import { MODEL_HELP } from '../lib/modelHelp'
import { useModels } from '../hooks/useModelCatalog'
import { useModelSelectionStore } from '../state/modelSelectionStore'
import type { ModelInfo } from '../types'
import { GatedNotice, HelpTag, LicenseWarning, LlmBadges, VideoBadges } from './ModelBadges'
import { useSizeLabel } from '../hooks/useSizeLabel'
import { TempDownloadNote } from './TempDownloadNote'
import { Tag } from './panels'

/** What the picker row says about what is missing: the engine to install, the model to download (what is left of it), or too heavy. */
function MissingBadges({ model: m }: { model: ModelInfo }) {
  const t = useT()
  // What is left to download: a LoRA whose SDXL base is already there only needs its own small file.
  const need = remainingGb(m)
  const size = pickerSize(need)
  const sizeText = need > 0 ? ` · ~${t(size.unit === 'mb' ? 'models.size.mb' : 'models.size.gb', [String(size.value)])}` : ''
  return (
    <Box sx={{ mt: '6px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
      {m.needs_engine_install && (
        <Tag tone="warn" title={m.engine_detail}>
          <CloudDownloadOutlined sx={{ fontSize: 12 }} />
          {t('models.picker.engineToInstall', [(m.engine_name ?? '').replace(/\s*\(.*\)/, '')])}
          {m.engine_install_size_mb ? ` · ${t('models.engine.mb', [m.engine_install_size_mb])}` : ''}
        </Tag>
      )}
      {m.install !== 'installed' && m.compatible && (
        <Tag tone="warn">
          <CloudDownloadOutlined sx={{ fontSize: 12 }} />
          {t(m.install === 'partial' ? 'models.picker.complete' : 'models.picker.download')}
          {sizeText}
        </Tag>
      )}
      {!m.compatible && <Tag tone="danger">{t('models.picker.tooHeavy')}</Tag>}
    </Box>
  )
}

function PickerRow({ model: m, active, loaded }: { model: ModelInfo; active: boolean; loaded: boolean }) {
  const t = useT()
  const sizeLabel = useSizeLabel()
  const size = sizeLabel(m.download_size_gb)
  return (
    <>
      <Box sx={{ mt: '2px', display: 'grid', width: 16, height: 16, flexShrink: 0, placeItems: 'center' }}>{active && <CheckRounded sx={{ fontSize: 16, color: 'var(--safe)' }} />}</Box>
      <Box sx={{ minWidth: 0, flex: 1, whiteSpace: 'normal' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          <Box component="span" sx={{ fontWeight: 500, color: 'var(--ink)' }}>{m.name}</Box>
          <Tag size="sm">{t(pickerBackendKey(m))}</Tag>
          {m.precision && <HelpTag help={MODEL_HELP.quantize}>{m.precision}</HelpTag>}
          {size && <Tag size="sm" tone="strong" title={t('models.size.title')}>{size}</Tag>}
          {loaded && <Tag tone="ok" pill>{t('models.loaded')}</Tag>}
        </Box>
        {/* Everything below the title is indented, so each model's name stands out in the list. */}
        <Box sx={{ pl: 1.5 }}>
          <Box component="p" sx={{ m: 0, mt: '2px', fontSize: 12.5, lineHeight: 1.4, color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.description}</Box>
          {m.kind === 'video' && <Box sx={{ mt: '4px' }}><VideoBadges model={m} /></Box>}
          {m.kind === 'llm' && <Box sx={{ mt: '4px' }}><LlmBadges model={m} /></Box>}
          {m.kind === 'video' && <Box sx={{ mt: '6px' }}><LicenseWarning model={m} compact /></Box>}
          <Box sx={{ mt: '6px' }}><GatedNotice model={m} compact /></Box>
          {m.tags.length > 0 && (
            <Box sx={{ mt: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {m.tags.map((tag) => <Tag key={tag} size="sm">{tag}</Tag>)}
            </Box>
          )}
          <MissingBadges model={m} />
          <TempDownloadNote model={m} compact />
          {m.needs_engine_install && m.engine_detail && (
            <Box component="p" sx={{ m: 0, mt: '4px', fontSize: 11.5, lineHeight: 1.4, color: 'var(--faint)' }}>
              <Box component="b" sx={{ fontWeight: 500, color: 'var(--muted)' }}>{m.engine_name}</Box> : {m.engine_detail}
            </Box>
          )}
        </Box>
      </Box>
    </>
  )
}

interface ModelPickerProps {
  model: ModelInfo
  /** Finished generations per model id (`useModelUsage`): the most used are listed first. */
  usage?: Record<string, number>
  onSelect?: (model: ModelInfo) => void
}

/**
 * Model selector of a composer: the local models of the kind (most used first, then the other installed ones, then the
 * rest, with what is missing for them; those too heavy for this machine behind a "show" link), then "search a model" and
 * "manage models". Choosing a model stores it as the one the composer of this kind uses.
 */
export function ModelPicker({ model, usage, onSelect }: ModelPickerProps) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [showUnfit, setShowUnfit] = useState(false)
  const { data } = useModels()
  const { data: status } = useEngineStatus()
  const select = useModelSelectionStore((s) => s.select)
  const setModelsOpen = useStudioStore((s) => s.setModelsOpen)
  const openModelSearch = useStudioStore((s) => s.openModelSearch)
  const list = pickerModels(data?.models ?? [], model.kind, { usage, showUnfit, keep: model.id })
  const close = () => setAnchor(null)
  const choose = (m: ModelInfo) => {
    select(m.kind, m.id)
    onSelect?.(m)
    close()
  }
  return (
    <>
      <Box
        component="button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
        sx={{ display: 'flex', height: 32, maxWidth: 240, alignItems: 'center', gap: '6px', px: 1.25, borderRadius: '8px', border: '1px solid', borderColor: anchor ? 'var(--line-strong)' : 'var(--line)', backgroundColor: 'var(--surface-2)', color: anchor ? 'var(--ink)' : 'var(--ink-2)', fontSize: 13, cursor: 'pointer', '&:hover': { borderColor: 'var(--line-strong)', color: 'var(--ink)' } }}
      >
        <MemoryOutlined sx={{ fontSize: 14, flexShrink: 0, color: 'var(--safe)' }} />
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.name}</Box>
        <Box component="span" sx={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, monospace)', fontSize: 10, color: 'var(--faint)' }}>
          {t(pickerBackendKey(model))}
          {model.precision ? ` · ${model.precision}` : ''}
        </Box>
        <ExpandMoreRounded sx={{ fontSize: 14, flexShrink: 0, opacity: 0.6 }} />
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { width: 'min(580px, calc(100vw - 24px))' } } }}>
        <Box className="cn-eyebrow" sx={{ px: 1.25, pb: '4px', pt: '6px' }}>{t('models.picker.title')}</Box>
        {list.models.map((m) => (
          <MenuItem key={m.id} onClick={() => choose(m)} selected={m.id === model.id} sx={{ alignItems: 'flex-start', gap: 1.25, py: 1.25, opacity: m.compatible ? 1 : 0.6, whiteSpace: 'normal' }}>
            <PickerRow model={m} active={m.id === model.id} loaded={status?.model_id === m.id} />
          </MenuItem>
        ))}
        {(list.hidden > 0 || showUnfit) && (
          <MenuItem onClick={() => setShowUnfit(!showUnfit)} sx={{ gap: 1.25, fontSize: 13, color: 'var(--muted)' }}>
            {showUnfit ? <VisibilityOffOutlined sx={{ fontSize: 16 }} /> : <VisibilityOutlined sx={{ fontSize: 16 }} />}
            {showUnfit ? t('models.picker.hideUnfit') : t('models.picker.showUnfit', [list.hidden])}
          </MenuItem>
        )}
        <Box sx={{ my: '4px', height: '1px', backgroundColor: 'var(--line)' }} />
        <MenuItem onClick={() => { close(); openModelSearch(model.kind) }} sx={{ gap: 1.25 }}>
          <SearchRounded sx={{ fontSize: 16 }} /> {t('models.picker.search')}
        </MenuItem>
        <MenuItem onClick={() => { close(); setModelsOpen(true) }} sx={{ gap: 1.25 }}>
          <TuneRounded sx={{ fontSize: 16 }} /> {t('models.picker.manage')}
        </MenuItem>
      </Menu>
    </>
  )
}
