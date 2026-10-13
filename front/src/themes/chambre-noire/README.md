# Thème visuel `chambre-noire`

Thème de l'application, repris de l'ancienne interface (`frontend/src/styles.css`, Tailwind, supprimé en H6) pour le nouveau front
(MUI). Sombre par défaut (« noir chaud, lumière inactinique rouge »), mode clair « papier » conservé. Les valeurs sont
reprises **telles quelles** ; seuls l'habillage (variables CSS, thème MUI) et les noms de classes changent.

## Structure

| Fichier | Rôle |
|---|---|
| `theme.css` | Jetons (variables CSS) sombre et clair, polices (fontsource), alias des variables du gabarit, animations, grain de film, règles de base (couche `@layer base`), aides `.cn-*`. |
| `tokens.ts` | Les mêmes couleurs en hexadécimal pour la palette MUI (MUI ne lit ni `var()` ni `color-mix()`), polices, rayons. `tokens.spec.ts` échoue si `tokens.ts` et `theme.css` divergent. |
| `muiTheme.ts` | `createChambreNoireTheme(mode)` : palette, typographie, ombres supprimées, surcharges de composants. |
| `index.ts` | `ThemeDefinition` (`id: 'chambre-noire'`) enregistrée dans `ThemeRegistry` par `src/themes/index.ts` ; importe `theme.css`. |
| `locales/` | Nom et description du thème (`studio.theme.chambreNoire.*`, fr/en). |
| `../muiThemes.ts` | Associe un id de thème visuel à sa fabrique de thème MUI (le registre du gabarit ne connaît que le CSS). |
| `../AppMuiTheme.tsx` | Fournit le thème MUI actif au-dessus de `ThemeModeProvider`, restaure et enregistre le mode clair/sombre. |
| `../modeStorage.ts` | Lecture/écriture du mode (`cn-theme`, comme avant). |

## Intégration au gabarit

- **Mode** : l'attribut `data-color-scheme` (`dark` | `light`) de `<html>`, comme le veut le gabarit. L'ancien `data-theme`
  portait le mode ; il désigne maintenant le thème visuel (`chambre-noire`). Le script anti-flash d'`index.html` pose les
  deux avant le premier rendu : sombre sauf si `localStorage['cn-theme'] === 'light'` (réglage système ignoré, comme avant).
- **Thème par défaut** : le registre retombe sur l'id `default` ; `src/themes/index.ts` écrit une fois
  `vx_visual_theme = 'chambre-noire'` quand rien n'est enregistré. Le thème `default` du gabarit reste enregistré (repli
  si le stockage est bloqué) ; comme `theme.css` est écrit sur `:root`, il a le même rendu.
- **MUI** : `ThemeModeProvider` construit un thème de palette seulement à partir des variables CSS ; `AppMuiTheme` pose
  par-dessus le thème complet (surcharges comprises) via un second `ThemeProvider`. Les composants partagés (`TipIconButton`,
  `Kbd`, `ConfirmHost`, `InfoTip`…) lisent la palette (`text.secondary`, `divider`, `action.hover`) : ils prennent le thème sans retouche.
- **Variables du gabarit** pointées sur les jetons : `--color-bg`, `--color-surface`, `--color-text`, `--color-text-muted`,
  `--color-border`, `--color-primary`, `--color-success`, `--color-danger`, `--color-warning`, `--accent-strong`
  (`:root[data-color-scheme]` l'emporte sur les règles de `colors.css`). Les pages du gabarit (administration, mentions)
  gardent leur en-tête, avec la palette de ce thème.

## Correspondance des jetons (ancien -> nouveau)

Valeurs identiques en sombre / clair (`:root`, `:root[data-color-scheme='dark']` / `[data-color-scheme='light']`).

| Ancien (`styles.css`) | Nouveau | Sombre | Clair | Usage MUI |
|---|---|---|---|---|
| `--bg` | `--bg` | `#0d0b0a` | `#f3eee6` | `palette.background.default`, corps |
| `--bg-elev` | `--bg-elev` | `#141110` | `#f8f4ee` | fond de la barre latérale (`MuiDrawer`, `Sidebar`) |
| `--surface` | `--surface` | `#191514` | `#fffcf7` | `palette.background.paper`, `Paper`, `Dialog`, champs |
| `--surface-2` | `--surface-2` | `#221d1b` | `#f1ebe2` | `Popover`/`Menu`, bouton bordé, survol de ligne |
| `--surface-3` | `--surface-3` | `#2c2624` | `#e7dfd4` | élément actif/survolé (`action.hover`/`selected`), rail du curseur, info-bulle |
| `--line` | `--line` | `#2f2826` | `#e2d9cd` | `palette.divider`, bordures fines |
| `--line-strong` | `--line-strong` | `#43392f` | `#cbbfae` | bordure de `Popover`/`Menu`/`Tooltip`, focus de champ |
| `--ink` | `--ink` | `#efe8e1` | `#1c1815` | `palette.text.primary` |
| `--ink-2` | `--ink-2` | `#c4b9af` | `#463d36` | texte de navigation, `palette.secondary` |
| `--muted` | `--muted` | `#8d827a` | `#776b61` | `palette.text.secondary`, icônes au repos |
| `--faint` | `--faint` | `#5e5550` | `#a69a8e` | `palette.text.disabled`, placeholders |
| `--safe` | `--safe` | `#ff5b37` | `#d8401f` | `palette.primary.main` (rouge inactinique) |
| `--safe-ink` | `--safe-ink` | `#1a0a05` | `#fff6f1` | `palette.primary.contrastText` |
| `--safe-soft` | `--safe-soft` | `color-mix(--safe 16%)` | `color-mix(--safe 11%)` | halo de focus du curseur, pastille primaire |
| `--safe-glow` | `--safe-glow` | `color-mix(--safe 45%)` | `color-mix(--safe 30%)` | sélection du texte (`::selection`) |
| `--ok` | `--ok` | `#8fc28a` | `#3f8a3a` | `palette.success.main` |
| `--warn` | `--warn` | `#f2b84b` | `#b7791f` | `palette.warning.main` |
| `--danger` | `--danger` | `#ff6b6b` | `#c43d3d` | `palette.error.main`, entrée de menu `data-danger` |
| `--tray` | `--tray` | `#070605` | `#e9e2d7` | classe `.cn-tray` (fond des vignettes vides) |
| `--shadow` | `--shadow` (conservé, **non utilisé**) | voir CSS | voir CSS | remplacé par des bordures (voir ci-dessous) |
| `--grain-opacity` | `--grain-opacity` | `0.05` | `0.035` | grain de film |
| `--font-sans` / `--font-display` / `--font-mono` | idem | Hanken Grotesk Variable / Instrument Serif / JetBrains Mono Variable | | `typography.fontFamily`, titres h1-h6, `ListSubheader`, `kbd` |
| `--animate-*` + `@keyframes` | idem | rise, fade, develop, breathe, shimmer, slide | | CSS, pour les écrans H4 |
| alias Tailwind `--color-bg`, `-surface`, `-surface-2`, `-surface-3`, `-line`, `-line-strong`, `-ink`, `-ink-2`, `-muted`, `-faint`, `-safe`, `-safe-ink`, `-safe-soft`, `-ok`, `-warn`, `-danger`, `-tray`, `-bg-elev` | idem (variables CSS simples) | | | utilisables dans `sx` |
| *(gabarit)* | `--color-text`, `--color-text-muted`, `--color-border`, `--color-border-strong`, `--color-primary`, `--color-primary-strong`, `--color-success`, `--color-warning`, `--accent-strong` | alias des jetons | | composants partagés, `ThemeModeProvider` |

Aides et classes de l'ancien `@layer components` :

| Ancien | Nouveau |
|---|---|
| `.panel` (fond, bordure, ombre) | `Paper` / `Dialog` : fond `--surface`, bordure `--line`, **sans ombre** |
| `.menu` | `Menu` / `Popover` : fond `--surface-2`, bordure `--line-strong`, rayon 14, marge intérieure 6, apparition en fondu 140 ms |
| `.menu-item` (+ `data-highlighted`, `data-danger`) | `MenuItem` (survol/focus `--surface-3`, `data-danger` en rouge), rayon 9, 13,5 px |
| `.eyebrow` | `.cn-eyebrow` (mono 10,5 px, 0,14 em, majuscules) ; `ListSubheader` a le même style |
| `.tray`, `.shimmer`, `.checker` | `.cn-tray`, `.cn-shimmer`, `.cn-checker` |
| Règles de `@layer base` (grain, `::selection`, `:focus-visible`, barres de défilement fines) | idem, dans `@layer base` (les styles de composants l'emportent toujours, comme les utilitaires avant) |

## Typographie

- Texte : Hanken Grotesk Variable (`font-feature-settings: "ss01", "cv11"`, lissage), 14 px.
- Titres (h1-h6, titres de dialogue) : Instrument Serif 400 ; marque de la barre latérale en italique 22 px.
- Code, raccourcis, intitulés de groupe : JetBrains Mono Variable.
- Les trois sont chargées par fontsource (`@fontsource-variable/hanken-grotesk`, `@fontsource-variable/jetbrains-mono`,
  `@fontsource/instrument-serif`, 400 et 400 italique), ajoutées par `front/package.local.json`.

## Rayons (échelle Tailwind de l'ancienne interface)

`shape.borderRadius = 6` (donc `sx={{ borderRadius: 2 }}` = 12 px). `radii` de `tokens.ts` : 6 (puces, `rounded-md`), 8 (boutons
icône, info-bulles, vignettes), 9 (entrées de menu), 12 (boutons, champs, lignes de liste, bascule de mode), 14 (menus,
popovers), 16 (dialogue de confirmation), 24 (dialogues).

## Bordures fines au lieu des ombres

`theme.shadows` vaut `'none'` partout ; `Paper` a `elevation: 0`. La profondeur vient de bordures de 1 px : `--line` (surfaces),
`--line-strong` (couches flottantes : menus, info-bulles, popovers). Exceptions voulues, qui ne sont pas des ombres de
surface : l'anneau de focus du curseur (`0 0 0 4px --safe-soft`), le halo du point « occupé » d'une conversation, les
contours internes `inset 0 0 0 1px` qui jouent le rôle de bordure (piste des onglets, rail du commutateur).

## Effet d'onde

`disableRipple` : `MuiButtonBase.defaultProps` (donc `Button`, `IconButton`, `Tab`, `ListItemButton`, `MenuItem`…), `Button`,
`IconButton`, `Tab`, `Switch`. Les états sont des changements de couleur/bordure (survol, actif). Focus clavier : anneau
2 px `--safe` décalé de 2 px (`:focus-visible` de l'ancienne interface, reproduit sur `.Mui-focusVisible`).

## Surcharges MUI

| Composant | Rendu repris de l'ancienne interface |
|---|---|
| `Button` | 36 px, rayon 12, 14 px/500, sans majuscules. `contained primary` = `--safe` + `--safe-ink`, survol `brightness(1.1)` ; `outlined` et `contained secondary` = fond `--surface-2`, bordure `--line` -> `--line-strong` au survol ; `contained error` = rouge à 15 % (25 % au survol) ; `text` = fantôme `--ink-2` -> `--ink`. |
| `IconButton` | 36 px (petit 28), rayon 8, `--muted` -> `--ink` sur fond `--surface-3` ; `colorError` : survol rouge doux. |
| `Dialog` | fond `--surface`, bordure `--line`, rayon 24 (16 pour `maxWidth="xs"`, la confirmation), hauteur max 720 px / 90 vh, voile noir 55 % flou 4 px, titre Instrument Serif 28 px. |
| `Popover` / `Menu` / `MenuItem` | voir `.menu` / `.menu-item` ci-dessus. |
| `Slider` | rail 4 px `--surface-3`, piste `--safe`, poignée 14 px bordée `--safe` sur fond `--surface`, grossit de 10 % au survol, halo `--safe-soft` au focus. |
| `Switch` | 36 x 20, rail `--surface-3` cerclé `--line`, coché `--safe` ; poignée blanche 16 px décalée de 2 px. |
| `Tooltip` | fond `--surface-3`, bordure `--line-strong`, rayon 8, 12 px, `6px 10px`, 6 px de l'ancre, délai 350 ms, fondu. |
| `TextField` / `OutlinedInput` | 36 px, rayon 12, fond `--surface`, bordure `--line`, focus `--line-strong` (1 px, pas d'anneau), placeholder `--faint`. |
| `Tabs` / `Tab` | commande segmentée : piste en creux (`--surface`, bordure `--line`, 4 px de marge), onglet actif = pastille `--surface-3` cerclée `--line-strong` qui glisse en 300 ms (`cubic-bezier(.2,.7,.2,1)`), icône de l'onglet actif en `--safe`. |
| `Chip` | 22 px, rayon 6, 12 px/500, `--surface-2` cerclé `--line` ; `primary`/`success`/`warning`/`error` en teinte douce sans bordure. |
| `LinearProgress` | 4 px, rayon plein, rail `--surface-3`, barre `--safe`. |
| `Paper` | `elevation: 0`, fond `--surface`, sans surcouche claire du mode sombre de MUI. |
| autres | `Backdrop`, `Divider`, `ListSubheader`, `ListItemButton`, `Snackbar`, `Alert`, `AppBar`, `Drawer`, `Link`, `Skeleton`, `CircularProgress`. |

## Grain de film

`body::after` : bruit SVG `feTurbulence` en image de fond, `position: fixed`, `pointer-events: none`, opacité `--grain-opacity`.
Seule différence : `z-index: 2000` (l'ancien 100 passait au-dessus des dialogues Radix, qui étaient à 60-81 ; les modales MUI sont à 1300 et
les info-bulles à 1500, le grain reste donc au-dessus de tout).

## Ajouter un thème

Créer `src/themes/<id>/` (CSS, `index.ts`, fabrique MUI), l'enregistrer dans `src/themes/index.ts` (`themeRegistry.register`) et dans
`src/themes/muiThemes.ts`.

## Écarts connus

- Le sélecteur de thème du gabarit (`UserAdminThemes`) n'est pas affiché : il n'y a qu'un thème.
- `<html lang>` reste `fr` (le gabarit ne le met pas à jour au changement de langue).
- Les composants partagés qui codent des tailles en dur (`Kbd` : 10 px) gardent leurs dimensions ; seule la police mono est imposée.
- Parité visuelle à valider à l'œil (aucun navigateur n'a été lancé pour H3) : voir la liste du compte rendu H3.
