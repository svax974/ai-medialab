# Module `i18n` (back)

## Role

Interface language on the Nest side: it retains it from `Accept-Language` and translates the server messages (`tr`). Overview of the flow
(front, Nest, engine): `ARCHITECTURE.md`, section "UI language".

## Architecture

| File | Role |
|---|---|
| `uiLanguage.ts` | `parseAcceptLanguage`, `noteUiLanguage`, `uiLanguage()` (last language seen, `en` by default), `resetUiLanguage` (tests) |
| `tr.ts` | `tr(key, values?, language?)`: message in the current language (`{0}`, `{1}`), unknown key returned as is; `loadDictionaries` merges `src/modules/*/i18n/*.<lang>.json` |
| `UiLanguageMiddleware.ts`, `I18nModule.ts` | Middleware on all routes, registered by `I18nModule` (imported by `AppModule`) |
| `messages.spec.ts` | fr/en parity, same variables, every key of `tr('…')` defined |

## Exposed endpoints

None.

## Usage

- Dictionaries: `back/src/modules/<module>/i18n/messages.fr.json` and `messages.en.json`, keys `<module>.<zone>.<name>`.
- Never concatenate translated fragments: one sentence, with values `{0}`.
- Specs run in French (`src/testing/setupLanguage.ts`, declared in `package.local.json`); an English test calls `resetUiLanguage('en')` then restores `'fr'`.
- Text stored in the database keeps the language of the moment; do not re-translate it at display time without a stored key.
