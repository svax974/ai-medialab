/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, ButtonBase, CircularProgress } from '@mui/material'
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded'
import PaletteOutlined from '@mui/icons-material/PaletteOutlined'
import StopRounded from '@mui/icons-material/StopRounded'
import TravelExploreOutlined from '@mui/icons-material/TravelExploreOutlined'
import { confirm } from '@/modules_shared/common/components/ui/confirm'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { isPrivateMode } from '@/modules/private/state/privateStore'
import { SetupPrompt } from '@/modules/engines'
import { useEngineStatus } from '@/modules/hardware'
import { GatedNotice, useModels, useWelcomeModel } from '@/modules/model-catalog'
import { useSettings } from '@/modules/settings'
import { assetToFile, AttachButton, LabelTooltip, StudioModelPicker } from '@/modules/studio-core'
import { registerFocusTarget } from '@/modules/studio-shell/lib/focusRegistry'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { contextUsage, requestedContext } from '../lib/context'
import { commandsFor } from '../lib/creation'
import { estimateTokens } from '../lib/estimate'
import { useAttachments } from '../hooks/useAttachments'
import { useChatConversation, useChatModel, useChatSettings } from '../hooks/useChat'
import { useChatSubmit } from '../hooks/useChatSubmit'
import { stopAnswer } from '../services/answerRunner'
import { HOME_DRAFT, useChatDraftStore } from '../state/chatDraftStore'
import { anyStreaming, useChatLiveStore } from '../state/chatLiveStore'
import { ChatSettingsPopover } from './ChatSettingsPopover'
import { ContextGauge } from './ContextGauge'
import { AttachmentList } from './MessageParts'
import { SystemPromptPopover } from './SystemPromptPopover'

function SendButton({ mode, enabled, onSend, onStop }: { mode: 'send' | 'sending' | 'stop'; enabled: boolean; onSend: () => void; onStop: () => void }) {
  const t = useT()
  const stop = mode === 'stop'
  return (
    <LabelTooltip label={t(stop ? 'chat.action.stop' : enabled ? 'chat.send.tip' : 'chat.send.disabled')} kbd={stop ? undefined : '↵'}>
      <ButtonBase onClick={stop ? onStop : onSend} disabled={!stop && !enabled} aria-label={t(stop ? 'chat.action.stop' : 'chat.send.aria')} sx={{ display: 'grid', width: 36, height: 36, placeItems: 'center', borderRadius: '12px', transition: 'all 0.15s', backgroundColor: stop ? 'var(--danger)' : enabled ? 'var(--safe)' : 'var(--surface-3)', color: stop ? 'var(--bg)' : enabled ? 'var(--safe-ink)' : 'var(--faint)', boxShadow: enabled && !stop ? '0 0 24px -4px var(--safe-glow)' : 'none', '&:hover': enabled || stop ? { filter: 'brightness(1.1)' } : {} }}>
        {mode === 'sending' ? <CircularProgress size={16} color="inherit" /> : stop ? <StopRounded sx={{ fontSize: 18 }} /> : <ArrowUpwardRounded sx={{ fontSize: 18 }} />}
      </ButtonBase>
    </LabelTooltip>
  )
}

function WebToggle({ active, available, brave, onToggle }: { active: boolean; available: boolean; brave: boolean; onToggle: () => void }) {
  return (
    <TipIconButton labelId={available ? 'chat.web.tip' : 'chat.web.unavailable'} hintId={brave ? 'chat.web.hint.brave' : 'chat.web.hint.ddg'} tone="default" active={active && available} disabled={!available} onClick={onToggle}>
      <TravelExploreOutlined sx={{ fontSize: 16 }} />
    </TipIconButton>
  )
}

function CreationToggle({ active, available, onToggle }: { active: boolean; available: boolean; onToggle: () => void }) {
  return (
    <TipIconButton labelId={available ? 'chat.creation.tip' : 'chat.creation.unavailable'} hintId="chat.creation.hint" tone="default" active={active && available} disabled={!available} onClick={onToggle}>
      <PaletteOutlined sx={{ fontSize: 16 }} />
    </TipIconButton>
  )
}

/** The commands that start with what the draft says after its slash: a click writes the command into the draft. */
function CommandHints({ draft, onPick }: { draft: string; onPick: (command: string) => void }) {
  const t = useT()
  const commands = commandsFor(draft)
  if (commands.length === 0) return null
  return (
    <Box role="group" aria-label={t('chat.command.aria')} sx={{ display: 'grid', gap: '2px', px: 1.25, pb: '6px' }}>
      {commands.map((name) => (
        <ButtonBase key={name} onClick={() => onPick(`/${name} `)} sx={{ justifyContent: 'flex-start', borderRadius: '8px', px: 1, py: '4px', fontSize: 12, color: 'var(--muted)', textAlign: 'left', '&:hover': { backgroundColor: 'var(--surface-2)', color: 'var(--ink)' } }}>{t(`chat.command.${name}`)}</ButtonBase>
      ))}
    </Box>
  )
}

/**
 * Turns the web search on or off. In a private session turning it ON asks first: its queries (what the model decides to
 * search for) leave the machine, the one thing a private session does not keep inside it.
 */
async function toggleWeb(current: boolean, apply: (web: boolean) => void): Promise<void> {
  if (!current && isPrivateMode()) {
    const ok = await confirm({ titleId: 'chat.web.private.title', messageId: 'chat.web.private.message', confirmLabelId: 'chat.web.private.confirm' })
    if (!ok) return
  }
  apply(!current)
}

/**
 * The composer of the chat, in the shape of the other studios' (the text, the toolbar, send): attachments (a button, paste,
 * or drop on the composer), the model with what it can do, the system prompt, the settings, web search (only for a model that
 * has tools: the tooltip says the queries leave the machine), the context gauge, and send / stop. `conversationId` null: the
 * home page, whose settings are the defaults of new conversations.
 */
export function ChatComposer({ conversationId, hero = false }: { conversationId: string | null; hero?: boolean }) {
  const t = useT()
  const key = conversationId ?? HOME_DRAFT
  const { settings, update } = useChatSettings(conversationId)
  const model = useChatModel(settings)
  const { isError } = useModels()
  const { data: app } = useSettings()
  const { data: conversation } = useChatConversation(conversationId)
  const { data: engine } = useEngineStatus()
  const text = useChatDraftStore((s) => s.texts[key] ?? '')
  const setText = useChatDraftStore((s) => s.setText)
  const status = useChatLiveStore((s) => s.status)
  const own = useChatLiveStore((s) => (conversationId ? s.streams[conversationId] : undefined))
  const busy = useChatLiveStore(anyStreaming)
  const { attached, uploading, add, remove } = useAttachments(key, !!model?.llm?.vision)
  const { submit, creating } = useChatSubmit(conversationId, settings, model)
  const welcomeShown = !!useWelcomeModel('llm')
  const textarea = useRef<HTMLTextAreaElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    registerFocusTarget('composer', textarea.current)
    return () => registerFocusTarget('composer', null)
  }, [])
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
  }, [text])

  if (!model || !settings) {
    return (
      <Box sx={{ display: 'flex', height: 112, alignItems: 'center', justifyContent: 'center', borderRadius: '24px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', fontSize: 14, color: 'var(--muted)' }}>
        {isError ? t('chat.composer.unreachable') : <CircularProgress size={18} color="inherit" />}
      </Box>
    )
  }
  // One model in memory: while an image, audio or video generation runs (or waits), the chat model waits too.
  const mediaBusy = engine?.state === 'busy' || (engine?.queue.length ?? 0) > 0
  const draftTokens = estimateTokens(text)
  const limit = status?.model_id === model.id && status.context_size ? status.context_size : requestedContext(settings, model)
  const usage = contextUsage(conversation?.messages ?? [], limit, draftTokens)
  const canSend = (text.trim() !== '' || attached.length > 0) && !!model.ready && !busy && uploading === 0 && !creating
  const send = () => {
    if (canSend) void submit(text, attached)
  }
  const files = (list: FileList | null) => list && list.length > 0 && void add(Array.from(list))
  const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes('Files')
  return (
    <Box
      onDragOver={(event) => { if (hasFiles(event)) { event.preventDefault(); setDragging(true) } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { if (hasFiles(event)) { event.preventDefault(); setDragging(false); files(event.dataTransfer.files) } }}
      sx={{ position: 'relative', borderRadius: '22px', border: '1px solid', borderColor: dragging ? 'var(--safe)' : 'var(--line)', backgroundColor: 'var(--surface)', transition: 'border-color 0.15s', '&:focus-within': { borderColor: dragging ? 'var(--safe)' : 'var(--line-strong)' }, ...(hero ? { boxShadow: '0 30px 80px -30px var(--safe-glow)' } : {}) }}
    >
      {(attached.length > 0 || uploading > 0) && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1.25, overflowX: 'auto', px: 1.75, pt: 1.75, pb: '6px' }}>
          <AttachmentList attachments={attached} onRemove={remove} />
          {uploading > 0 && <CircularProgress size={18} color="inherit" aria-label={t('chat.attach.uploading')} />}
        </Box>
      )}
      <Box
        component="textarea"
        ref={textarea}
        value={text}
        rows={hero ? 3 : 1}
        aria-label={t('chat.composer.aria')}
        placeholder={t(conversationId ? 'chat.composer.placeholder' : 'chat.composer.placeholderHome')}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setText(key, event.target.value)}
        onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            send()
          }
        }}
        onPaste={(event: React.ClipboardEvent<HTMLTextAreaElement>) => {
          if (event.clipboardData.files.length > 0) {
            event.preventDefault()
            files(event.clipboardData.files)
          }
        }}
        sx={{ display: 'block', width: '100%', resize: 'none', border: 0, background: 'transparent', px: 2.25, pb: 1, pt: 2, fontFamily: 'inherit', fontSize: 15.5, lineHeight: 1.6, color: 'var(--ink)', outline: 'none', '&::placeholder': { color: 'var(--faint)' } }}
      />
      {settings.tools.creation && !isPrivateMode() && <CommandHints draft={text} onPick={(command) => { setText(key, command); textarea.current?.focus() }} />}
      {mediaBusy && <Box role="status" sx={{ px: 2.25, pb: '6px', fontSize: 12, color: 'var(--warn)' }}>{t('chat.composer.mediaBusy')}</Box>}
      {model.compatible && !model.ready && !(hero && welcomeShown) && <Box sx={{ mb: '6px' }}><SetupPrompt model={model} /></Box>}
      {model.gated && <Box sx={{ mx: 2, mb: '6px' }}><GatedNotice model={model} /></Box>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', px: 1.25, pb: 1.25, pt: '6px' }}>
        <AttachButton labelId="chat.attach.tip" onBrowse={() => filePicker.current?.click()} onPickAssets={(assets) => void Promise.all(assets.map(assetToFile)).then(add)} />
        <input ref={filePicker} type="file" multiple hidden aria-label={t('chat.attach.tip')} accept={model.llm?.vision ? 'image/png,image/jpeg,image/webp,image/gif,text/*,.md,.json,.csv,.py,.js,.ts,.tsx,.jsx,.go,.rs,.java,.c,.cpp,.h,.sh,.sql,.yml,.yaml,.toml' : 'text/*,.md,.json,.csv,.py,.js,.ts,.tsx,.jsx,.go,.rs,.java,.c,.cpp,.h,.sh,.sql,.yml,.yaml,.toml'} onChange={(event) => { files(event.target.files); event.target.value = '' }} />
        <StudioModelPicker model={model} onSelect={(m) => update({ model_id: m.id })} />
        <SystemPromptPopover value={settings.system_prompt} onChange={(system_prompt) => update({ system_prompt })} />
        <ChatSettingsPopover settings={settings} model={model} status={status} onChange={update} />
        <WebToggle active={settings.tools.web} available={!!model.llm?.tools} brave={!!app?.has_brave_api_key} onToggle={() => void toggleWeb(settings.tools.web, (web) => update({ tools: { web } }))} />
        {!isPrivateMode() && <CreationToggle active={settings.tools.creation} available={!!model.llm?.tools} onToggle={() => update({ tools: { creation: !settings.tools.creation } })} />}
        {usage && <ContextGauge usage={usage} draftTokens={draftTokens} />}
        <Box sx={{ flex: 1 }} />
        <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' }, pr: '4px', fontSize: 11, color: 'var(--faint)' }}>{t('chat.send.newline')}</Box>
        <SendButton mode={own?.active && conversationId ? 'stop' : creating ? 'sending' : 'send'} enabled={canSend} onSend={send} onStop={() => conversationId && stopAnswer(conversationId)} />
      </Box>
      {!model.ready && !model.compatible && <Box role="status" sx={{ px: 2.25, pb: 1.25, fontSize: 12, color: 'var(--warn)' }}>{t('chat.composer.tooHeavy')}</Box>}
    </Box>
  )
}
