# Contributing to AI MediaLab

Thanks for your interest. The project is a local, single-user application; contributions are welcome through issues and pull
requests.

## Before you start

- Read [ARCHITECTURE.md](ARCHITECTURE.md) (processes, contracts, flows, and the map of the documentation) and the `README.md`
  of the module you touch. Setup and test commands are in [docs/guide.md](docs/guide.md).
- Open an issue first for anything larger than a fix, so the direction can be agreed.

## Rules that matter

- **Layout**: the NestJS server (`back/`) owns the application and its data; the Python engine (`engine/`) only runs models and
  holds no application state; the browser talks to NestJS only. After changing an engine route or model, regenerate the contract
  (`engine/.venv/bin/python scripts-local/export_engine_openapi.py`, then `cd back && npm run engine:types`).
- **Entities**: every Nest entity change comes with a migration (`back/src/migrations/README.md`).
- **Memory**: model inference can exhaust the unified memory of a Mac and crash the machine. Run tests **one file at a time**,
  never the whole suite, never a real model (details and ceilings in [docs/guide.md](docs/guide.md), "Tests").
- **Language**: code, comments and documentation in English. UI texts go through the locale files (`fr` and `en`);
  `npm run i18n:check` in `front/` must pass.
- **Documentation**: one fact, one place. A changed module updates its README in the same commit, a feature its section of
  `FEATURES.md`, a change of shape `ARCHITECTURE.md`.
- **Style**: strong typing (no `any`), functions under ~40 lines, [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`…).
- **Files**: every new source file starts with the MIT header used in the neighbouring files.

## Licensing of contributions

The project is under the [MIT License](LICENSE). By submitting a contribution you agree to license it under the same terms.
Do not add code, assets or models whose licence is incompatible, and do not commit model weights. A new third-party component is
recorded in `THIRD_PARTY_LICENSES.md` and `docs/components/README.md`.

## Checks before a pull request

```sh
cd back  && npx tsc --noEmit -p tsconfig.json && npx jest --runInBand <file>
cd front && npx tsc -p tsconfig.app.json && npx vitest run <file> && npm run i18n:check && npx eslint src
cd engine && .venv/bin/python -m pytest -q -x -p no:cacheprovider tests/<file>
```
