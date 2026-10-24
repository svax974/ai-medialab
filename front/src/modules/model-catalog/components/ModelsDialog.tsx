/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Tab, Tabs } from '@mui/material'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { MachineCard, StoragePaths, useSystemInfo } from '@/modules/hardware'
import { HfTokenField } from '@/modules/settings'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useStudioStore } from '@/modules/studio-shell/state/studioStore'
import { splitModels } from '../lib/catalogFormat'
import { modelKindOfMode } from '../lib/modelKind'
import { useModels } from '../hooks/useModelCatalog'
import { useModelSelectionStore } from '../state/modelSelectionStore'
import type { ModelInfo, ModelKind } from '../types'
import { HubSearch } from './HubSearch'
import { ModelCard } from './ModelCard'

const KINDS: ModelKind[] = ['image', 'audio', 'video', 'llm', 'diagram', 'ocr']
const HOME_PATH: Record<ModelKind, string> = {
  image: studioPaths.home, audio: studioPaths.audioHome, video: studioPaths.videoHome, llm: studioPaths.chatHome,
  diagram: studioPaths.diagramHome, ocr: studioPaths.ocrHome,
}

interface ModelsDialogProps {
  open: boolean
  onClose: () => void
  /** Installs the engine of a model, then the model (module `engines`). */
  onSetup: (model: ModelInfo) => void
  /** The engines (image) or packs (audio, video) card shown above the models of a kind (module `engines`). */
  renderEngines?: (kind: ModelKind, models: ModelInfo[]) => ReactNode
}

function KindTabs({ value, onChange }: { value: ModelKind; onChange: (kind: ModelKind) => void }) {
  const t = useT()
  return (
    <Tabs value={value} onChange={(_event, kind: ModelKind) => onChange(kind)} variant="fullWidth" aria-label={t('models.title')}>
      {KINDS.map((kind) => (
        <Tab key={kind} value={kind} label={t(`models.tabs.${kind}`)} />
      ))}
    </Tabs>
  )
}

function Cards({ models, onSetup, onUse, system }: { models: ModelInfo[]; onSetup: ModelsDialogProps['onSetup']; onUse: (m: ModelInfo) => void; system: ReturnType<typeof useSystemInfo>['data'] }) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {models.map((m) => (
        <ModelCard key={m.id} model={m} system={system} onSetup={onSetup} onUse={onUse} />
      ))}
    </Box>
  )
}

/** Dialog "Models": machine, engines, the catalogue of the current kind, Hugging Face search, token and storage paths. */
export function ModelsDialog({ open, onClose, onSetup, renderEngines }: ModelsDialogProps) {
  const t = useT()
  const navigate = useNavigate()
  const mode = useStudioStore((s) => s.mode)
  const searchKind = useStudioStore((s) => s.modelsSearchKind)
  const select = useModelSelectionStore((s) => s.select)
  const [tab, setTab] = useState<ModelKind>(modelKindOfMode(mode))
  const searchRef = useRef<HTMLInputElement>(null)
  const catalog = useModels({ enabled: open })
  const { data: system } = useSystemInfo({ enabled: open, pollMs: open ? 8_000 : false })

  useEffect(() => {
    if (open) setTab(useStudioStore.getState().modelsSearchKind ?? modelKindOfMode(mode))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from "search a model": bring the Hugging Face search into view.
  useEffect(() => {
    if (!open || !searchKind) return undefined
    const timer = setTimeout(() => {
      searchRef.current?.scrollIntoView({ block: 'center' })
      searchRef.current?.focus()
      useStudioStore.getState().clearModelSearch()
    }, 120)
    return () => clearTimeout(timer)
  }, [open, searchKind])

  const use = (model: ModelInfo) => {
    select(model.kind, model.id)
    void navigate(HOME_PATH[model.kind])
    onClose()
  }
  const all = catalog.data?.models ?? []
  const { generators, speech } = splitModels(all, tab)
  return (
    <Dialog open={open} onClose={onClose} fullWidth aria-labelledby="models-title" slotProps={{ paper: { sx: { maxWidth: 760 } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 3 }}>
        <DialogTitle id="models-title">{t('models.title')}</DialogTitle>
        <TipIconButton labelId="models.close" onClick={onClose} sx={{ borderRadius: '8px' }}>
          <CloseRounded sx={{ fontSize: 16 }} />
        </TipIconButton>
      </Box>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 2.5 }}>
          <MachineCard />
          <KindTabs value={tab} onChange={setTab} />
          {renderEngines?.(tab, all)}
          {catalog.isPending && (
            <Box role="status" sx={{ display: 'grid', placeItems: 'center', height: 96, color: 'var(--muted)' }}>
              <CircularProgress size={18} aria-label={t('models.loading')} />
            </Box>
          )}
          {catalog.isError && (
            <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 13, color: 'var(--danger)' }}>
              {t('models.error')}
              <Button size="small" variant="text" onClick={() => void catalog.refetch()}>
                {t('models.retry')}
              </Button>
            </Box>
          )}
          {catalog.data && generators.length === 0 && speech.length === 0 && (
            <Box component="p" sx={{ m: 0, fontSize: 13, color: 'var(--muted)' }}>
              {t('models.empty')}
            </Box>
          )}
          <Cards models={generators} onSetup={onSetup} onUse={use} system={system} />
          {speech.length > 0 && (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <Box>
                <Box className="cn-eyebrow">{t('models.transcription.title')}</Box>
                <Box component="p" sx={{ m: 0, mt: '4px', fontSize: 12, lineHeight: 1.4, color: 'var(--faint)' }}>
                  {t('models.transcription.description')}
                </Box>
              </Box>
              <Cards models={speech} onSetup={onSetup} onUse={use} system={system} />
            </Box>
          )}
          <HubSearch ref={searchRef} kind={tab} />
          <HfTokenField />
          {system && <StoragePaths system={system} />}
        </Box>
      </DialogContent>
    </Dialog>
  )
}
