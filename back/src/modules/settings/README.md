# Module `settings`

## Role

**Source of truth for the studio settings** (formerly the `settings` table of the engine's database). They are declared as a template module configuration (default values seeded at startup, `hf_token` encrypted), exposed by `GET/PUT /api/settings` (same URL and same public shape as the former engine route) and **passed to the engine** at startup and at each change. Application module. Task H4.1.

## Architecture

| Type | File | Description |
|---|---|---|
| Module | `SettingsModule.ts` | Imports `CommonModule`, declares the controller and the services, exports `SettingsService`. |
| Schema | `configSchema.ts` | `settingsConfigSchema` (moduleId `studio`). |
| Controller | `controllers/SettingsController.ts` | `GET/PUT /api/settings` (administrator, `local-trust` included; plain JSON, `NoTransportCrypt`). |
| Service | `services/SettingsService.ts` | Read (defaults if absent), update (validation, sending to the engine, saving), `pushToEngine()`. Calls are serialized. |
| Service | `services/SettingsEngineSync.ts` | Sends the state to the engine at startup and at each reconnection of the event stream (`EngineEventRelay.linkChanges$`). |
| Pure functions | `services/settingsPatch.ts` | `parseSettingsPatch` (422 on a wrong type), `applyPatch` (merging of the per-model maps), `toPublic`, `DEFAULT_SETTINGS`. |
| Service | `services/SettingsConfigRegistration.ts` | `OnApplicationBootstrap`: `moduleConfigService.register(schema)`. |
| Mapping | `legacySettings.ts` | `LEGACY_SETTING_KEYS`, `mapLegacySettings()` (used by the importer). |
| Types | `types/settingsTypes.ts` | `StudioSettings`, `PublicSettings`, `SettingsPatch`. |

Labels: `back/src/locales/custom.fr.json` and `custom.en.json` (keys `custom.settings.*`).

## Dependencies

`common`: `ModuleConfigService`, `ConfigurationService` (table `config`). `engine`: `EngineClient` (typed), `EngineEventRelay`, `engineErrorToHttp`. `legacy-import` calls `SettingsService.pushToEngine()` after importing the settings from the former database.

## Exposed endpoints (exhaustive)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/settings` | Admin | Public settings: `keep_alive_minutes`, `previews`, `low_memory`, `memory_limit_gb`, `quantize`, `variant`, `has_hf_token`, `has_brave_api_key`, `chat_voice_id`. Secrets are **never** returned. |
| `PUT` | `/api/settings` | Admin | Subset of the same keys + `hf_token` and `brave_api_key` (text of 512 characters at most; `''` removes it); `chat_voice_id`: id of a library voice (text of 512 characters at most, `''`: none). Returns the public state. |

`PUT` errors: 422 if a type is wrong (`keep_alive_minutes` integer from -1 to 1440, `memory_limit_gb` a number from 0 (automatic) to 4096, booleans, maps `model_id -> integer|null` and `model_id -> text`); 422 relayed from the engine (unknown model or quantization); 409 relayed from the engine (changing the quantization of the loaded model during a generation). In these cases **nothing is saved**.

## Passing settings to the engine

The engine no longer reads these settings from its database: Nest sends it the **complete** state through `PUT /engine/v1/runtime/settings` (route reserved to Nest, protected by `X-Engine-Token`):

1. at startup (`SettingsEngineSync.onApplicationBootstrap`), then at each (re)connection of the event stream (the engine may have restarted and lost its memory);
2. after the import of the settings from the former database (`LegacyImportBootstrap`);
3. at each `PUT /api/settings`: the engine validates **before** saving (it knows the models).

If the engine is unreachable at the time of a `PUT`, the values are saved (the engine's validation is then skipped) and sent at the next connection; a late refusal is logged. As long as Nest has sent nothing, the engine applies its default values (`DEFAULT_SETTINGS` in `engine/app/jobs.py`); it never writes them to disk (the Hugging Face token is among them).

## Entities

None (table `config` of `common`).

| Configuration key | Former key | Type | Default | Role |
|---|---|---|---|---|
| `studio_keepAliveMinutes` | `keep_alive_minutes` | number | 10 | Inactivity before unloading the model; -1 never, 0 after each generation. |
| `studio_memoryLimitGb` | `memory_limit_gb` | number | 0 | Ceiling (GB) for the models loaded together; 0 = automatic (80 % of the machine); the engine never goes above what its safety reserve leaves (`engine/app/memory_budget.py`). |
| `studio_previews` | `previews` | boolean | true | Intermediate previews of the images. |
| `studio_lowMemory` | `low_memory` | boolean | true | Frees the text encoder after the prompt is encoded. |
| `studio_quantize` | `quantize` | json (masked) | `{}` | `model_id` to quantization bits (written by the models dialog, H4.2). |
| `studio_variant` | `variant` | json (masked) | `{}` | `model_id` to quantization variant (H4.2). |
| `studio_hfToken` | `hf_token` | `secret` | empty | Hugging Face token (restricted-access models), encrypted. |
| `studio_braveApiKey` | `brave_api_key` (no former key) | `secret` | empty | Brave Search API key for the chat's web search tool (without a key, DuckDuckGo); encrypted. **Stays in Nest**: it is not sent to the engine (`SettingsService.push` drops it, type `EngineSettings`), and `SettingsService.braveApiKey()` gives it to the `chat` module. |
| `studio_chatVoiceId` | `chat_voice_id` (no former key) | `string` (masked) | empty | Library voice with which the chat's audio tool speaks when none is named and the model requires one (`CreationToolsService`). **Stays in Nest**: `SettingsService.push` drops it (type `EngineSettings`). Chosen in the settings dialog (`ChatVoiceField`). |

The values remain readable and editable through the `common` administration routes (`GET`/`PUT /api/v1/admin/module-configs/studio`); a change made there is **not** passed to the engine before the next startup or the next reconnection (known limitation).

## Extension points

- A new setting: a field of the schema, a key in `LEGACY_SETTING_KEYS` if the former database held it, `StudioSettings`, `parseSettingsPatch`, the engine's `RuntimeSettings` (`engine/app/api/runtime.py`), then `npm run engine:types`.

## Tests

One file at a time, from `back/`, under `scripts-local/guarded_run.sh 3`:

```sh
npx jest --runInBand src/modules/settings/services/settingsPatch.spec.ts
```

`services/{settingsPatch,SettingsService,SettingsEngineSync}.spec.ts` (fake engine HTTP server, simulated module configuration), `controllers/SettingsController.spec.ts`, `legacySettings.spec.ts`. Engine side: `engine/tests/test_runtime_settings.py`.

**Language.** Patch validation errors follow the interface language (`Accept-Language`): texts in `i18n/messages.{fr,en}.json`, read by `tr()` (`src/modules/i18n`).
