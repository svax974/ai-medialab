# Module `model-catalog` (front)

## Rôle

Dialogue **Modèles** du studio (remplace le `ComingSoonDialog` de la coquille) et sélecteur de modèle réutilisable par les
composeurs de H4.3+ : catalogue par type (image, audio, vidéo), téléchargement avec progression (octets, débit, temps restant),
annulation, suppression avec confirmation, choix de la quantification (variante) et de la précision (MLX), modèles
personnalisés (ajout depuis Hugging Face, retrait), recherche Hugging Face avec compatibilité et tenue en mémoire, jeton
Hugging Face. Le catalogue, les téléchargements et la recherche sont **calculés par le moteur** ; ce module les affiche et les pilote.
Back : `back/src/modules/model-catalog/README.md`. Installation des moteurs et packs : module `engines`. Tâche H4.2.

## Structure

```
model-catalog/
  index.ts                       exports (voir « API publique »)
  types.ts                       ModelInfo, ModelCatalog, DownloadProgress, HubResult, HubInspect... (formes du moteur)
  services/modelCatalogApi.ts    GET /models, POST|DELETE /models/:id/download, DELETE /models/:id, POST /models/custom,
                                 DELETE /models/:id/custom, GET /hf/search, GET /hf/inspect, GET /hf/trending
  hooks/useModelCatalog.ts       useModels, useActiveModel, useWelcomeModel, useRefreshCatalog, useStartDownload, useCancelDownload
  hooks/useModelUsage.ts         générations terminées par modèle (`GET /api/messages/model-usage`, clé `model-usage`, invalidée par `studio-core`)
  hooks/useModelActions.ts       supprimer / retirer (confirmation, attente de la libération, message)
  hooks/useHubSearch.ts          useDebouncedQuery, useHubSearch, useHubInspect, useAddCustomModel (répond l'id du modèle ajouté)
  hooks/useWhatsNew.ts           useWhatsNew, useRefreshWhatsNew (« Nouveautés » : modèles récents qui ont du succès)
  hooks/useDownloadEvents.ts     abonnement à engine.download.progress (monté par la coquille)
  hooks/useSizeLabel.ts          « 650 Mo » / « 4,5 Go » localisés
  lib/catalogFormat.ts           tailles, tri « installés d'abord », séparation générateurs/transcription, place disque,
                                 libellé du moteur, choix de précision, alternative GPU (pur, testé)
  lib/downloads.ts               téléchargement actif (direct > catalogue), erreur, mise à jour, analyse d'événement (pur, testé)
  lib/hubSearch.ts               compteurs, variante par défaut, blocage de l'ajout, tables de clés (pur, testé)
  lib/whatsNew.ts                âge, taille à télécharger, pastille « nouveau » (dernière ouverture par type, `localStorage` protégé) (pur, testé)
  lib/activeModel.ts             modèle actif d'un composeur, modèle de la carte d'accueil (pur, testé)
  lib/modelKind.ts               `modelKindOfMode` : le chat utilise les modèles `llm`, les autres modes leur type (pur, testé)
  lib/modelHelp.ts, modelCatalogKeys.ts
  state/downloadStore.ts         progression en direct par modèle (Zustand)
  state/modelSelectionStore.ts   modèle choisi par type (persisté sous `cn-models`)
  lib/modelsView.ts              `groupModelsByKind` (chat, audio, image, vidéo ; installés d'abord), `onDisk` (pur, testé)
  components/                    ModelsDialog, ModelsManager (onglet Modèles des Réglages : état et suppression par catégorie), ModelCard, ModelHeader, ModelActions, TempDownloadNote (téléchargement temporaire d'un modèle quantifié localement : total, part temporaire, taille sur disque), VariantPicker, QuantizeControl, HubSearch,
                                 ModelPicker, ModelBadges (VideoBadges, LlmBadges, LicenseWarning, GatedNotice, HelpTag), panels (Section, Tag, Notice),
                                 WhatsNewButton, WhatsNewDialog, WhatsNewRow
  locales/                       locales.fr.json, locales.en.json (clés models.*)
```

## API publique

`ModelsDialog` (monté par `StudioShell`, qui lui passe `onSetup` et `renderEngines` du module `engines` : le module ne dépend pas de
`engines`), `ModelPicker` (`<ModelPicker model={actif} usage? onSelect? />` : les plus utilisés d'abord selon `usage`, puis les autres
installés, puis le reste ; les modèles trop lourds pour la machine (`plan.fits` faux) masqués derrière « Afficher les modèles trop
lourds », sauf le modèle actif ; les composeurs passent par `StudioModelPicker` de `studio-core`, qui fournit `usage`), `useModelUsage`, `useModels`, `useActiveModel(kind)`, `useWelcomeModel(kind)`,
`WhatsNewButton` (`<WhatsNewButton kind />`, `kind` : `image`, `audio`, `video` ou `llm`), `useWhatsNew`, `useModelSelectionStore`, `useDownloadStore`, `activeDownload`, `modelCatalogApi`, `modelCatalogKeys`, `VideoBadges`, `LlmBadges`, `modelKindOfMode`, `LicenseWarning`,
`GatedNotice` (réutilisés par le composeur vidéo, H4.6), `MODEL_HELP` (info-bulles des badges, reprises par les avis du composeur vidéo), `Section`, `Tag`, `Notice`, types.

## Modèles de chat (`kind: 'llm'`)

Quatrième type, à côté d'image, audio et vidéo : les modèles de langage GGUF que le moteur exécute avec llama.cpp (`backend: 'llamacpp'`). Le dialogue a un onglet « Modèles de chat » (la carte du moteur au-dessus est celle de
llama.cpp, module `engines`) ; `ModelInfo.llm` (`LlmCaps` : contexte par défaut et maximal, vision, outils, raisonnement `none | toggle | always | levels`, MoE, paramètres) est montré par `LlmBadges` (carte et ligne du sélecteur) ;
la recherche Hugging Face passe `kind=llm` ; le catalogue porte un bloc `llm` (`default_model_id`, `recommended_model_id`, `ready`) lu par `resolveActiveModel` / `welcomeModel` ; la sélection (`cn-models`) a une entrée `llm`
(un état enregistré avant son existence n'en a pas : lue comme « aucune »). Le mode courant donne le type de l'onglet initial par `modelKindOfMode` (le chat → `llm`). L'usage (`useModelUsage`) ne compte que les générations
de médias : les modèles de chat ne sont pas classés par usage.

## Modèles de diagramme (`kind: 'diagram'`)

Cinquième type, pour l'onglet Diagrammes (module `diagram-studio`) : les **mêmes** modèles de langage GGUF que `kind: 'llm'`
(mêmes fichiers, aucun téléchargement dupliqué — voir `engine/app/engines/diagram_models.py`), sous un bloc `diagram` séparé
du catalogue (`default_model_id`, `recommended_model_id`, `ready`), un onglet « Modèles de diagramme » dédié. Contrairement
à `llm`, pas de recherche Hugging Face ni de bouton « Nouveautés » pour ce type (`HubSearch`/`WhatsNewButton` rendent `null`
pour `kind === 'diagram'`) : ce sont les mêmes modèles que le Chat, pas une famille Hugging Face à part.

## Comportement

- **Ouverture** : bouton « Modèles » de la barre latérale (`modelsOpen`) ; onglet initial = mode courant. « Chercher un modèle sur
  Hugging Face… » du sélecteur ouvre le dialogue sur ce type et met le champ de recherche au premier plan (`openModelSearch`).
- **Chargement** : le catalogue n'est lu qu'à l'ouverture (`enabled`) ; états : chargement, erreur avec « Réessayer », aucun modèle, contenu.
- **Progression en direct** : `engine.download.progress` alimente `downloadStore` (la progression continue dialogue fermé : carte
  d'accueil, composeurs). Fin du téléchargement (`done`, `error`, `cancelled`) et `engine.models.changed` invalident `['models']` et
  `['system']` (`studio-shell/lib/eventEffects.ts`). Après une reconnexion, la progression en direct est vidée : le catalogue
  (`download` en cours ou en erreur) fait foi.
- **Carte d'un modèle** : voir la liste de parité ci-dessous. Le bouton suit l'état : suppression en cours, annuler (téléchargement
  en cours), installer le moteur (+ modèle), utiliser / supprimer (installé), compléter / télécharger.
- **Quantification et précision** : enregistrées comme réglages `variant` et `quantize` (`useSaveSettings` du module `settings`, qui
  invalide le catalogue) ; télécharger une variante ne supprime pas les autres déjà installées (le réglage ne fait que choisir
  celle utilisée pour générer). Certains modèles MLX (ex. Qwen Image Edit) quantifient en local une seule fois à l'installation
  d'une variante (jamais relancé à chaque chargement) : la copie complète non quantifiée, nécessaire pour produire ces variantes,
  peut ensuite être libérée via `ModelActions` (bouton « Libérer la copie complète », visible dès qu'une variante quantifiée est
  installée) — `DELETE /api/models/:id/source/bf16`, voir `back/src/modules/model-catalog/README.md`.
- **Utiliser** : mémorise le modèle du type (`modelSelectionStore`), va à l'accueil du mode et ferme le dialogue. Les composeurs
  lisent `useActiveModel(kind)` (choix mémorisé, sinon le modèle installé le plus utilisé, sinon défaut du serveur, sinon premier du type ; jamais un modèle de transcription).
- **Recherche Hugging Face** : saisie temporisée 350 ms, résultats gardés 60 s, détail d'un dépôt gardé 5 min, aucun nouvel essai.
  Résultats incompatibles estompés ; variantes qui ne tiennent pas en mémoire estompées et **barrées** (infobulle = `fit_note`) ; la
  variante par défaut est une Q4_K qui tient, jamais une qui ne tient pas quand une autre tient ; l'ajout est bloqué si la machine ne
  peut pas faire tourner le modèle ou si la variante choisie ne tient pas. « Ajouter et télécharger » ajoute le dépôt puis démarre le téléchargement.
- **« Nouveautés » (`WhatsNewButton`)** : bouton à côté du sélecteur de modèle de chaque composeur (un seul point de montage :
  `StudioModelPicker` de `studio-core`, donc les pages image, audio et vidéo ; la page Chat le montera avec `kind="llm"`). Il ouvre une
  fenêtre (`WhatsNewDialog`) listant les modèles Hugging Face **récents** (30, 90 ou 180 jours), **qui ont du succès** et que **cette
  machine peut faire tourner**, calculés par le moteur sans IA (`engine/app/hf_trending.py` : signaux du Hub, seuils par type ; voir
  « Nouveautés » dans `back/src/modules/model-catalog/README.md`). Chaque ligne : nom, auteur, famille, variante proposée et taille
  à télécharger, âge, téléchargements 30 j, mentions « j'aime », licence (avertissement si non commerciale ou particulière),
  « Ajouter » (le flux de la recherche : `useAddCustomModel` avec la variante proposée, puis la barre de progression du téléchargement),
  « Variantes (n) » (le détail de la recherche, `Detail` de `HubSearch`, pour choisir la quantification) et le lien Hugging Face.
  États : chargement, vide (avec ce qui compte), erreur avec « Réessayer » ; « Actualiser » relit le Hub (le moteur garde une heure) ;
  les modèles trop lourds sont masqués derrière « Afficher aussi… (n) », comme dans le sélecteur. Une **pastille** sur le bouton
  signale des modèles publiés depuis la dernière ouverture de ce type (lue 3 s après l'affichage de la page, dernière ouverture gardée
  dans le navigateur : confort par visiteur, l'application marche sans).
- **Marqueur « lent · processeur »** (`plan.degraded`) : pastille sur la carte (infobulle = note du plan) ; l'alternative qui utilise le GPU
  est nommée par la note du moteur (`plan.note`) et, si la note ne la nomme pas, par une ligne dédiée.
- **Accès restreint** (`gated`) : encadré avec la marche à suivre, plus l'état du jeton (« Un jeton est enregistré. » / « Aucun jeton n'est enregistré. »).

## Info-bulles

Textes de `frontend/src/lib/help.ts` (supprimé en H6) repris à l'identique en français (`models.help.*` : `quantize`, `variant`, `seconds`, `resolution`,
`audio_out`, `english_only`, `license`), plus l'aide des tâches vidéo (`models.video.taskHelp.*`, de `VideoInfo.tsx`). Le titre de
`seconds` et de `resolution` est celui que l'ancien `VideoBadges` leur donnait (« Durée maximale d'un clip », « Définitions proposées »).

## Correspondance avec l'ancienne interface

| Ancien (`frontend/src/`, supprimé en H6 : `git show 2435ab3:frontend/src/…`) | Nouveau |
|---|---|
| `components/ModelsDialog.tsx` : `ModelsDialog`, `KindTabs` | `components/ModelsDialog` (MUI `Dialog`, `Tabs`) |
| `ModelsDialog.tsx` : `MachineCard`, chemins | module `hardware` (`MachineCard`, `StoragePaths`) |
| `ModelsDialog.tsx` : `ModelCard` | `components/ModelCard`, `ModelHeader`, `ModelActions` |
| `ModelsDialog.tsx` : `VariantPicker` | `components/VariantPicker` |
| `ModelsDialog.tsx` : précision MLX | `components/QuantizeControl` |
| `ModelsDialog.tsx` : `TokenField` | `HfTokenField` du module `settings` |
| `ModelsDialog.tsx` : `EnginesCard`, `PacksCard` | module `engines` (`EnginesPanel`) |
| `components/HubSearch.tsx` | `components/HubSearch`, `hooks/useHubSearch`, `lib/hubSearch` |
| `components/ModelPicker.tsx` | `components/ModelPicker`, `lib/catalogFormat` (`pickerModels` : ordre et masquage, `tooHeavy`, `pickerSize`) |
| `components/VideoInfo.tsx` | `components/ModelBadges` |
| `lib/queries.ts` : `useModels`, `useActiveModel`, évènements `download.progress`, `models.changed` | `hooks/useModelCatalog`, `hooks/useDownloadEvents`, `studio-shell/lib/eventEffects` |
| `lib/store.ts` : `downloads`, `modelId`, `audioModelId`, `videoModelId`, `modelsSearch` | `state/downloadStore`, `state/modelSelectionStore`, `studioStore.modelsSearchKind` |
| `lib/format.ts` : `formatModelSize`, `installedFirst` | `lib/catalogFormat` |
| `lib/api.ts` : routes des modèles et de Hugging Face | `services/modelCatalogApi` |

## Écarts avec l'ancienne interface

- Titre de confirmation : le composant `confirm()` du gabarit ne substitue pas de paramètre dans le titre ; le nom du modèle passe dans le
  message (« Supprimer ce modèle ? » / « « X » : libère ≈ N Go… »). Même chose pour le retrait d'un modèle et la désinstallation d'un pack.
- Les messages (`toast`) passent par react-toastify (gabarit) au lieu de sonner.
- Ajouts : état d'erreur du catalogue avec « Réessayer », message « Aucun modèle pour ce type. », état du jeton dans l'encadré « Accès restreint »,
  ligne d'alternative GPU quand la note ne la nomme pas.
- Le message d'un téléchargement refusé, d'un moteur indisponible (`engine_reason`) et les notes du plan viennent du moteur (français) : non traduits en anglais.

## Tests

Un fichier à la fois, depuis `front/` : `../docs/migration/tools/guarded_run.sh 3 npx vitest run src/modules/model-catalog/lib/catalogFormat.spec.ts`
(idem `downloads`, `hubSearch`, `whatsNew`, `activeModel`, `services/modelCatalogApi`, `state/stores`, `locales/locales`, `components/whatsNew.smoke`).
Logique pure et services simulés ; le rendu des composants se limite à un rendu serveur (sans DOM) de la ligne et du bouton « Nouveautés » :
la fenêtre (portail) n'est pas rendue en test. `locales.spec.ts` vérifie la parité fr/en, les marqueurs `{n}` et
que chaque clé `models.*` écrite dans les sources existe.
