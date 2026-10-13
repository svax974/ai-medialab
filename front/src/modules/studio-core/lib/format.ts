/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Time of day of a timestamp in epoch seconds, in the language's usual form ("14:05" / "2:05 PM"). */
export function formatTime(timestampSeconds: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(timestampSeconds * 1000))
}

/** Day and short month ("13 oct." / "Oct 13"). */
export function formatDay(timestampSeconds: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(timestampSeconds * 1000))
}

/** Pixel size "1024 × 768 px" and megapixels "0.79 MP" of an image, as the size popover and the viewer show them. */
export function formatMegapixels(width: number, height: number): string {
  return `${((width * height) / 1e6).toFixed(2)} MP`
}

/** Length of a clip in seconds with up to one decimal ("5 s", "5,5 s" / "5.5 sec"). */
export function formatSeconds(seconds: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 }).format(seconds)
}
