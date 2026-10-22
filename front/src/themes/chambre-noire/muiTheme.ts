/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { createTheme, type Components, type Shadows, type Theme } from '@mui/material/styles';
import Fade from '@mui/material/Fade';
import { darkTokens, fonts, lightTokens, radii } from './tokens';

export type ThemeMode = 'dark' | 'light';

/** Easing of the former interface (mode switch, reveals). */
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/** `color-mix` of a CSS token with transparency (components' overrides are plain CSS, so var() is fine there). */
const soft = (cssVar: string, percent: number) => `color-mix(in oklab, var(${cssVar}) ${percent}%, transparent)`;

/** Surfaces are delimited by a thin border, never by a shadow. */
const hairline = (color = 'var(--line)') => `1px solid ${color}`;

const focusRing = { outline: '2px solid var(--safe)', outlineOffset: 2 };

/** Look of a button by variant and color: primary = safelight, secondary/outlined = bordered surface, error = soft red, text = ghost. */
function buttonLook(variant: string | undefined, color: string | undefined) {
  const bordered = {
    backgroundColor: 'var(--surface-2)',
    color: 'var(--ink)',
    border: hairline(),
    '&:hover': { backgroundColor: 'var(--surface-3)', borderColor: 'var(--line-strong)' },
  }
  const ghost = { color: 'var(--ink-2)', '&:hover': { backgroundColor: 'var(--surface-3)', color: 'var(--ink)' } }
  if (variant === 'contained') {
    if (color === 'error') return { backgroundColor: soft('--danger', 15), color: 'var(--danger)', '&:hover': { backgroundColor: soft('--danger', 25) } }
    if (color === 'primary') return { backgroundColor: 'var(--safe)', color: 'var(--safe-ink)', '&:hover': { backgroundColor: 'var(--safe)', filter: 'brightness(1.1)' } }
    return bordered
  }
  if (variant === 'outlined') return bordered
  return ghost
}

function buildComponents(): Components<Theme> {
  return {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: 'var(--bg)', color: 'var(--ink)', fontFamily: fonts.sans },
      },
    },
    // No ripple anywhere: state changes are color/border changes.
    MuiButtonBase: {
      defaultProps: { disableRipple: true, disableTouchRipple: true },
      styleOverrides: { root: { '&.Mui-focusVisible': focusRing } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: true },
      styleOverrides: {
        root: ({ ownerState }) => ({
          height: 36,
          padding: '0 14px',
          gap: 8,
          borderRadius: radii.control,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 1.4,
          textTransform: 'none',
          boxShadow: 'none',
          transition: 'background-color 0.15s, border-color 0.15s, color 0.15s, filter 0.15s',
          '&.Mui-disabled': { opacity: 0.45 },
          ...(ownerState.size === 'small' ? { height: 30, padding: '0 10px', fontSize: 13 } : {}),
          ...(ownerState.size === 'large' ? { height: 42, padding: '0 18px', fontSize: 15 } : {}),
          ...buttonLook(ownerState.variant, ownerState.color),
        }),
      },
    },
    MuiIconButton: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          width: 36,
          height: 36,
          padding: 0,
          borderRadius: radii.md,
          color: 'var(--muted)',
          transition: 'background-color 0.15s, color 0.15s',
          '&:hover': { backgroundColor: 'var(--surface-3)', color: 'var(--ink)' },
          '&.Mui-disabled': { opacity: 0.4 },
          // A button showing a label next to its icon (`cn-icon-label`, e.g. the settings button and its step count)
          // grows around it instead of overflowing its own focus ring and hover background.
          '&:has(.cn-icon-label)': { width: 'auto', minWidth: 36 },
        },
        sizeSmall: { width: 28, height: 28 },
        sizeLarge: { width: 44, height: 44 },
        colorPrimary: { color: 'var(--safe)' },
        colorError: { color: 'var(--danger)', '&:hover': { backgroundColor: soft('--danger', 15) } },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none', backgroundColor: 'var(--surface)' },
        outlined: { border: hairline() },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          border: hairline(),
          borderRadius: radii.dialog,
          backgroundColor: 'var(--surface)',
          backgroundImage: 'none',
          maxHeight: 'min(720px, 90vh)',
          margin: 16,
        },
        paperWidthXs: { borderRadius: radii.card },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: { backgroundColor: 'rgb(0 0 0 / 0.55)', backdropFilter: 'blur(4px)' },
        invisible: { backgroundColor: 'transparent', backdropFilter: 'none' },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: { fontFamily: fonts.display, fontWeight: 400, fontSize: 28, lineHeight: 1.2, padding: '20px 24px 8px', color: 'var(--ink)' },
      },
    },
    MuiDialogContent: { styleOverrides: { root: { padding: '8px 24px 24px', color: 'var(--muted)', fontSize: 14 } } },
    MuiDialogContentText: { styleOverrides: { root: { fontSize: 14, lineHeight: 1.6, color: 'var(--muted)' } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '0 24px 24px', gap: 8, '& > :not(style) ~ :not(style)': { marginLeft: 0 } } } },
    MuiPopover: {
      defaultProps: { slots: { transition: Fade }, transitionDuration: 140 },
      styleOverrides: {
        paper: {
          backgroundColor: 'var(--surface-2)',
          border: hairline('var(--line-strong)'),
          borderRadius: radii.menu,
          backgroundImage: 'none',
          maxHeight: 'min(85vh, calc(100% - 24px))',
          overscrollBehavior: 'contain',
        },
      },
    },
    MuiMenu: {
      defaultProps: { slots: { transition: Fade }, transitionDuration: 140 },
      styleOverrides: { list: { padding: 6 }, paper: { minWidth: 176 } },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          gap: 10,
          minHeight: 0,
          padding: '8px 10px',
          borderRadius: radii.item,
          fontSize: 13.5,
          lineHeight: 1.45,
          color: 'var(--ink-2)',
          '&:hover, &.Mui-focusVisible': { backgroundColor: 'var(--surface-3)', color: 'var(--ink)' },
          // Menus focus the selected item on open: without the focusVisible case MUI's primary-tinted default wins.
          '&.Mui-selected, &.Mui-selected:hover, &.Mui-selected.Mui-focusVisible': { backgroundColor: 'var(--surface-3)', color: 'var(--ink)' },
          '&[data-danger]': { color: 'var(--danger)' },
          '& .MuiSvgIcon-root': { fontSize: 16 },
        },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: 'var(--line)' } } },
    MuiSlider: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: { height: 4, padding: '6px 0', color: 'var(--safe)' },
        rail: { opacity: 1, backgroundColor: 'var(--surface-3)' },
        track: { border: 'none', backgroundColor: 'var(--safe)' },
        thumb: {
          width: 14,
          height: 14,
          backgroundColor: 'var(--surface)',
          border: '2px solid var(--safe)',
          boxShadow: 'none',
          transition: 'transform 0.15s',
          '&::before': { display: 'none' },
          '&:hover, &.Mui-focusVisible, &.Mui-active': { boxShadow: 'none', transform: 'translate(-50%, -50%) scale(1.1)' },
          '&.Mui-focusVisible': { boxShadow: `0 0 0 4px ${soft('--safe', 16)}` },
        },
        markLabel: { fontSize: 11, color: 'var(--faint)' },
        valueLabel: { backgroundColor: 'var(--surface-3)', border: hairline('var(--line-strong)'), color: 'var(--ink)', borderRadius: radii.md, fontSize: 12 },
      },
    },
    MuiSwitch: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: { width: 36, height: 20, padding: 0, overflow: 'visible' },
        switchBase: {
          padding: 2,
          color: '#fff',
          '&.Mui-checked': { transform: 'translateX(16px)', color: '#fff' },
          '&.Mui-checked + .MuiSwitch-track': { backgroundColor: 'var(--safe)', opacity: 1 },
          '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.45 },
        },
        thumb: { width: 16, height: 16, boxShadow: 'none', backgroundColor: '#fff' },
        track: {
          borderRadius: 10,
          opacity: 1,
          backgroundColor: 'var(--surface-3)',
          boxShadow: 'inset 0 0 0 1px var(--line)',
          boxSizing: 'border-box',
        },
      },
    },
    MuiTooltip: {
      defaultProps: { enterDelay: 350, enterNextDelay: 100, arrow: false, slots: { transition: Fade }, slotProps: { transition: { timeout: 140 } } },
      styleOverrides: {
        tooltip: {
          backgroundColor: 'var(--surface-3)',
          border: hairline('var(--line-strong)'),
          borderRadius: radii.md,
          color: 'var(--ink)',
          fontSize: 12,
          lineHeight: 1.5,
          fontWeight: 400,
          padding: '6px 10px',
          maxWidth: 'min(19rem, calc(100vw - 24px))',
          boxShadow: 'none',
        },
        tooltipPlacementTop: { marginBottom: '6px !important' },
        tooltipPlacementBottom: { marginTop: '6px !important' },
        tooltipPlacementLeft: { marginRight: '6px !important' },
        tooltipPlacementRight: { marginLeft: '6px !important' },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: { fontSize: 14, color: 'var(--ink)' },
        input: { '&::placeholder': { color: 'var(--faint)', opacity: 1 } },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          minHeight: 36,
          borderRadius: radii.control,
          backgroundColor: 'var(--surface)',
          '& .MuiOutlinedInput-notchedOutline': { border: hairline(), transition: 'border-color 0.15s' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--line-strong)', borderWidth: 1 },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--danger)' },
        },
        input: { padding: '8px 12px', lineHeight: '20px', height: 20, boxSizing: 'content-box' },
        multiline: { padding: 0, '& .MuiOutlinedInput-input': { height: 'auto' } },
        adornedStart: { paddingLeft: 12 },
        adornedEnd: { paddingRight: 8 },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 14, color: 'var(--muted)', '&.Mui-focused': { color: 'var(--ink-2)' } } } },
    MuiFormHelperText: { styleOverrides: { root: { fontSize: 12, color: 'var(--faint)', marginLeft: 2 } } },
    // Tabs are segmented controls: a recessed track, the selected tab is a raised pill that slides.
    MuiTabs: {
      defaultProps: { variant: 'fullWidth' },
      styleOverrides: {
        root: {
          minHeight: 0,
          padding: 4,
          borderRadius: radii.control,
          backgroundColor: 'var(--surface)',
          boxShadow: 'inset 0 0 0 1px var(--line)',
        },
        list: { position: 'relative', zIndex: 1 },
        indicator: {
          top: 0,
          bottom: 0,
          height: 'auto',
          zIndex: 0,
          borderRadius: radii.md,
          backgroundColor: 'var(--surface-3)',
          boxShadow: 'inset 0 0 0 1px var(--line-strong)',
          transition: `left 0.3s ${EASE}, width 0.3s ${EASE}`,
        },
      },
    },
    MuiTab: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          minHeight: 32,
          height: 32,
          padding: '0 12px',
          gap: 8,
          borderRadius: radii.md,
          fontSize: 13.5,
          fontWeight: 500,
          textTransform: 'none',
          color: 'var(--muted)',
          transition: 'color 0.15s',
          '&:hover': { color: 'var(--ink)' },
          '&.Mui-selected': { color: 'var(--ink)', '& .MuiSvgIcon-root, & svg': { color: 'var(--safe)' } },
          '&.MuiTab-labelIcon': { minHeight: 32, flexDirection: 'row' },
          '& .MuiTab-iconWrapper, & > .MuiSvgIcon-root': { marginBottom: 0, marginRight: 0 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          height: 22,
          borderRadius: radii.sm,
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--ink-2)',
          backgroundColor: 'var(--surface-2)',
          border: hairline(),
        },
        label: { padding: '0 8px' },
        colorPrimary: { color: 'var(--safe)', backgroundColor: soft('--safe', 16), borderColor: 'transparent' },
        colorSuccess: { color: 'var(--ok)', backgroundColor: soft('--ok', 14), borderColor: 'transparent' },
        colorWarning: { color: 'var(--warn)', backgroundColor: soft('--warn', 14), borderColor: 'transparent' },
        colorError: { color: 'var(--danger)', backgroundColor: soft('--danger', 15), borderColor: 'transparent' },
        sizeSmall: { height: 20, fontSize: 11 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 4, borderRadius: 999, backgroundColor: 'var(--surface-3)' },
        bar: { borderRadius: 999, backgroundColor: 'var(--safe)' },
      },
    },
    MuiCircularProgress: { styleOverrides: { root: { color: 'var(--safe)' } } },
    MuiListSubheader: {
      styleOverrides: {
        root: {
          backgroundColor: 'transparent',
          fontFamily: fonts.mono,
          fontSize: 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          lineHeight: '32px',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: radii.control,
          '&:hover': { backgroundColor: 'var(--surface-2)' },
          '&.Mui-selected, &.Mui-selected:hover, &.Mui-selected.Mui-focusVisible': { backgroundColor: 'var(--surface-3)' },
        },
      },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        root: { backgroundColor: 'var(--surface-2)', color: 'var(--ink)', border: hairline('var(--line-strong)'), borderRadius: radii.card, boxShadow: 'none' },
      },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: radii.control, border: hairline(), boxShadow: 'none' } },
    },
    MuiLink: { styleOverrides: { root: { color: 'var(--safe)', textDecorationColor: soft('--safe', 50) } } },
    MuiAppBar: { defaultProps: { elevation: 0 }, styleOverrides: { root: { boxShadow: 'none', borderBottom: hairline() } } },
    MuiDrawer: { styleOverrides: { paper: { borderRight: hairline(), backgroundColor: 'var(--bg-elev)', backgroundImage: 'none' } } },
    MuiSkeleton: { styleOverrides: { root: { backgroundColor: 'var(--surface-3)' } } },
  };
}

/** The MUI theme of "chambre noire" for a color mode. Palette = hex tokens; components = CSS variables (theme.css). */
export function createChambreNoireTheme(mode: ThemeMode): Theme {
  const t = mode === 'dark' ? darkTokens : lightTokens;
  return createTheme({
    palette: {
      mode,
      primary: { main: t.safe, contrastText: t.safeInk },
      secondary: { main: t.ink2, contrastText: t.bg },
      error: { main: t.danger },
      warning: { main: t.warn },
      success: { main: t.ok },
      info: { main: t.ink2 },
      background: { default: t.bg, paper: t.surface },
      text: { primary: t.ink, secondary: t.muted, disabled: t.faint },
      divider: t.line,
      action: {
        active: t.muted,
        hover: t.surface3,
        selected: t.surface3,
        disabled: t.faint,
        disabledBackground: t.surface2,
        focus: t.surface3,
        hoverOpacity: 1,
        selectedOpacity: 1,
      },
    },
    typography: {
      fontFamily: fonts.sans,
      fontSize: 14,
      h1: { fontFamily: fonts.display, fontWeight: 400 },
      h2: { fontFamily: fonts.display, fontWeight: 400 },
      h3: { fontFamily: fonts.display, fontWeight: 400 },
      h4: { fontFamily: fonts.display, fontWeight: 400 },
      h5: { fontFamily: fonts.display, fontWeight: 400 },
      h6: { fontFamily: fonts.display, fontWeight: 400 },
      subtitle1: { fontWeight: 500 },
      subtitle2: { fontWeight: 500 },
      button: { textTransform: 'none', fontWeight: 500 },
    },
    shape: { borderRadius: 6 },
    // No shadows: depth comes from thin borders (see `hairline`).
    shadows: Array<string>(25).fill('none') as Shadows,
    components: buildComponents(),
  });
}
