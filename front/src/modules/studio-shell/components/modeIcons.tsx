/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import GraphicEqRounded from '@mui/icons-material/GraphicEqRounded'
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded'
import ImageOutlined from '@mui/icons-material/ImageOutlined'
import MovieCreationOutlined from '@mui/icons-material/MovieCreationOutlined'
import SchemaOutlined from '@mui/icons-material/SchemaOutlined'
import type { StudioMode } from '../types'

/** Icon of a mode (mode switch, conversation thumbnails). */
export function ModeIcon({ mode, fontSize = 16 }: { mode: StudioMode; fontSize?: number }) {
  const sx = { fontSize }
  if (mode === 'audio') return <GraphicEqRounded sx={sx} />
  if (mode === 'video') return <MovieCreationOutlined sx={sx} />
  if (mode === 'chat') return <ChatBubbleOutlineRounded sx={sx} />
  if (mode === 'diagram') return <SchemaOutlined sx={sx} />
  return <ImageOutlined sx={sx} />
}
