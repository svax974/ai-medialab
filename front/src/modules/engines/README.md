# Module `engines` (front)

## Rôle

Installation des moteurs d'inférence et de leurs modèles : cartes « Moteurs » (image : GGUF / stable-diffusion.cpp, MLX, PyTorch),
« Moteurs audio / vidéo » (packs, environnements Python isolés) et « Moteur de chat » (llama.cpp : installer, annuler, désinstaller) du dialogue Modèles, installation en un clic d'un moteur puis de son
modèle (`startSetup`), invite « à installer » d'un modèle (`SetupPrompt`) et carte d'accueil du premier lancement (`WelcomeSetup`),
avec progression (`ProgressBar` / `IndeterminateBar` de `common`), annulation et erreurs lisibles. L'installation tourne dans le moteur ;
Nest relaie les routes et les événements (`back/src/modules/engines/README.md`). Tâche H4.2.

## Structure

```
engines/
  index.ts                      exports
  types.ts                      états d'installation (définis dans `hardware`, qui décrit `GET /api/system`)
  services/enginesApi.ts        POST|DELETE /engines/pack/:id/install, DELETE /engines/pack/install, DELETE /engines/pack/:id,
                                POST|DELETE /engines/sdcpp/install, POST|DELETE /engines/llamacpp/install, DELETE /engines/llamacpp
  hooks/useEngineInstaller.ts   useInstallPack, useInstallSdcpp, useInstallLlamacpp, useCancelInstall, useUninstallPack, useUninstallLlamacpp (confirmation)
  hooks/useModelSetup.ts        startSetup, useInstallEvents, useSetupController, useEnginesSync
  hooks/useLocalAiSetup.ts      useLocalAiSetup : l'IA locale (llama.cpp + petit modèle de chat) en un seul flux réutilisable
  lib/localAi.ts                `deriveLocalAi` : état, tailles, disque, progression, erreur (pur, testé)
  lib/installState.ts           état en direct ou lu avec le système, lignes de moteurs et de packs, plan d'installation,
                                étape suivante (pur, testé)
  lib/setupLabels.ts            libellé du total à installer et du bouton (pur, testé)
  state/installStore.ts         états en direct des trois installateurs (packs, stable-diffusion.cpp, llama.cpp) + modèle en attente (Zustand)
  components/                   EnginesPanel, EnginesCard, PacksCard, LlamacppCard, InstallRow, SetupPrompt, WelcomeSetup, LocalAiProgress, LocalAiLaunchDialog
  state/localAiPromptStore.ts   « Ne plus me le proposer » (`cn-local-ai`, navigateur) et fermeture pour le lancement en cours
  lib/launchPrompt.ts           `shouldPromptLocalAi` : quand l'invitation est due (testé)
  locales/                      locales.fr.json, locales.en.json (clés engines.*)
```

## API publique

`EnginesPanel` (la carte de moteurs d'un onglet du dialogue Modèles ; passée à `ModelsDialog` par la coquille), `SetupPrompt({ model, welcome? })`
et `WelcomeSetup({ kind })` (pour les accueils des composeurs, H4.3+), `startSetup(model)`, `useEnginesSync()` (monté par la coquille),
`useInstallStore`, `enginesApi`, états d'installation.

## Moteur de chat (llama.cpp)

L'onglet « Modèles de chat » du dialogue montre `LlamacppCard` : installation (progression en octets par `engine.llamacpp.install`, annulation), désinstallation avec confirmation (les modèles téléchargés restent) et la raison quand
le moteur n'est pas installable ici. `startSetup` installe llama.cpp pour un modèle `backend: 'llamacpp'` qui en a besoin, puis télécharge le modèle (même enchaînement que pour stable-diffusion.cpp) ; `SetupPrompt` suit l'installateur de
llama.cpp pour ces modèles ; `relevantInstall(sd, pack, llama)` désigne l'installateur à suivre (un seul tourne à la fois).

## L'IA locale réutilisable (`useLocalAiSetup`)

Pour tout écran qui a besoin d'un modèle de chat local (le conseiller de mises à jour, une invite au lancement) : **`useLocalAiSetup(): LocalAiSetup`**
(`hooks/useLocalAiSetup.ts`, exporté avec `LocalAiProgress`, `deriveLocalAi`, `pickAdvisor`, `ADVISOR_MODEL_ID`, `DISK_MARGIN_GB`).

| Champ | Sens |
|---|---|
| `state` | `unknown` (catalogue ou machine pas encore lus), `ready` (llama.cpp et un modèle de chat — n'importe lequel — sont installés), `needs-setup`, `installing` (le moteur), `downloading` (le modèle), `error`, `no-space` (disque insuffisant) |
| `modelId`, `modelName` | le modèle qui sera installé : celui que le catalogue recommande (`llm.recommended_model_id`), sinon `llm-qwen3-4b-instruct-2507` |
| `engineInstalled`, `modelInstalled` | ce qui est déjà là |
| `engineSizeMb`, `modelSizeGb`, `neededGb` | ce qui reste à télécharger (0 quand c'est installé), total en Go |
| `freeGb` | espace disque libre (null si inconnu) ; `no-space` quand `neededGb + DISK_MARGIN_GB` (2 Go) dépasse l'espace libre : rien ne démarre |
| `progress` | `{ step: 'engine' \| 'model', done, total, rate?, eta?, message? }` de l'étape en cours |
| `error` | le message de l'échec (installateur ou téléchargement) ; `start` réessaie |
| `start({ withModel? })` | installe llama.cpp puis (`withModel`, défaut `true`) le modèle, par `startSetup` et `useSetupController` (flux existants) ; ne fait rien si c'est prêt, en cours, ou sans place |
| `cancel()` | arrête l'étape en cours et le téléchargement qui devait suivre |

`LocalAiProgress({ setup })` affiche l'étape, la barre (octets et débit, ou message de l'installateur), « Annuler » et l'erreur. Ce module ne dépend pas de `updates` :
l'invite du dialogue des mises à jour (`LocalAiInvite`) et toute autre modale l'utilisent. Le hook s'appuie sur `useEnginesSync`, monté une fois par la coquille.

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

## Invitation au lancement (`LocalAiLaunchDialog`)

À chaque lancement, tant que **llama.cpp n'est pas installé** (un modèle de chat seul manquant ne déclenche rien : la page Chat et la liste des modèles le proposent),
une fenêtre à fermer présente ce que l'IA locale apporte (Chat immédiat, mises à jour analysées avant installation, prompts améliorés par ✨, tout en local),
les tailles (moteur, modèle conseillé, espace libre), une case « télécharger aussi le modèle conseillé » (cochée), une case de l'hôte (`extraOption`, ici
« analyser automatiquement les risques des mises à jour », appliquée **à l'installation seulement**), l'installation avec sa progression (`useLocalAiSetup`,
`LocalAiProgress`) puis « Ouvrir le Chat ». « Plus tard » ou Échap la ferme jusqu'au prochain lancement ; la case « Ne plus me le proposer » (`optOut`) est
mémorisée dans le navigateur (`cn-local-ai`) et se retrouve dans les Réglages (interrupteur « IA locale au lancement »). Retenue pendant une session privée
(`suppressed`) et quand l'espace disque est insuffisant (message, installation désactivée). Montée une fois par `StudioShell`.
