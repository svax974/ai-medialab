# Module `i18n` (back)

## Rôle

Langue de l'interface côté Nest : la retient depuis `Accept-Language` et traduit les messages du serveur (`tr`). Vue d'ensemble du flux
(front, Nest, moteur) : `ARCHITECTURE.md`, section « Langue de l'interface ».

## Architecture

| Fichier | Rôle |
|---|---|
| `uiLanguage.ts` | `parseAcceptLanguage`, `noteUiLanguage`, `uiLanguage()` (dernière langue vue, `en` par défaut), `resetUiLanguage` (tests) |
| `tr.ts` | `tr(clé, valeurs?, langue?)` : message dans la langue courante (`{0}`, `{1}`), clé inconnue renvoyée telle quelle ; `loadDictionaries` fusionne `src/modules/*/i18n/*.<lang>.json` |
| `UiLanguageMiddleware.ts`, `I18nModule.ts` | Middleware sur toutes les routes, enregistré par `I18nModule` (importé par `AppModule`) |
| `messages.spec.ts` | Parité fr/en, mêmes variables, toute clé de `tr('…')` définie |

## Endpoints exposés

Aucun.

## Utilisation

- Dictionnaires : `back/src/modules/<module>/i18n/messages.fr.json` et `messages.en.json`, clés `<module>.<zone>.<nom>`.
- Jamais de concaténation de morceaux traduits : une phrase, des valeurs `{0}`.
- Les specs tournent en français (`src/testing/setupLanguage.ts`, déclaré dans `package.local.json`) ; un test en anglais appelle `resetUiLanguage('en')` puis restaure `'fr'`.
- Texte stocké en base : il garde la langue du moment ; ne pas le retraduire à l'affichage sans clé stockée.
