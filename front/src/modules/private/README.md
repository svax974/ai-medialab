# Module `private` (génération privée, interface)

## Rôle

Le mode « Génération privée » vu du navigateur : le bouton de la barre latérale, le bandeau et le cadre colorés qui disent
qu'on est en mode privé, le routage des requêtes du studio vers les routes privées de Nest (module `private` du back, voir son
README pour l'audit complet de ce qui est ou n'est pas gardé), et surtout ce qui empêche l'interface elle-même d'écrire un
contenu dans le navigateur (`localStorage`).

Le mode n'est **jamais persisté** : une page qui s'ouvre démarre toujours en mode normal, et efface la session privée qu'une
page précédente aurait laissée (rechargement, fermeture sans avertir le serveur).

## Structure

```
index.ts                      PrivateBanner, PrivateHost, PrivateToggle, usePrivateSession, privacyStorage, registerPrivacyStore, privatePath, isPrivateMode, usePrivateStore
types.ts                      PrivateSessionInfo (`GET /api/private/session`)
state/privateStore.ts         drapeau `active` (jamais persisté), `busy`, `info` ; `isPrivateMode()` pour le code hors React
lib/privateRouting.ts         `privatePath` (routes du studio → `/private/…`), `isPersistingRequest` (écritures refusées : voix, conversations du chat persistant), `isLibraryListing` (galerie vide)
lib/privateChatMemory.ts      la mémoire du chat privé (conversations, fichiers envoyés, réponses en cours) et le registre des nettoyages de fin de session ; vidée à chaque transition
lib/privacyStorage.ts         `localStorage` des stores qui gardent du contenu : ni lu ni écrit en session privée ; registre, vidage et relecture
lib/privateTransition.ts      vidage des caches du côté quitté (conversations, listes, visionneuse, progression, file)
lib/privateSession.ts         `enterPrivate`, `leavePrivate`, `eraseNow`, `leaveLocally`
lib/ttl.ts                    minutes d'inactivité annoncées par le serveur
services/privateApi.ts        `/api/private/session` (info, ouvrir, terminer, balise de sortie)
hooks/usePrivateSession.ts    entrer / quitter / tout effacer, avec les confirmations et la navigation
hooks/usePrivateEvents.ts     sujet `private.changed` : relecture de ce qui a changé ; session terminée par le serveur → retour au mode normal
hooks/usePrivateGuards.ts     session orpheline effacée au démarrage, avertissement avant fermeture s'il y a des résultats, `sendBeacon` à la fermeture
components/                   PrivateToggle (pied de la barre latérale), PrivateBanner, PrivateHost (cadre et attribut `data-private`)
locales/                      fr, en
```

## Services

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/private/session` | État de la session (sans contenu). |
| `POST` | `/api/private/session` | Ouvre la session. |
| `DELETE` | `/api/private/session` | La termine et efface tout. |
| `POST` | `/api/private/session/leave` | Balise (`sendBeacon`) à la fermeture de la page. |

Pendant la session, `studioRequest` et `studioUpload` (module `studio-shell`) appellent `/api/private` + le chemin pour
`/conversations`, `/messages` (sauf `/messages/model-usage`), `/queue`, `/assets` et, pour le chat, `/chat/attachments` et `/chat/enhance-prompt` ; refusent (409, code `private`) toute
écriture vers `/voices` et `/chat/conversations` (le chat privé n'en a pas besoin : sa conversation est celle de la page, `chat/services/privateChatBackend.ts`) ; ne demandent pas la liste des assets (galerie vide).

## Entrer, sortir (ordre qui compte)

- **Entrer** : le drapeau passe à vrai AVANT tout ; les composeurs sont vidés (en mémoire seulement : les écritures sont ignorées) ;
  les caches du côté normal sont supprimés ; le serveur ouvre la session ; en cas d'échec tout revient.
- **Sortir** : le serveur efface ; les composeurs sont vidés pendant que le drapeau est encore vrai, le drapeau passe à faux, puis
  les stores relisent `localStorage` (qui n'a jamais été touché) : les brouillons d'avant reviennent. Vider un store APRÈS avoir baissé
  le drapeau écraserait les brouillons (un test le garde).

Stores concernés (`registerPrivacyStore` + `storage: privacyStorage()`) : `useImageDraftStore`, `useVideoDraftStore`,
`useAudioDraftStore`, `useChatDraftStore`, `useChatDefaultsStore`. Gardés tels quels, sans contenu : `cn-prefs` (barre latérale
ouverte), `cn-models` (modèle choisi par type), le thème et la langue.

## Composants

| Nom | Description |
|---|---|
| `PrivateToggle` | Bouton « Génération privée » (cadenas) du pied de la barre latérale ; infobulle qui dit ce qui est et n'est pas gardé ; confirmation à l'entrée (garanties et limites) et à la sortie. |
| `PrivateBanner` | Bandeau collant en haut de la page : « rien n'est enregistré », nombre de résultats en mémoire, « Tout effacer maintenant », « Quitter ». Rappelle sur les pages galerie et bibliothèques qu'elles sont vides en privé. |
| `PrivateHost` | Monté une fois dans `StudioShell` : garde-fous, évènements, cadre violet autour de la fenêtre (jamais cliquable), `data-private` sur `<html>`. |

## Dépendances

`studio-shell` (`studioRequest`, `studioHttp`, `queryKeys`, `useT`, routes), `studio-core` (stores de progression et de file, `messagesApi`),
`media-library` (visionneuse, clés d'assets), le gabarit (`confirm`, `eventStreamClient`). `studio-shell`, `studio-core` et `chat` importent à leur tour
`lib/privateRouting`, `state/privateStore` et `lib/privacyStorage` (chemins profonds, sans cycle de fichiers).

## Garanties et limites

Voir le README du module back `private` (audit, garanties, limites). Côté interface : rien n'est écrit dans `localStorage` pendant la
session ; la progression, la file et les listes sont en mémoire ; un fichier affiché est servi `no-store`. Fermer la fenêtre sans
confirmation efface la session au mieux (`sendBeacon`) ; le serveur l'efface de toute façon après le délai d'inactivité.

## Tests

`lib/privateRouting.spec.ts`, `lib/privacyStorage.spec.ts` (stores réels, `localStorage` simulé avec une phrase témoin : jamais écrite, brouillons rendus
intacts), `lib/privateSession.spec.ts` (entrée, échec, sortie, serveur injoignable, tout effacer), `lib/privateHttp.spec.ts` (routage, refus, galerie vide).
Rien n'a été vu dans un navigateur.

## Chat privé

La conversation d'un chat privé est tenue par la page (`chat/services/privateChatBackend.ts`, documenté dans `front/src/modules/chat/README.md`, « Chat en session privée ») ; ce module n'en garde que
la **mémoire** (`lib/privateChatMemory.ts` : conversations, fichiers envoyés, flux en cours) et le **registre des nettoyages** (`registerPrivateCleanup`, utilisé par le chat, le texte « envoyé vers »…) :
`dropStudioCaches` appelle `forgetPrivateChats()` à chaque entrée, sortie, « tout effacer » ou retour local, ce qui abandonne les flux, vide la mémoire et lance les nettoyages.
Supprimer une conversation de la liste appelle `forgetPrivateChat(id)` (`studio-shell/hooks/useConversations.ts`). Les textes de confirmation d'entrée disent que le chat est privé aussi, que la conversation
reste dans la page, que la recherche web du chat reste éteinte tant qu'on ne l'allume pas, et que le texte d'une synthèse vocale passe par la ligne de commande du programme de calcul.
