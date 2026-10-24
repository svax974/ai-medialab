/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { useParams } from 'react-router-dom'
import { useOcrEvents } from '../hooks/useOcr'
import { OcrHome } from './OcrHome'
import { OcrResult } from './OcrResult'

/** `/ocr` (new reading) and `/ocr/:id` (a reading): follows the `studio.ocr.*` events while shown. */
export function OcrPage() {
  const { id } = useParams()
  useOcrEvents()
  return id ? <OcrResult id={id} /> : <OcrHome />
}
