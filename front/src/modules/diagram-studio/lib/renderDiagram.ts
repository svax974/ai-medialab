/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import type { DiagramTheme } from '../types'
import { MERMAID_THEMES } from './mermaidThemes'

let renderCount = 0

/** Mermaid → SVG, with the chosen visual preset applied (never baked into the stored source: see `mermaidThemes.ts`). */
export async function renderMermaid(mermaidSource: string, theme: DiagramTheme): Promise<string> {
  const mermaid = (await import('mermaid')).default
  const config = MERMAID_THEMES[theme]
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: config.theme, themeVariables: config.themeVariables })
  const { svg } = await mermaid.render(`diagram-${renderCount++}`, mermaidSource)
  return svg
}

/** An inline SVG string → a PNG blob, at `scale`× its natural size (crisper on high-density screens and when zoomed
 * in the lightbox). A plain `Image` + `canvas` round trip: the SVG is already self-contained (styles/colors inlined
 * by Mermaid), so no DOM mounting or `html-to-image` is needed for this conversion. */
export async function svgToPng(svg: string, scale = 2): Promise<{ blob: Blob; width: number; height: number }> {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Le diagramme n'a pas pu être rendu en image."))
      img.src = url
    })
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Le canevas de rendu est indisponible.')
    ctx.fillStyle = '#ffffff' // a PNG has no transparency channel background by convention here: match the page
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error("La conversion en PNG a échoué.")
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}
