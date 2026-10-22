# Visual theme `chambre-noire`

Theme of the application, taken from the former interface (`frontend/src/styles.css`, Tailwind, removed in H6) for the new front
(MUI). Dark by default ("warm black, red safelight"), light "paper" mode kept. The values are
taken **as they are**; only the skin (CSS variables, MUI theme) and the class names change.

## Structure

| File | Role |
|---|---|
| `theme.css` | Tokens (CSS variables) dark and light, fonts (fontsource), aliases of the template's variables, animations, film grain, base rules (`@layer base` layer), `.cn-*` helpers. |
| `tokens.ts` | The same colors in hexadecimal for the MUI palette (MUI reads neither `var()` nor `color-mix()`), fonts, radii. `tokens.spec.ts` fails if `tokens.ts` and `theme.css` diverge. |
| `muiTheme.ts` | `createChambreNoireTheme(mode)`: palette, typography, shadows removed, component overrides. |
| `index.ts` | `ThemeDefinition` (`id: 'chambre-noire'`) registered in `ThemeRegistry` by `src/themes/index.ts`; imports `theme.css`. |
| `locales/` | Name and description of the theme (`studio.theme.chambreNoire.*`, fr/en). |
| `../muiThemes.ts` | Associates a visual theme id with its MUI theme factory (the template's registry only knows CSS). |
| `../AppMuiTheme.tsx` | Provides the active MUI theme above `ThemeModeProvider`, restores and saves the light/dark mode. |
| `../modeStorage.ts` | Reading/writing of the mode (`cn-theme`, as before). |

## Integration with the template

- **Mode**: the attribute `data-color-scheme` (`dark` | `light`) of `<html>`, as the template requires. The former `data-theme`
  carried the mode; it now designates the visual theme (`chambre-noire`). The anti-flash script of `index.html` sets
  both before the first render: dark unless `localStorage['cn-theme'] === 'light'` (system setting ignored, as before).
- **Default theme**: the registry falls back to the id `default`; `src/themes/index.ts` writes once
  `vx_visual_theme = 'chambre-noire'` when nothing is saved. The template's `default` theme stays registered (fallback
  if the storage is blocked); as `theme.css` is written on `:root`, it renders the same.
- **MUI**: `ThemeModeProvider` builds a palette-only theme from the CSS variables alone; `AppMuiTheme` applies on top
  the full theme (overrides included) through a second `ThemeProvider`. The shared components (`TipIconButton`,
  `Kbd`, `ConfirmHost`, `InfoTip`…) read the palette (`text.secondary`, `divider`, `action.hover`): they take the theme without modification.
- **Template variables pointed at the tokens**: `--color-bg`, `--color-surface`, `--color-text`, `--color-text-muted`,
  `--color-border`, `--color-primary`, `--color-success`, `--color-danger`, `--color-warning`, `--accent-strong`
  (`:root[data-color-scheme]` takes precedence over the rules of `colors.css`). The template's pages (administration, legal notices)
  keep their header, with the palette of this theme.

## Token correspondence (former -> new)

Values identical to the former interface in dark / light (`:root`, `:root[data-color-scheme='dark']` / `[data-color-scheme='light']`),
except the three secondary text levels, lightened (dark) or darkened (light) on 2026-10-14 for readability. WCAG contrast
on `--surface-2` (the cards): `--ink-2` ≥ 10.5:1, `--muted` ≥ 6.5:1, `--faint` ≥ 4.6:1 (threshold for regular text: 4.5:1).

| Former (`styles.css`) | New | Dark | Light | MUI usage |
|---|---|---|---|---|
| `--bg` | `--bg` | `#0d0b0a` | `#f3eee6` | `palette.background.default`, body |
| `--bg-elev` | `--bg-elev` | `#141110` | `#f8f4ee` | sidebar background (`MuiDrawer`, `Sidebar`) |
| `--surface` | `--surface` | `#191514` | `#fffcf7` | `palette.background.paper`, `Paper`, `Dialog`, fields |
| `--surface-2` | `--surface-2` | `#221d1b` | `#f1ebe2` | `Popover`/`Menu`, bordered button, row hover |
| `--surface-3` | `--surface-3` | `#2c2624` | `#e7dfd4` | active/hovered element (`action.hover`/`selected`), slider rail, tooltip |
| `--line` | `--line` | `#2f2826` | `#e2d9cd` | `palette.divider`, thin borders |
| `--line-strong` | `--line-strong` | `#43392f` | `#cbbfae` | border of `Popover`/`Menu`/`Tooltip`, field focus |
| `--ink` | `--ink` | `#efe8e1` | `#1c1815` | `palette.text.primary` |
| `--ink-2` | `--ink-2` | `#d5ccc3` | `#3a322d` | navigation text, `palette.secondary` |
| `--muted` | `--muted` | `#aaa098` | `#5b5149` | `palette.text.secondary`, icons at rest |
| `--faint` | `--faint` | `#8e8680` | `#71685f` | `palette.text.disabled`, placeholders |
| `--safe` | `--safe` | `#ff5b37` | `#d8401f` | `palette.primary.main` (safelight red) |
| `--safe-ink` | `--safe-ink` | `#1a0a05` | `#fff6f1` | `palette.primary.contrastText` |
| `--safe-soft` | `--safe-soft` | `color-mix(--safe 16%)` | `color-mix(--safe 11%)` | slider focus halo, primary badge |
| `--safe-glow` | `--safe-glow` | `color-mix(--safe 45%)` | `color-mix(--safe 30%)` | text selection (`::selection`) |
| `--ok` | `--ok` | `#8fc28a` | `#3f8a3a` | `palette.success.main` |
| `--warn` | `--warn` | `#f2b84b` | `#b7791f` | `palette.warning.main` |
| `--danger` | `--danger` | `#ff6b6b` | `#c43d3d` | `palette.error.main`, menu entry `data-danger` |
| `--tray` | `--tray` | `#070605` | `#e9e2d7` | class `.cn-tray` (background of empty thumbnails) |
| `--shadow` | `--shadow` (kept, **unused**) | see CSS | see CSS | replaced by borders (see below) |
| `--grain-opacity` | `--grain-opacity` | `0.05` | `0.035` | film grain |
| `--font-sans` / `--font-display` / `--font-mono` | same | Hanken Grotesk Variable / Instrument Serif / JetBrains Mono Variable | | `typography.fontFamily`, h1-h6 headings, `ListSubheader`, `kbd` |
| `--animate-*` + `@keyframes` | same | rise, fade, develop, breathe, shimmer, slide | | CSS, for the H4 screens |
| Tailwind aliases `--color-bg`, `-surface`, `-surface-2`, `-surface-3`, `-line`, `-line-strong`, `-ink`, `-ink-2`, `-muted`, `-faint`, `-safe`, `-safe-ink`, `-safe-soft`, `-ok`, `-warn`, `-danger`, `-tray`, `-bg-elev` | same (plain CSS variables) | | | usable in `sx` |
| *(template)* | `--color-text`, `--color-text-muted`, `--color-border`, `--color-border-strong`, `--color-primary`, `--color-primary-strong`, `--color-success`, `--color-warning`, `--accent-strong` | aliases of the tokens | | shared components, `ThemeModeProvider` |

Helpers and classes of the former `@layer components`:

| Former | New |
|---|---|
| `.panel` (background, border, shadow) | `Paper` / `Dialog`: background `--surface`, border `--line`, **no shadow** |
| `.menu` | `Menu` / `Popover`: background `--surface-2`, border `--line-strong`, radius 14, inner padding 6, fade-in 140 ms |
| `.menu-item` (+ `data-highlighted`, `data-danger`) | `MenuItem` (hover/focus `--surface-3`, `data-danger` in red), radius 9, 13.5 px |
| `.eyebrow` | `.cn-eyebrow` (mono 10.5 px, 0.14 em, uppercase); `ListSubheader` has the same style |
| `.tray`, `.shimmer`, `.checker` | `.cn-tray`, `.cn-shimmer`, `.cn-checker` |
| Rules of `@layer base` (grain, `::selection`, `:focus-visible`, thin scrollbars) | same, in `@layer base` (component styles still take precedence, as the utilities did before) |

## Typography

- Text: Hanken Grotesk Variable (`font-feature-settings: "ss01", "cv11"`, smoothing), 14 px.
- Headings (h1-h6, dialog titles): Instrument Serif 400; sidebar brand in italic 22 px.
- Code, shortcuts, group labels: JetBrains Mono Variable.
- All three are loaded by fontsource (`@fontsource-variable/hanken-grotesk`, `@fontsource-variable/jetbrains-mono`,
  `@fontsource/instrument-serif`, 400 and 400 italic), added by `front/package.local.json`.

## Radii (Tailwind scale of the former interface)

`shape.borderRadius = 6` (so `sx={{ borderRadius: 2 }}` = 12 px). `radii` of `tokens.ts`: 6 (chips, `rounded-md`), 8 (icon
buttons, tooltips, thumbnails), 9 (menu entries), 12 (buttons, fields, list rows, mode switch), 14 (menus,
popovers), 16 (confirmation dialog), 24 (dialogs).

## Thin borders instead of shadows

`theme.shadows` is `'none'` everywhere; `Paper` has `elevation: 0`. Depth comes from 1 px borders: `--line` (surfaces),
`--line-strong` (floating layers: menus, tooltips, popovers). Intended exceptions, which are not surface shadows: the slider's focus ring (`0 0 0 4px --safe-soft`), the halo of a conversation's "busy" dot,
the inner outlines `inset 0 0 0 1px` that play the role of a border (tab track, switch rail).

## Ripple effect

`disableRipple`: `MuiButtonBase.defaultProps` (so `Button`, `IconButton`, `Tab`, `ListItemButton`, `MenuItem`…), `Button`,
`IconButton`, `Tab`, `Switch`. The states are color/border changes (hover, active). Keyboard focus: a 2 px `--safe` ring offset by 2 px (`:focus-visible` of the former interface, reproduced on `.Mui-focusVisible`).

## MUI overrides

| Component | Rendering taken from the former interface |
|---|---|
| `Button` | 36 px, radius 12, 14 px/500, no uppercase. `contained primary` = `--safe` + `--safe-ink`, hover `brightness(1.1)`; `outlined` and `contained secondary` = background `--surface-2`, border `--line` -> `--line-strong` on hover; `contained error` = red at 15% (25% on hover); `text` = ghost `--ink-2` -> `--ink`. |
| `IconButton` | 36 px (small 28; widens around a label marked `cn-icon-label`, like the settings button and its step count), radius 8, `--muted` -> `--ink` on background `--surface-3`; `colorError`: soft red hover. |
| `Dialog` | background `--surface`, border `--line`, radius 24 (16 for `maxWidth="xs"`, the confirmation), max height 720 px / 90 vh, black 55% veil with 4 px blur, title Instrument Serif 28 px. |
| `Popover` / `Menu` / `MenuItem` | see `.menu` / `.menu-item` above. |
| `Slider` | 4 px rail `--surface-3`, track `--safe`, 14 px handle bordered `--safe` on background `--surface`, grows 10% on hover, `--safe-soft` halo on focus. |
| `Switch` | 36 x 20, rail `--surface-3` ringed by `--line`, checked `--safe`; white 16 px handle offset by 2 px. |
| `Tooltip` | background `--surface-3`, border `--line-strong`, radius 8, 12 px, `6px 10px`, 6 px from the anchor, delay 350 ms, fade. |
| `TextField` / `OutlinedInput` | 36 px, radius 12, background `--surface`, border `--line`, focus `--line-strong` (1 px, no ring), placeholder `--faint`. |
| `Tabs` / `Tab` | segmented control: recessed track (`--surface`, border `--line`, 4 px margin), active tab = badge `--surface-3` ringed by `--line-strong` that slides in 300 ms (`cubic-bezier(.2,.7,.2,1)`), icon of the active tab in `--safe`. |
| `Chip` | 22 px, radius 6, 12 px/500, `--surface-2` ringed by `--line`; `primary`/`success`/`warning`/`error` in a soft tint without border. |
| `LinearProgress` | 4 px, full radius, rail `--surface-3`, bar `--safe`. |
| `Paper` | `elevation: 0`, background `--surface`, without the MUI dark-mode light overlay. |
| others | `Backdrop`, `Divider`, `ListSubheader`, `ListItemButton`, `Snackbar`, `Alert`, `AppBar`, `Drawer`, `Link`, `Skeleton`, `CircularProgress`. |

## Film grain

`body::after`: SVG `feTurbulence` noise as background image, `position: fixed`, `pointer-events: none`, opacity `--grain-opacity`.
The only difference: `z-index: 2000` (the former 100 went above the Radix dialogs, which were at 60-81; the MUI modals are at 1300 and
the tooltips at 1500, so the grain stays above everything).

## Adding a theme

Create `src/themes/<id>/` (CSS, `index.ts`, MUI factory), register it in `src/themes/index.ts` (`themeRegistry.register`) and in
`src/themes/muiThemes.ts`.

## Known deviations

- The template's theme selector (`UserAdminThemes`) is not shown: there is only one theme.
- `<html lang>` stays `fr` (the template does not update it when the language changes).
- The shared components that hard-code sizes (`Kbd`: 10 px) keep their dimensions; only the mono font is enforced.
- Visual parity to be validated by eye (no browser was launched for H3): see the list in the H3 report.
