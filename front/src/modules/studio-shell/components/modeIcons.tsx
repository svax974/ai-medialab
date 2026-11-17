/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import ViewInArOutlined from '@mui/icons-material/ViewInArOutlined'
import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded'
import ImageOutlined from '@mui/icons-material/ImageOutlined'
import MovieCreationOutlined from '@mui/icons-material/MovieCreationOutlined'
import DocumentScannerOutlined from '@mui/icons-material/DocumentScannerOutlined'
import SchemaOutlined from '@mui/icons-material/SchemaOutlined'
import SubtitlesOutlined from '@mui/icons-material/SubtitlesOutlined'
import type { StudioMode } from '../types'

/** Icon of a mode (mode switch, conversation thumbnails). */
export function ModeIcon({ mode, fontSize = 16 }: { mode: StudioMode; fontSize?: number }) {
  const sx = { fontSize }
  if (mode === 'mesh') return <ViewInArOutlined sx={sx} />
  if (mode === 'transcription') return <SubtitlesOutlined sx={sx} />
  if (mode === 'audio') return <GraphicEqRounded sx={sx} />
  if (mode === 'video') return <MovieCreationOutlined sx={sx} />
  if (mode === 'chat') return <ChatBubbleOutlineRounded sx={sx} />
  if (mode === 'diagram') return <SchemaOutlined sx={sx} />
  if (mode === 'ocr') return <DocumentScannerOutlined sx={sx} />
  return <ImageOutlined sx={sx} />
}
