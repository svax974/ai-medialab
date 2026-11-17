/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react'
import { Box, Button, CircularProgress } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { SetupPrompt, WelcomeSetup } from '@/modules/engines'
import { useActiveModel } from '@/modules/model-catalog'
import { GatedNotice } from '@/modules/model-catalog/components/ModelBadges'
import { assetsApi } from '@/modules/media-library'
import { usePrivateStore } from '@/modules/private'
import { GenerationParams, StudioModelPicker, messagesApi, upsertMessage, type ConversationDetail } from '@/modules/studio-core'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { studioKeys } from '@/modules/studio-shell/lib/queryKeys'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { conversationsApi } from '@/modules/studio-shell/services/conversationsApi'
import { resolveMediaUrl } from '@/modules/studio-shell/services/studioHttp'
import { buildMeshRequest, canSendMesh } from './composerRules'
import { useMeshDraft } from './meshDraft'
import { gatedRepoUrl } from './gatedRepos'

export function Composer({ conversationId }: { conversationId: string | null }) {
  const t = useT()
  const model = useActiveModel('mesh')
  const draft = useMeshDraft()
  const privateMode = usePrivateStore((s) => s.active)
  const [uploading, setUploading] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const send = useMutation({
    mutationFn: messagesApi.send,
    onSuccess: async (response) => {
      draft.set({ prompt: '', reference: null })
      if (conversationId) queryClient.setQueryData<ConversationDetail>(studioKeys.conversation(conversationId), (c) => c ? upsertMessage(upsertMessage(c, response.user_message), response.assistant_message) : c)
      else {
        await queryClient.prefetchQuery({ queryKey: studioKeys.conversation(response.conversation_id), queryFn: () => conversationsApi.get(response.conversation_id) })
        navigate(studioPaths.conversation(response.conversation_id))
      }
      void queryClient.invalidateQueries({ queryKey: studioKeys.conversations })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  if (!model) return <Box sx={{ p: 3, color: 'var(--muted)' }}>{t('meshStudio.noModel')}</Box>
  const hasRef = model.reference_mode !== 'none' && !!draft.reference
  const canSend = canSendMesh(model, { prompt: draft.prompt, reference: draft.reference, privateMode, busy: uploading || send.isPending })
  const params = draft.params[model.id] ?? {}
  const submit = () => {
    if (!canSend) return
    send.mutate(buildMeshRequest({ conversationId, prompt: draft.prompt, model, params, seed: draft.seed, reference: draft.reference }))
  }
  return <Box component="fieldset" disabled={send.isPending} sx={{ minWidth: 0, m: 0, border: '1px solid var(--line)', borderRadius: '22px', backgroundColor: 'var(--surface)', p: 2 }}>
    {privateMode && <Box role="status" sx={{ color: 'var(--warn)', mb: 1 }}>{t('meshStudio.privateUnavailable')}</Box>}
    <Box component="textarea" value={draft.prompt} aria-label={t('meshStudio.prompt')} placeholder={t(model.requires_references ? 'meshStudio.imagePrompt' : 'meshStudio.prompt')} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => draft.set({ prompt: e.target.value })} onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} sx={{ width: '100%', minHeight: 85, resize: 'vertical', border: 0, outline: 0, background: 'transparent', color: 'var(--ink)', font: 'inherit' }} />
    {model.requires_references && !hasRef && <Box role="status" sx={{ mb: 1, fontSize: 12, color: 'var(--warn)' }}>{t('meshStudio.imageRequired')}</Box>}
    {hasRef && draft.reference && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}><Box component="img" src={resolveMediaUrl(draft.reference.thumb_url)} alt={t('meshStudio.reference')} sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: '10px' }} /><Box sx={{ fontSize: 12, color: 'var(--muted)' }}>{draft.reference.original_name ?? t('meshStudio.reference')}</Box></Box>}
    {model.license && <Box sx={{ mb: 1, fontSize: 12, color: 'var(--muted)' }}>{t('meshStudio.license', [model.license])}</Box>}
    {model.license_warning && <Box role="note" sx={{ mb: 1, p: 1, borderRadius: '10px', backgroundColor: 'color-mix(in oklab, var(--warn) 10%, transparent)', color: 'var(--warn)', fontSize: 12 }}>{model.license_warning}</Box>}
    <GatedNotice model={model} compact />
    {(model.gated_repos?.length ?? 0) > 0 && <Box sx={{ my: 1, fontSize: 12, color: 'var(--ink-2)' }}>
      <Box>{t('meshStudio.gatedRepos')}</Box>
      {model.gated_repos?.map((repo) => {
        const url = gatedRepoUrl(repo)
        return url ? <Box key={repo} component="a" href={url} target="_blank" rel="noopener noreferrer" sx={{ display: 'block', color: 'var(--safe)' }}>{repo}</Box> : null
      })}
    </Box>}
    {model.compatible && !model.ready && <SetupPrompt model={model} />}
    {!model.compatible && <Box role="status" sx={{ color: 'var(--warn)' }}>{model.engine_reason ?? model.plan.note}</Box>}
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
      {model.reference_mode !== 'none' && <Button component="label" disabled={privateMode || uploading} size="small">{draft.reference ? t('meshStudio.replaceImage') : t('meshStudio.attachImage')}<input hidden type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setUploading(true); void assetsApi.upload([file]).then((items) => draft.set({ reference: items[0] ?? null })).catch((error: Error) => toast.error(error.message)).finally(() => setUploading(false)) }} /></Button>}
      {draft.reference && model.reference_mode !== 'none' && <Button size="small" onClick={() => draft.set({ reference: null })}>{draft.reference.original_name ?? t('meshStudio.removeImage')} ×</Button>}
      <StudioModelPicker model={model} />
      <GenerationParams model={model} params={params} hasRefs={hasRef} seed={draft.seed} onChange={(patch) => draft.set({ params: { ...draft.params, [model.id]: { ...params, ...patch } } })} onReset={() => draft.set({ params: { ...draft.params, [model.id]: {} } })} onSeed={(seed) => draft.set({ seed })} />
      <Box sx={{ flex: 1 }} /><Button variant="contained" disabled={!canSend} onClick={submit}>{send.isPending || uploading ? <CircularProgress size={18} color="inherit" /> : t('meshStudio.generate')}</Button>
    </Box>
  </Box>
}

export function MeshHome() {
  const t = useT()
  return <Box sx={{ overflowY: 'auto', flex: 1, display: 'grid', placeItems: 'center', px: 2, py: 8 }}><Box sx={{ width: '100%', maxWidth: 820 }}><Box className="cn-eyebrow" sx={{ textAlign: 'center' }}>{t('meshStudio.eyebrow')}</Box><Box component="h1" sx={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 'clamp(40px, 6vw, 68px)', color: 'var(--ink)' }}>{t('meshStudio.title')}</Box><Box component="p" sx={{ textAlign: 'center', color: 'var(--muted)', mb: 4 }}>{t('meshStudio.subtitle')}</Box><WelcomeSetup kind="mesh" /><Composer conversationId={null} /></Box></Box>
}
