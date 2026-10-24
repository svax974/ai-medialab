/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import DocumentScannerOutlined from '@mui/icons-material/DocumentScannerOutlined'
import { useNavigate } from 'react-router-dom'
import { TipIconButton } from '@/modules_shared/common/components/ui/iconbutton'
import { useLightboxStore } from '@/modules/media-library/state/lightboxStore'
import type { Asset } from '@/modules/media-library/types'
import { studioPaths } from '@/modules/studio-shell/lib/routes'
import { useCreateOcr } from '../hooks/useOcr'

/** Viewer button: reads the text of an image of the library with the default OCR model, and opens the reading. */
export function ExtractTextAction({ asset }: { asset: Asset }) {
  const navigate = useNavigate()
  const close = useLightboxStore((s) => s.close)
  const create = useCreateOcr((doc) => {
    close()
    navigate(studioPaths.ocrDocument(doc.id))
  })
  return (
    <TipIconButton labelId="ocrStudio.extract" disabled={create.isPending} onClick={() => create.mutate({ assetId: asset.id })} sx={{ color: 'inherit' }}>
      <DocumentScannerOutlined fontSize="small" />
    </TipIconButton>
  )
}
