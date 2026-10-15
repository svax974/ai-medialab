# Module `updates` (front)

## Rôle

Bouton « Vérifier les mises à jour » du pied de la barre latérale et dialogue qui cherche les mises à jour des **moteurs installés**
(stable-diffusion.cpp, audio.cpp, environnements Python audio et vidéo) dans une section, et des **modèles installés** dans une autre,
pour les trois types (image, audio, vidéo ; filtre Tout / Image / Audio / Vidéo). « Mettre à jour » par ligne, un bouton par section,
« Tout mettre à jour » en bas, barres de progression sur ce qui tourne. La recherche et l'installation tournent dans le moteur ; Nest
relaie les routes (`back/src/modules/updates/README.md`, qui décrit aussi ce qui compte comme une mise à jour). Rien ne se met à jour sans clic.

**Conseiller** : un petit modèle de chat local (installé par le flux de `useLocalAiSetup`, module `engines`) lit, à la demande ou après chaque
vérification si « Analyse automatique » est active, les sources publiques de chaque mise à jour et signale les problèmes connus. Les avis sont
**enregistrés** par Nest et restitués d'abord (même hors ligne), puis rattachés aux lignes. Ils sont consultatifs : un avis « déconseillé » demande
seulement une confirmation de plus (qui cite les constats), il ne désactive jamais « Mettre à jour ».

## Structure

```
updates/
  index.ts                       exports
  types.ts                       rapport de recherche, éléments de la file
  services/updatesApi.ts         GET /updates/check, GET /updates/advisories, POST /updates/advise, DELETE /updates/advisories/:id, POST /updates/models/:id, POST /updates/engines/:id (corps `{ target }`)
  hooks/useUpdatesCheck.ts       la recherche (monté seulement dialogue ouvert, oubliée à la fermeture)
  hooks/useAdvisories.ts         les avis enregistrés (base locale : disponibles sans réseau)
  hooks/useAdvisor.ts            `useAdvisor(report)` : installation de l'IA locale, file des analyses et son exécuteur (une à la fois), analyse automatique
  hooks/useUpdateRunner.ts       exécute la file, un à la fois (monté par la coquille)
  lib/updateItems.ts             lignes visibles par type, éléments à lancer, état et progression lus sur les installateurs (pur, testé)
  lib/queue.ts                   file, prochain à lancer, décision du lanceur (pur, testé)
  lib/advice.ts                  analyses à lancer, avis rattaché à sa ligne, avis oublié, éléments déconseillés, texte des constats (pur, testé)
  lib/adviceQueue.ts             file des analyses : enchaînement, progression, arrêt après un refus qui se répéterait (pur, testé)
  lib/updatesKeys.ts             clés de requête (`check`, `advisories`)
  state/updatesStore.ts          dialogue ouvert + file des mises à jour (Zustand)
  state/adviceStore.ts           file des analyses (non persistée) et préférence « Analyse automatique » (`cn-updates`)
  components/                    UpdatesDialog, UpdateSection, UpdateRow, AdviceBlock, AdviceSlot, LocalAiInvite, SavedAdvisories
  locales/                       locales.fr.json, locales.en.json (clés updates.*)
```

## Services

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/updates/check` | Moteurs et modèles installés, chacun `current`, `update` ou (modèles) `error`. |
| `POST` | `/api/updates/models/:id` | Retélécharge les fichiers modifiés du modèle (`DownloadProgress`). |
| `GET` | `/api/updates/advisories` | Les avis enregistrés (`UpdateAdvisory[]`), du plus récent au plus ancien. |
| `POST` | `/api/updates/advise` | Analyse les risques d'une mise à jour `{ kind, id, target }` (environ une minute) ; l'avis est enregistré et renvoyé. 409 `busy`, `no_model`, `no_engine`… avec `code`. |
| `DELETE` | `/api/updates/advisories/:id` | Oublie un avis. |
| `POST` | `/api/updates/engines/:id` | Réinstalle le moteur : `sdcpp` (`EngineInstallState`), `audiocpp` ou un pack (`PackInstallState`) ; corps `{ target: 'pinned' \| 'latest' }`. |

## Composants

| Nom | Description |
|---|---|
| `UpdatesDialog` | Le dialogue (ouvert par `useUpdatesStore.setOpen`) : filtre par type, résumé, section Moteurs, section Modèles, note, « Tout mettre à jour ». « Vérifier à nouveau » relance la recherche. États : recherche en cours, erreur avec « Réessayer ». |
| `UpdateSection` | Une carte : titre, bouton « Mettre à jour les moteurs / modèles (n) » (caché quand n = 0), lignes ou texte « aucun ». |
| `AdviceBlock` | Un avis : badge du verdict (rien de notable / à surveiller / déconseillé par l'analyse), résumé, constats repliables (chacun avec l'extrait cité et son lien, ouvert hors de l'application), ce qui n'a pas pu être lu, « analysé le … avec … », `stale` signalé, rappel permanent « Avis automatique, à vérifier. », « Relancer l'analyse », « Oublier cet avis ». |
| `AdviceSlot` | Ce qu'une ligne dit des risques : l'avis, ou l'analyse en attente / en cours / échouée (avec « Réessayer »), ou le bouton « Analyser les risques (IA locale) » (seulement quand un modèle local est prêt). |
| `LocalAiInvite` | Invitation à installer le conseiller (llama.cpp + modèle recommandé) quand des mises à jour attendent et qu'aucun modèle local n'est prêt : tailles, espace disque vérifié, progression et erreurs de `useLocalAiSetup` ; rien ne démarre sans clic. |
| `SavedAdvisories` | Les avis enregistrés, affichés pendant la recherche ou quand elle échoue (hors ligne). |
| `UpdateRow` | Une ligne : point d'état, nom, types, ce qui a changé ; selon l'état « Mettre à jour », « En attente », progression (octets, ou étape d'un pack), « Mis à jour », erreur avec « Réessayer », « À jour ». Actions secondaires d'un moteur (cachées tant que la ligne est en attente, en cours ou faite) : « Mettre à jour vers la dernière version (non testée) » avec son avertissement, « Revenir à la version testée » ; l'emplacement `advice` (`AdviceSlot`) et, sous chaque action, son `extra` (l'avis sur la version non testée). |

## Comportement

- **La recherche** part à l'ouverture et n'est jamais gardée (`gcTime: 0`) : le dialogue ne s'ouvre pas sur une réponse périmée. Elle lit
  Hugging Face et GitHub (quelques secondes) ; une erreur réseau d'un modèle est l'erreur de sa ligne seulement.
- **Un seul installateur à la fois** (téléchargement de modèle, stable-diffusion.cpp, packs et audio.cpp ont chacun un emplacement) : les mises à
  jour demandées sont **enchaînées** par `useUpdateRunner`, qui suit chacune par les événements déjà relayés (`engine.download.progress`,
  `engine.engine.install`, `engine.pack.install` : `useDownloadStore` et `useInstallStore`, rien n'est interrogé). La file vit dans
  `updatesStore` : fermer le dialogue ne l'arrête pas. Un lancement refusé (déjà à jour, moteur utilisé par le modèle chargé, génération en cours, autre
  téléchargement) fait échouer cette ligne avec le message du moteur ; les autres continuent.
- **Version non testée** : quand l'amont a une release plus récente que l'installée et que l'épinglée, la ligne du moteur propose en plus de la mise à jour
  testée « Mettre à jour vers la dernière version (non testée) », avec un avertissement statique ; si cette release tombe dans une plage de régressions
  documentée dans le dépôt (`KNOWN_REGRESSIONS` du moteur : effet et source), l'avertissement les cite. Le choix reste libre mais passe par `confirm()`
  (bouton « Installer quand même », pas de rouge). Les boutons de section et « Tout mettre à jour » ne lancent **jamais** une version non testée.
- **Avis** : à l'ouverture, `useAdvisories` lit la base locale ; pendant la recherche ou si elle échoue, `SavedAdvisories` les montre ; une fois la
  recherche lue, chaque ligne porte déjà l'avis de sa version (fusion faite par Nest : `advice`, `latest.advice`). Une analyse (`POST /advise`) range sa réponse
  dans le cache de la recherche sans la relire (`attachAdvisory`). Les analyses s'exécutent **une à la fois** (le moteur charge un modèle) : un refus qui se
  répéterait (`busy`, `no_model`, `no_engine`) vide ce qui attendait ; fermer le dialogue aussi (l'analyse en cours se termine, son résultat est enregistré).
  « Arrêter les analyses » vide la file de la même façon : l'analyse qui tourne ne peut pas être rappelée.
- **Analyse automatique** : interrupteur du dialogue (`cn-updates` dans le navigateur, comme les autres préférences d'interface : le serveur n'agit jamais dessus).
  Désactivée par défaut, car elle charge un modèle en mémoire. Un passage par vérification : une analyse échouée n'est pas relancée d'elle-même. Elle couvre la
  release testée de chaque moteur, sa dernière version non testée et chaque modèle à mettre à jour, sans avis pour la version proposée.
- **Un avis ne bloque rien** : s'il est « déconseillé » (constat critique ou régression documentée), « Mettre à jour », les boutons de section et « Tout mettre à jour »
  ouvrent un `confirm()` de plus qui cite les constats (« Installer quand même ») ; la version non testée l'ajoute à son avertissement. Un avis périmé (`stale`) ne déclenche rien.
- **Filtre par type** : il restreint les lignes et donc ce que les boutons de section et « Tout mettre à jour » lancent. Un moteur qui sert
  plusieurs types (stable-diffusion.cpp : image et vidéo) apparaît dans chacun.
- **Fin de file** : la recherche est invalidée ; la prochaine ouverture relit l'état réel.

## Dépendances

`common` (`confirm`), `engines` (`useInstallStore`, états d'installation, `useLocalAiSetup`, `LocalAiProgress`), `model-catalog` (`useDownloadStore`, `useSizeLabel`, `Section`), `studio-shell` (`useT`,
`studioRequest`), `common` (`ProgressBar`, `TipIconButton`). La coquille (`StudioShell`) monte `useUpdateRunner` et `UpdatesDialog` ;
le bouton est dans `SidebarFooter`.

## Tests

```sh
cd front && npx vitest run src/modules/updates
```

Logique pure (lignes visibles, éléments à lancer, issue d'une mise à jour lue sur chaque installateur, file et décision du lanceur),
store, parité fr/en et usage des clés, rendu serveur des lignes et sections dans chaque état ; `lib/advice.spec.ts` et `lib/adviceQueue.spec.ts` (analyses à lancer, rattachement et oubli, éléments déconseillés, file) et `components/advice.smoke.spec.ts` (avis, emplacement, invitation, avis enregistrés dans chaque état). Le dialogue complet et le lanceur ne sont pas
rendus (pas de DOM dans la boucle de tests) : leur logique est dans `lib/`.
