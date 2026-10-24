/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { eventStreamClient } from '@/modules_shared/common/core/events'
import { ocrApi } from '../services/ocrApi'
import type { CreateOcrRequest, OcrDocument, OcrDocumentDetail } from '../types'

export const ocrKeys = {
  all: ['ocr'] as const,
  list: (query: string) => ['ocr', 'list', query] as const,
  lists: ['ocr', 'list'] as const,
  document: (id: string) => ['ocr', 'document', id] as const,
}

export const OCR_TOPICS = ['studio.ocr.updated', 'studio.ocr.deleted'] as const

export function useOcrDocuments(query = '') {
  return useQuery({ queryKey: ocrKeys.list(query), queryFn: () => ocrApi.list(query) })
}

export function useOcrDocument(id: string | null) {
  return useQuery({ queryKey: ocrKeys.document(id ?? ''), queryFn: () => ocrApi.get(id as string), enabled: id !== null })
}

/** Writes an updated reading into the cache: its summary into the open detail, and a re-read of the lists (title, status, pages). */
export function applyOcrUpdate(queryClient: QueryClient, doc: OcrDocument): void {
  queryClient.setQueryData<OcrDocumentDetail>(ocrKeys.document(doc.id), (current) => (current ? { ...current, ...doc } : current))
  void queryClient.invalidateQueries({ queryKey: ocrKeys.lists })
  // The pages are not in the event: a page read since the last look is fetched.
  const detail = queryClient.getQueryData<OcrDocumentDetail>(ocrKeys.document(doc.id))
  if (detail && detail.pages_read.length < doc.progress.done) void queryClient.invalidateQueries({ queryKey: ocrKeys.document(doc.id) })
  if (!detail && doc.status !== 'queued') void queryClient.invalidateQueries({ queryKey: ocrKeys.document(doc.id) })
  if (doc.status === 'done' || doc.status === 'failed') void queryClient.invalidateQueries({ queryKey: ocrKeys.document(doc.id) })
}

/** Keeps the readings in step with the `studio.ocr.*` events of Nest (one subscription per tab, shared with the other consumers). */
export function useOcrEvents(): void {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      eventStreamClient.subscribe(
        [...OCR_TOPICS],
        (event) => {
          const data = event.data as Record<string, unknown> | undefined
          if (event.topic === 'studio.ocr.deleted') {
            if (typeof data?.id === 'string') queryClient.removeQueries({ queryKey: ocrKeys.document(data.id) })
            void queryClient.invalidateQueries({ queryKey: ocrKeys.lists })
          } else if (data && typeof data.id === 'string') {
            applyOcrUpdate(queryClient, data as unknown as OcrDocument)
          }
        },
        { onResync: () => void queryClient.invalidateQueries({ queryKey: ocrKeys.all }) },
      ),
    [queryClient],
  )
}

const onError = (error: Error) => toast.error(error.message)

export function useCreateOcr(onCreated?: (doc: OcrDocument) => void, onProgress?: (percent: number | null) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: CreateOcrRequest) => ocrApi.create(request, onProgress),
    onSuccess: (doc) => {
      void queryClient.invalidateQueries({ queryKey: ocrKeys.lists })
      onCreated?.(doc)
    },
    onError,
  })
}

export function useOcrActions() {
  const queryClient = useQueryClient()
  const refresh = (doc: OcrDocument) => applyOcrUpdate(queryClient, doc)
  return {
    cancel: useMutation({ mutationFn: (id: string) => ocrApi.cancel(id), onSuccess: refresh, onError }),
    retry: useMutation({ mutationFn: (args: { id: string; change?: Parameters<typeof ocrApi.retry>[1] }) => ocrApi.retry(args.id, args.change), onSuccess: refresh, onError }),
    remove: useMutation({
      mutationFn: (id: string) => ocrApi.remove(id),
      onSuccess: (_result, id) => {
        queryClient.removeQueries({ queryKey: ocrKeys.document(id) })
        void queryClient.invalidateQueries({ queryKey: ocrKeys.lists })
      },
      onError,
    }),
  }
}
