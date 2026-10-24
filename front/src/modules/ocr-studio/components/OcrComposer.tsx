/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useRef, useState } from 'react'
import { Box, ButtonBase, CircularProgress, MenuItem, Select } from '@mui/material'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import AttachFileRounded from '@mui/icons-material/AttachFileRounded'
import CloseRounded from '@mui/icons-material/CloseRounded'
import { useNavigate } from 'react-router-dom'
import { SetupPrompt } from '@/modules/engines'
import { useActiveModel, useModels, type ModelInfo } from '@/modules/model-catalog'
import { StudioModelPicker } from '@/modules/studio-core'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { useCreateOcr } from '../hooks/useOcr'
import { ACCEPT_ATTRIBUTE, fileProblem, isPdf, sendState, taskAfterModelChange, tasksOf } from '../lib/ocrRules'
import type { OcrTask } from '../types'
import { OcrModelCard } from './OcrModelCard'

const sizeLabel = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

function DropZone({ file, onFile }: { file: File | null; onFile: (file: File | null) => void }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const problem = file ? fileProblem(file) : null
  const take = useCallback((files: FileList | null) => onFile(files?.[0] ?? null), [onFile])
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={t('ocrStudio.drop.aria')}
      onClick={() => input.current?.click()}
      onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && input.current?.click()}
      onDragOver={(event) => { event.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { event.preventDefault(); setOver(false); take(event.dataTransfer.files) }}
      onPaste={(event) => take(event.clipboardData.files)}
      sx={{ display: 'flex', minHeight: 120, cursor: 'pointer', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', borderRadius: '16px', border: '1.5px dashed', borderColor: over ? 'var(--safe)' : problem ? 'var(--danger)' : 'var(--line-strong)', backgroundColor: over ? 'var(--safe-soft)' : 'transparent', px: 2, py: 2.5, textAlign: 'center', transition: 'border-color 0.15s, background-color 0.15s', outline: 'none', '&:focus-visible': { borderColor: 'var(--safe)' } }}
    >
      <input ref={input} type="file" hidden accept={ACCEPT_ATTRIBUTE} onChange={(event) => { take(event.target.files); event.target.value = '' }} />
      {file ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, maxWidth: '100%' }}>
          <AttachFileRounded sx={{ fontSize: 18, color: 'var(--safe)' }} />
          <Box sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, color: 'var(--ink)' }}>{file.name}</Box>
          <Box sx={{ flexShrink: 0, fontSize: 12, color: 'var(--faint)' }}>{sizeLabel(file.size)}</Box>
          <ButtonBase aria-label={t('ocrStudio.drop.remove')} onClick={(event) => { event.stopPropagation(); onFile(null) }} sx={{ borderRadius: '8px', p: '2px', color: 'var(--muted)', '&:hover': { color: 'var(--ink)' } }}>
            <CloseRounded sx={{ fontSize: 16 }} />
          </ButtonBase>
        </Box>
      ) : (
        <>
          <Box sx={{ fontSize: 14.5, color: 'var(--ink)' }}>{t('ocrStudio.drop.title')}</Box>
          <Box sx={{ fontSize: 12, color: 'var(--faint)' }}>{t('ocrStudio.drop.hint')}</Box>
        </>
      )}
      {problem && <Box role="alert" sx={{ fontSize: 12.5, color: 'var(--danger)' }}>{t(problem)}</Box>}
    </Box>
  )
}

function Options({ model, task, onTask, prompt, onPrompt, pages, onPages, pdf }: { model: ModelInfo; task: OcrTask; onTask: (task: OcrTask) => void; prompt: string; onPrompt: (text: string) => void; pages: string; onPages: (text: string) => void; pdf: boolean }) {
  const t = useT()
  const field = { fontSize: 13.5, color: 'var(--ink)' } as const
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
        <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12.5, color: 'var(--muted)' }}>
          {t('ocrStudio.task.label')}
          <Select size="small" value={task} onChange={(event) => onTask(event.target.value as OcrTask)} aria-label={t('ocrStudio.task.label')} sx={{ minWidth: 190, ...field }}>
            {tasksOf(model).map((id) => (
              <MenuItem key={id} value={id}>{t(`ocrStudio.task.${id}`)}</MenuItem>
            ))}
          </Select>
        </Box>
        {pdf && (
          <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 12.5, color: 'var(--muted)' }}>
            {t('ocrStudio.pages.label')}
            <Box component="input" value={pages} placeholder={t('ocrStudio.pages.placeholder')} aria-label={t('ocrStudio.pages.label')} onChange={(event: React.ChangeEvent<HTMLInputElement>) => onPages(event.target.value)} sx={{ width: 150, borderRadius: '10px', border: '1px solid var(--line)', backgroundColor: 'transparent', px: 1.25, py: '7px', fontFamily: 'inherit', ...field, outline: 'none', '&:focus': { borderColor: 'var(--line-strong)' } }} />
          </Box>
        )}
      </Box>
      <Box sx={{ fontSize: 12, color: 'var(--faint)' }}>{t(`ocrStudio.task.${task}.hint`)}</Box>
      {task === 'custom' && (
        <Box component="textarea" rows={3} value={prompt} aria-label={t('ocrStudio.prompt.aria')} placeholder={t('ocrStudio.prompt.placeholder')} onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onPrompt(event.target.value)} sx={{ width: '100%', resize: 'vertical', borderRadius: '12px', border: '1px solid var(--line)', backgroundColor: 'transparent', p: 1.25, fontFamily: 'inherit', ...field, lineHeight: 1.5, outline: 'none', '&:focus': { borderColor: 'var(--line-strong)' } }} />
      )}
    </Box>
  )
}

function ComposerCard({ model }: { model: ModelInfo }) {
  const t = useT()
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [task, setTask] = useState<OcrTask>(() => taskAfterModelChange(model, 'default'))
  const [prompt, setPrompt] = useState('')
  const [pages, setPages] = useState('')
  const [percent, setPercent] = useState<number | null>(null)
  const create = useCreateOcr((doc) => navigate(studioPaths.ocrDocument(doc.id)), setPercent)
  const effectiveTask = tasksOf(model).includes(task) ? task : taskAfterModelChange(model, task)
  const state = sendState(model, file, effectiveTask, prompt, create.isPending)
  const submit = () => {
    if (!state.canSend || !file) return
    create.mutate({ file, modelId: model.id, task: effectiveTask === 'default' ? undefined : effectiveTask, prompt: effectiveTask === 'custom' ? prompt : undefined, pages: isPdf(file.name) ? pages : undefined })
  }
  return (
    <Box sx={{ display: 'grid', gap: 1.75 }}>
      <Box sx={{ display: 'grid', gap: 1.75, borderRadius: '22px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', p: 2, boxShadow: '0 30px 80px -30px var(--safe-glow)' }}>
        <DropZone file={file} onFile={setFile} />
        <Options model={model} task={effectiveTask} onTask={setTask} prompt={prompt} onPrompt={setPrompt} pages={pages} onPages={setPages} pdf={file ? isPdf(file.name) : false} />
        {model.compatible && !model.ready && <SetupPrompt model={model} />}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
          <StudioModelPicker model={model} onSelect={(next) => setTask((current) => taskAfterModelChange(next, current))} />
          <Box sx={{ flex: 1 }} />
          {create.isPending && percent !== null && <Box sx={{ fontSize: 12, color: 'var(--faint)' }}>{percent} %</Box>}
          <ButtonBase onClick={submit} disabled={!state.canSend} aria-label={t('ocrStudio.send.aria')} title={t(state.tipKey)} sx={{ display: 'flex', height: 36, alignItems: 'center', gap: '6px', borderRadius: '12px', px: 1.75, fontSize: 13.5, transition: 'all 0.15s', backgroundColor: state.canSend ? 'var(--safe)' : 'var(--surface-3)', color: state.canSend ? 'var(--safe-ink)' : 'var(--faint)', boxShadow: state.canSend ? '0 0 24px -4px var(--safe-glow)' : 'none', '&:hover': state.canSend ? { filter: 'brightness(1.1)' } : {} }}>
            {create.isPending ? <CircularProgress size={16} color="inherit" /> : <ArrowUpwardRounded sx={{ fontSize: 18 }} />}
            {t('ocrStudio.send.label')}
          </ButtonBase>
        </Box>
      </Box>
      <OcrModelCard model={model} />
    </Box>
  )
}

/** The OCR composer: a file (image or PDF), the model with its card, the task, the pages of a PDF, and the button that starts the reading. */
export function OcrComposer() {
  const t = useT()
  const model = useActiveModel('ocr')
  const { isError } = useModels()
  if (!model) {
    return (
      <Box sx={{ display: 'flex', height: 112, alignItems: 'center', justifyContent: 'center', borderRadius: '24px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', fontSize: 14, color: 'var(--muted)' }}>
        {isError ? t('ocrStudio.composer.unreachable') : <CircularProgress size={18} color="inherit" />}
      </Box>
    )
  }
  return <ComposerCard model={model} />
}
