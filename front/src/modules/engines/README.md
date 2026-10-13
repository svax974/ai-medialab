# Module `engines` (front)

## Rôle

Installation des moteurs d'inférence et de leurs modèles : cartes « Moteurs » (image : GGUF / stable-diffusion.cpp, MLX, PyTorch) et
« Moteurs audio / vidéo » (packs, environnements Python isolés) du dialogue Modèles, installation en un clic d'un moteur puis de son
modèle (`startSetup`), invite « à installer » d'un modèle (`SetupPrompt`) et carte d'accueil du premier lancement (`WelcomeSetup`),
avec progression (`ProgressBar` / `IndeterminateBar` de `common`), annulation et erreurs lisibles. L'installation tourne dans le moteur ;
Nest relaie les routes et les événements (`back/src/modules/engines/README.md`). Tâche H4.2.

## Structure

```
engines/
  index.ts                      exports
  types.ts                      états d'installation (définis dans `hardware`, qui décrit `GET /api/system`)
  services/enginesApi.ts        POST|DELETE /engines/pack/:id/install, DELETE /engines/pack/install, DELETE /engines/pack/:id,
                                POST|DELETE /engines/sdcpp/install
  hooks/useEngineInstaller.ts   useInstallPack, useInstallSdcpp, useCancelInstall, useUninstallPack (confirmation)
  hooks/useModelSetup.ts        startSetup, useInstallEvents, useSetupController, useEnginesSync
  lib/installState.ts           état en direct ou lu avec le système, lignes de moteurs et de packs, plan d'installation,
                                étape suivante (pur, testé)
  lib/setupLabels.ts            libellé du total à installer et du bouton (pur, testé)
  state/installStore.ts         états en direct des deux installateurs + modèle en attente (Zustand)
  components/                   EnginesPanel, EnginesCard, PacksCard, InstallRow, SetupPrompt, WelcomeSetup
  locales/                      locales.fr.json, locales.en.json (clés engines.*)
```

## API publique

`EnginesPanel` (la carte de moteurs d'un onglet du dialogue Modèles ; passée à `ModelsDialog` par la coquille), `SetupPrompt({ model, welcome? })`
et `WelcomeSetup({ kind })` (pour les accueils des composeurs, H4.3+), `startSetup(model)`, `useEnginesSync()` (monté par la coquille),
`useInstallStore`, `enginesApi`, états d'installation.

## Comportement

- **Installation en deux temps** : `startSetup(model)` installe d'abord le moteur manquant (pack ou stable-diffusion.cpp) en mémorisant le
  modèle en attente ; `useSetupController` lance son téléchargement dès que l'installation du moteur est `done`, et abandonne sur
  `error` ou `cancelled`. Avant de mémoriser le modèle, l'état de l'installateur est remis à zéro (un `done` ancien ne déclenche rien).
  Si le moteur est déjà installé, `startSetup` télécharge seulement le modèle.
- **Événements** : `engine.engine.install` (octets, message) et `engine.pack.install` (message, détail, début) alimentent `installStore` ;
  le front n'interroge rien. La fin d'une installation relit `['system']` et `['models']` (`studio-shell/lib/eventEffects.ts`). Un seul
  installateur tourne à la fois. Après une reconnexion, l'état en direct est vidé et l'état lu avec `GET /api/system` fait foi
  (le moteur rejoue aussi l'état courant à la connexion).
- **Cartes** : point d'état (disponible, installable, indisponible avec la raison du moteur), installer (≈ taille), annuler, désinstaller
  un pack (confirmation, attente de la suppression ; les modèles téléchargés sont conservés). Un pack appartient à l'onglet des modèles qui
  l'utilisent ; un pack sans modèle reste avec l'audio. MLX est masqué hors Mac.
- **`SetupPrompt`** : rien quand le modèle est prêt ; sinon « à installer : moteur ≈ X Mo + modèle ≈ Y Go », étapes « 1. Moteur / 2. Modèle »,
  bouton « Tout installer » / « Installer le moteur » / « Télécharger », « Annuler » pendant l'opération, barre de progression de l'étape en cours,
  erreur lisible. `welcome` : carte du premier lancement, avec le modèle recommandé pour la machine (`useWelcomeModel`) et « Choisir un autre modèle ».

## Correspondance avec l'ancienne interface

| Ancien (`frontend/src/`, supprimé en H6 : `git show 2435ab3:frontend/src/…`) | Nouveau |
|---|---|
| `components/Setup.tsx` : `ProgressBar`, `IndeterminateBar` | `ProgressBar`, `IndeterminateBar` de `common` (lot I) |
| `Setup.tsx` : `startSetup` | `hooks/useModelSetup` `startSetup` |
| `Setup.tsx` : `SetupController` | `useSetupController` (hook monté par la coquille) |
| `Setup.tsx` : `SetupPrompt`, `Steps` | `components/SetupPrompt` |
| `Setup.tsx` : `useWelcomeModel`, `WelcomeSetup` | `useWelcomeModel` (module `model-catalog`), `components/SetupPrompt` `WelcomeSetup` |
| `ModelsDialog.tsx` : `EnginesCard` | `components/EnginesCard` |
| `ModelsDialog.tsx` : `PacksCard` | `components/PacksCard` |
| `lib/store.ts` : `packInstall`, `engineInstall`, `pendingModelId` | `state/installStore` |
| `lib/queries.ts` : `engine.install`, `pack.install` | `hooks/useModelSetup` `useInstallEvents` |

## Tests

```sh
../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/engines/lib/installState.spec.ts   # un fichier à la fois
```

`lib/installState.spec.ts`, `lib/setupLabels.spec.ts`, `services/enginesApi.spec.ts`, `state/installStore.spec.ts`, `locales/locales.spec.ts`.
Le rendu des composants n'est pas testé.
