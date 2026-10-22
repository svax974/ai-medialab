# Module `updates` (front)

## Role

"Check for updates" button at the foot of the sidebar and dialog that looks for updates of the **installed engines**
(stable-diffusion.cpp, audio.cpp, Python audio and video environments) in one section, and of the **installed models** in another,
for the three types (image, audio, video; filter All / Image / Audio / Video). "Update" per row, one button per section,
"Update all" at the bottom, progress bars on what is running. The search and the installation run in the engine; Nest
relays the routes (`back/src/modules/updates/README.md`, which also describes what counts as an update). Nothing is updated without a click.

**Advisor**: a small local chat model (installed by the flow of `useLocalAiSetup`, `engines` module) reads, on demand or after each check if "Automatic analysis" is enabled, the public sources of each update and reports known problems. The advice is
**saved** by Nest and shown first (even offline), then attached to the rows. It is advisory: a "not recommended" advice only asks for one more confirmation (which cites the findings), it never disables "Update".

## Structure

```
updates/
  index.ts                       exports
  types.ts                       search report, queue items
  services/updatesApi.ts         GET /updates/check, GET /updates/advisories, POST /updates/advise, DELETE /updates/advisories/:id, POST /updates/models/:id, POST /updates/engines/:id (body `{ target }`)
  hooks/useUpdatesCheck.ts       the search (mounted only while the dialog is open, forgotten on closing)
  hooks/useAdvisories.ts         the saved advice (local database: available without network)
  hooks/useAdvisor.ts            `useAdvisor(report)`: local AI installation, analysis queue and its runner (one at a time), automatic analysis
  hooks/useUpdateRunner.ts       runs the queue, one at a time (mounted by the shell)
  lib/updateItems.ts             rows visible per type, items to launch, state and progress read from the installers (pure, tested)
  lib/queue.ts                   queue, next to launch, launcher decision (pure, tested)
  lib/advice.ts                  analyses to launch, advice attached to its row, forgotten advice, not-recommended items, text of the findings (pure, tested)
  lib/adviceQueue.ts             analysis queue: chaining, progress, stop after a refusal that would repeat (pure, tested)
  lib/updatesKeys.ts             query keys (`check`, `advisories`)
  state/updatesStore.ts          dialog open + update queue (Zustand)
  state/adviceStore.ts           analysis queue (not persisted) and "Automatic analysis" preference (`cn-updates`)
  components/                    UpdatesDialog, UpdateSection, UpdateRow, AdviceBlock, AdviceSlot, LocalAiInvite, SavedAdvisories
  locales/                       locales.fr.json, locales.en.json (keys updates.*)
```

## Services

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/updates/check` | Installed engines and models, each `current`, `update` or (models) `error`. |
| `POST` | `/api/updates/models/:id` | Re-downloads the modified files of the model (`DownloadProgress`). |
| `GET` | `/api/updates/advisories` | The saved advice (`UpdateAdvisory[]`), from the most recent to the oldest. |
| `POST` | `/api/updates/advise` | Analyses the risks of an update `{ kind, id, target }` (about a minute); the advice is saved and returned. 409 `busy`, `no_model`, `no_engine`… with `code`. |
| `DELETE` | `/api/updates/advisories/:id` | Forgets an advice. |
| `POST` | `/api/updates/engines/:id` | Reinstalls the engine: `sdcpp` (`EngineInstallState`), `audiocpp` or a pack (`PackInstallState`); body `{ target: 'pinned' \| 'latest' }`. |

## Components

| Name | Description |
|---|---|
| `UpdatesDialog` | The dialog (opened by `useUpdatesStore.setOpen`): filter by type, summary, Engines section, Models section, note, "Update all". "Check again" re-runs the search. States: search in progress, error with "Retry". |
| `UpdateSection` | A card: title, button "Update engines / models (n)" (hidden when n = 0), rows or the text "none". |
| `AdviceBlock` | An advice: verdict badge (nothing notable / to watch / not recommended by the analysis), summary, collapsible findings (each with the quoted excerpt and its link, opened outside the application), what could not be read, "analysed on … with …", `stale` flagged, permanent reminder "Automatic advice, to be checked.", "Run the analysis again", "Forget this advice". |
| `AdviceSlot` | What a row says about its risks: the advice, or the analysis pending / in progress / failed (with "Retry"), or the button "Analyse risks (local AI)" (only when a local model is ready). |
| `LocalAiInvite` | Invitation to install the advisor (llama.cpp + recommended model) when updates are waiting and no local model is ready: sizes, checked disk space, progress and errors of `useLocalAiSetup`; nothing starts without a click. |
| `SavedAdvisories` | The saved advice, shown during the search or when it fails (offline). |
| `UpdateRow` | A row: status dot, name, types, what changed; depending on the state "Update", "Waiting", progress (bytes, or step of a pack), "Updated", error with "Retry", "Up to date". Secondary actions of an engine (hidden while the row is waiting, in progress or done): "Update to the latest version (untested)" with its warning, "Go back to the tested version"; the `advice` slot (`AdviceSlot`) and, under each action, its `extra` (the advice on the untested version). |

## Behaviour

- **The search** starts on opening and is never kept (`gcTime: 0`): the dialog never opens on a stale answer. It reads
  Hugging Face and GitHub (a few seconds); a network error of one model is the error of its row only.
- **One installer at a time** (model download, stable-diffusion.cpp, packs and audio.cpp each have a slot): the requested updates are **chained** by `useUpdateRunner`, which follows each through the events already relayed (`engine.download.progress`,
  `engine.engine.install`, `engine.pack.install`: `useDownloadStore` and `useInstallStore`, nothing is polled). The queue lives in
  `updatesStore`: closing the dialog does not stop it. A launch refused (already up to date, engine used by the loaded model, generation in progress, other
  download) fails that row with the engine's message; the others continue.
- **Untested version**: when upstream has a release newer than the installed one and than the pinned one, the engine row offers in addition to the tested
  update "Update to the latest version (untested)", with a static warning; if this release falls in a range of regressions
  documented in the repository (`KNOWN_REGRESSIONS` of the engine: effect and source), the warning cites them. The choice stays free but goes through `confirm()`
  (button "Install anyway", not red). Section buttons and "Update all" **never** launch an untested version.
- **Advice**: on opening, `useAdvisories` reads the local database; during the search or if it fails, `SavedAdvisories` shows them; once the
  search is read, each row already carries the advice of its version (merge done by Nest: `advice`, `latest.advice`). An analysis (`POST /advise`) stores its answer in the search cache without re-reading it (`attachAdvisory`). Analyses run **one at a time** (the engine loads a model): a refusal that would
  repeat (`busy`, `no_model`, `no_engine`) empties what was waiting; closing the dialog does too (the analysis in progress finishes, its result is saved).
  "Stop the analyses" empties the queue in the same way: the analysis running cannot be recalled.
- **Automatic analysis**: switch in the dialog (`cn-updates` in the browser, like the other interface preferences: the server never acts on it).
  Disabled by default, because it loads a model into memory. One pass per check: a failed analysis is not re-run by itself. It covers the tested release of each engine, its latest untested version and each model to update, without advice for the proposed version.
- **An advice blocks nothing**: if it is "not recommended" (critical finding or documented regression), "Update", the section buttons and "Update all"
  open one more `confirm()` that cites the findings ("Install anyway"); the untested version adds it to its warning. A stale advice (`stale`) triggers nothing.
- **Type filter**: it restricts the rows and therefore what the section buttons and "Update all" launch. An engine serving
  several types (stable-diffusion.cpp: image and video) appears in each.
- **End of queue**: the search is invalidated; the next opening re-reads the real state.

## Dependencies

`common` (`confirm`), `engines` (`useInstallStore`, installation states, `useLocalAiSetup`, `LocalAiProgress`), `model-catalog` (`useDownloadStore`, `useSizeLabel`, `Section`), `studio-shell` (`useT`,
`studioRequest`), `common` (`ProgressBar`, `TipIconButton`). The shell (`StudioShell`) mounts `useUpdateRunner` and `UpdatesDialog`;
the button is in `SidebarFooter`.

## Tests

```sh
cd front && npx vitest run src/modules/updates
```

Pure logic (visible rows, items to launch, outcome of an update read on each installer, queue and launcher decision),
store, fr/en parity and key usage, server rendering of the rows and sections in each state; `lib/advice.spec.ts` and `lib/adviceQueue.spec.ts` (analyses to launch, attaching and forgetting, not-recommended items, queue) and `components/advice.smoke.spec.ts` (advice, slot, invitation, saved advice in each state). The full dialog and the launcher are not
rendered (no DOM in the test loop): their logic is in `lib/`.
