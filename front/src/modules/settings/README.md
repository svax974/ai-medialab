# Module `settings` (front)

## Role

**Settings** dialog of the studio (replaces the `ComingSoonDialog` of the shell), in three tabs: **General** (`GeneralSettings`, described below),
**Engines** (`ComponentsManager` of the `engines` module: state of the downloaded components, deletion) and **Models** (`ModelsManager` of the `model-catalog` module:
catalogue by category, state, deletion). Only the displayed tab is mounted. General: interface language, model memory (unloading delay),
previews, memory saving, optional Hugging Face token and reminder of the shortcuts. Each setting has its `InfoTip`. The
values are those of `GET/PUT /api/settings` (back: `back/src/modules/settings/README.md`). Task H4.1.

## Structure

```
settings/
  index.ts                  exports: SettingsDialog, HfTokenField, BraveKeyField, ChatVoiceField, useSettings, useSaveSettings, settingsApi, settingsKeys
  types.ts                  Settings, SettingsPatch
  services/settingsApi.ts   GET/PUT /api/settings (studioRequest)
  hooks/useSettings.ts      useSettings(enabled) (query), useSaveSettings(onSaved?) (mutation)
  lib/settingsConfig.ts     KEEP_ALIVE_OPTIONS, SHORTCUT_ROWS, SETTINGS_HELP, settingsKeys
  components/               SettingsDialog (tabs), GeneralSettings, LanguageField, KeepAliveControl, SettingsSection (SectionTitle, SectionText, SwitchRow), HfTokenField, BraveKeyField, ChatVoiceField
  locales/                  locales.fr.json, locales.en.json (keys settings.*)
```

Mounted by `StudioShell` (`settingsOpen` of the Zustand store); opened by the "Settings" button at the foot of the sidebar.

## Behaviour

- Loaded only when the dialog opens (`enabled`). States: loading (indicator), error with "Retry", content.
- Each change is saved immediately; the server response (complete public state) replaces the `['settings']` cache
  and the `['models']` catalogue is invalidated (the quantization changes what it displays). A refusal (422 unknown quantization,
  409 generation in progress) is shown as a message (react-toastify) and the display stays on the saved value.
- Token: write-only field; the server only says `has_hf_token` ("A token is saved", "Remove" button). Saving or removing shows a confirmation message. `HfTokenField` is also mounted by the models dialog (H4.2). `useSaveSettings` serves there for the choices of quantization (`quantize`) and variant (`variant`).

- **Language** (`LanguageField`): French or English (`LANGUAGE_OPTIONS`), the only place where the language is changed (`localeService.ensureLangLoaded` then `i18n.setLang`, choice remembered in the browser; `registerModuleLocales.ts` propagates `<html lang>` and the `Accept-Language` header). Without a remembered choice, `LocaleService` follows the system language (French, otherwise English): `front/src/config/config.ts` therefore has no `localeDefault`.
- **Local AI at launch**: switch (`SwitchRow`) bound to `useLocalAiPromptStore.optOut` of the `engines` module (browser, `cn-local-ai`): when enabled, the llama.cpp installation invitation is displayed at each launch as long as it is missing.
- **Brave Search key** (`BraveKeyField`, optional): secret field, saved by `PUT /api/settings { brave_api_key }` (`''` removes it); the server stores it encrypted and never returns it, only `has_brave_api_key`.
  It is used for the chat's web search (Brave instead of DuckDuckGo): `back/src/modules/settings/README.md`, `back/src/modules/chat/README.md`.
- **Default chat voice** (`ChatVoiceField`): a voice of the library **with a sample** (list of `voices`), saved by `PUT /api/settings { chat_voice_id }` (`''`: none). The chat's audio tool takes it when the request does not name one and the model requires one; otherwise the chat displays a choice card (`front/src/modules/chat/README.md`).

## Tooltips

Texts of `frontend/src/lib/help.ts` (removed in H6) (`keep_alive`, `previews`, `low_memory`) repeated identically in French
(`settings.help.*`), translated into English; `hfToken` is new (the old interface had none).

## Tests

One file at a time, from `front/`, under `scripts-local/guarded_run.sh 3`:

```sh
../scripts-local/guarded_run.sh 3 npx vitest run src/modules/settings/lib/settingsConfig.spec.ts
```

`lib/settingsConfig.spec.ts` (fr/en parity, defined keys, options), `services/settingsApi.spec.ts`. Component rendering
is not tested (Node environment).

## Correspondence with the old interface

| Old (`frontend/src/`, removed in H6: `git show 2435ab3:frontend/src/…`) | New |
|---|---|
| `components/SettingsDialog.tsx` | `components/SettingsDialog`, `KeepAliveControl`, `SettingsSection` |
| `components/ModelsDialog.tsx`: `TokenField` | `components/HfTokenField` (shown here and in the models dialog, H4.2) |
| `lib/help.ts`: `keep_alive`, `previews`, `low_memory` | `lib/settingsConfig.ts` `SETTINGS_HELP` + locales |
