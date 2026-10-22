/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/**
 * Palette tokens of the "chambre noire" theme, as plain hex values for the MUI palette (MUI parses colors, so it cannot
 * read the `color-mix()` / `var()` values of theme.css). `tokens.spec.ts` checks that these equal the CSS variables.
 */
export interface ChambreNoireTokens {
  bg: string;
  bgElev: string;
  surface: string;
  surface2: string;
  surface3: string;
  line: string;
  lineStrong: string;
  ink: string;
  ink2: string;
  muted: string;
  faint: string;
  safe: string;
  safeInk: string;
  ok: string;
  warn: string;
  danger: string;
  tray: string;
}

export const darkTokens: ChambreNoireTokens = {
  bg: '#0d0b0a',
  bgElev: '#141110',
  surface: '#191514',
  surface2: '#221d1b',
  surface3: '#2c2624',
  line: '#2f2826',
  lineStrong: '#43392f',
  ink: '#efe8e1',
  ink2: '#d5ccc3',
  muted: '#aaa098',
  faint: '#8e8680',
  safe: '#ff5b37',
  safeInk: '#1a0a05',
  ok: '#8fc28a',
  warn: '#f2b84b',
  danger: '#ff6b6b',
  tray: '#070605',
};

export const lightTokens: ChambreNoireTokens = {
  bg: '#f3eee6',
  bgElev: '#f8f4ee',
  surface: '#fffcf7',
  surface2: '#f1ebe2',
  surface3: '#e7dfd4',
  line: '#e2d9cd',
  lineStrong: '#cbbfae',
  ink: '#1c1815',
  ink2: '#3a322d',
  muted: '#5b5149',
  faint: '#71685f',
  safe: '#d8401f',
  safeInk: '#fff6f1',
  ok: '#3f8a3a',
  warn: '#b7791f',
  danger: '#c43d3d',
  tray: '#e9e2d7',
};

/** CSS variable name of each token (theme.css). */
export const tokenCssVars: Record<keyof ChambreNoireTokens, string> = {
  bg: '--bg',
  bgElev: '--bg-elev',
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  line: '--line',
  lineStrong: '--line-strong',
  ink: '--ink',
  ink2: '--ink-2',
  muted: '--muted',
  faint: '--faint',
  safe: '--safe',
  safeInk: '--safe-ink',
  ok: '--ok',
  warn: '--warn',
  danger: '--danger',
  tray: '--tray',
};

export const fonts = {
  sans: '"Hanken Grotesk Variable", ui-sans-serif, system-ui, sans-serif',
  display: '"Instrument Serif", ui-serif, Georgia, serif',
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
} as const;

/** Radii of the former interface (Tailwind scale), in px. */
export const radii = { sm: 6, md: 8, item: 9, control: 12, menu: 14, card: 16, dialog: 24 } as const;
