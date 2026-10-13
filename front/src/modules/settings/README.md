# Module `settings` (front)

## Rôle

Dialogue **Réglages** du studio (remplace le `ComingSoonDialog` de la coquille) : mémoire du modèle (délai de déchargement),
aperçus, économie de mémoire, jeton Hugging Face facultatif et rappel des raccourcis. Chaque réglage a son `InfoTip`. Les
valeurs sont celles de `GET/PUT /api/settings` (back : `back/src/modules/settings/README.md`). Tâche H4.1.

## Structure

```
settings/
  index.ts                  exports : SettingsDialog, HfTokenField, useSettings, useSaveSettings, settingsApi, settingsKeys
  types.ts                  Settings, SettingsPatch
  services/settingsApi.ts   GET/PUT /api/settings (studioRequest)
  hooks/useSettings.ts      useSettings(enabled) (requête), useSaveSettings(onSaved?) (mutation)
  lib/settingsConfig.ts     KEEP_ALIVE_OPTIONS, SHORTCUT_ROWS, SETTINGS_HELP, settingsKeys
  components/               SettingsDialog, KeepAliveControl, SettingsSection (SectionTitle, SectionText, SwitchRow), HfTokenField
  locales/                  locales.fr.json, locales.en.json (clés settings.*)
```

Monté par `StudioShell` (`settingsOpen` du store Zustand) ; ouvert par le bouton « Réglages » du pied de la barre latérale.

## Comportement

- Chargement à l'ouverture seulement (`enabled`). États : chargement (indicateur), erreur avec « Réessayer », contenu.
- Chaque changement est enregistré aussitôt ; la réponse du serveur (état public complet) remplace le cache `['settings']`
  et le catalogue `['models']` est invalidé (la quantification change ce qu'il affiche). Un refus (422 quantification inconnue,
  409 génération en cours) s'affiche en message (react-toastify) et l'affichage reste sur la valeur enregistrée.
- Jeton : champ à écriture seule ; le serveur ne dit que `has_hf_token` (« Un jeton est enregistré », bouton « Retirer »).
  Enregistrer ou retirer affiche un message de confirmation. `HfTokenField` est aussi monté par le dialogue des modèles (H4.2). `useSaveSettings` y sert aux choix de quantification (`quantize`) et de variante (`variant`).

## Info-bulles

Textes de `frontend/src/lib/help.ts` (`keep_alive`, `previews`, `low_memory`) repris à l'identique en français
(`settings.help.*`), traduits en anglais ; `hfToken` est nouveau (l'ancienne interface n'en avait pas).

## Tests

Un fichier à la fois, depuis `front/`, sous `docs/migration/tools/guarded_run.sh 3` :

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/settings/lib/settingsConfig.spec.ts
```

`lib/settingsConfig.spec.ts` (parité fr/en, clés définies, options), `services/settingsApi.spec.ts`. Le rendu des composants
n'est pas testé (environnement Node).

## Correspondance avec l'ancienne interface

| Ancien (`frontend/src/`) | Nouveau |
|---|---|
| `components/SettingsDialog.tsx` | `components/SettingsDialog`, `KeepAliveControl`, `SettingsSection` |
| `components/ModelsDialog.tsx` : `TokenField` | `components/HfTokenField` (affiché ici et dans le dialogue des modèles, H4.2) |
| `lib/help.ts` : `keep_alive`, `previews`, `low_memory` | `lib/settingsConfig.ts` `SETTINGS_HELP` + locales |
