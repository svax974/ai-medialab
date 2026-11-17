# Local 3D generation

Approved scope: a 3D studio alongside image, audio and video, accepting a text description or an image,
with predefined Hugging Face open-weight models: Shap-E, TripoSR, TripoSG, TRELLIS, TRELLIS.2 and Stable Fast 3D.
Implementation is delegated to GPT-6.1-Terra agents, with integration and verification coordinated by the root agent.

## Contracts and ownership

- Use `mesh` as the model kind, conversation mode and generated asset kind. GLB is the primary downloadable result.
- Reuse Nest conversations, messages, generation queue, assets, cancellation, retry and server events. The engine
  receives a complete job and holds no application history. The browser only calls Nest.
- Keep the shared memory budget, isolated model workers, preflight refusal, watchdog and emergency stop.
- Model capabilities distinguish direct text conditioning from image conditioning. An image-only model must not
  silently treat text as supported. Direct text generation is provided by Shap-E and TRELLIS text variants.
- Preserve existing media and conversations. Additive schema changes require portable SQLite/PostgreSQL migrations.
- Resolve actual platform compatibility before installation: native CUDA dependencies are not assumed to work on MPS.
  Show actionable incompatibility and licence/access notices in the catalogue and composer.

## Implementation workstreams

1. **Engine** (`mesh_engine`): official upstream review; model specifications and capabilities; isolated runtime
   installation; adapters; job planning; mesh output events and media handling; fake-runtime tests; OpenAPI export.
2. **Nest** (`mesh_backend`): input validation, queue request and output persistence, file relay, migrations where
   necessary, validation traces and registry, module contracts and fake-engine tests.
3. **Interface** (`mesh_frontend`): 3D tab and route, composer and image upload, model installation/selection,
   conversation adapter, live status/cancellation/retry, GLB preview/download, French/English translations and tests.
4. **Integration** (root): reconcile contracts, regenerate engine TypeScript types and package manifests, review
   dependency/licence registry and documentation, run guarded checks sequentially, repair cross-layer regressions.

## Delivery and verification

No model weights, inference process or development server is started during implementation. Tests use fake runtimes
and small fixture meshes; they cover input/task rejection, generated asset handling, cancellation and existing modes.
Heavy checks run one at a time through the memory guard, after inspecting machine pressure. Verify engine contract,
backend/frontend types, targeted tests, locales, theme colours, lint and registry consistency. Real inference and
browser rendering remain explicitly unverified until observed; do not equate mocked tests with model quality.

Last verified against source: 2026-11-17 (implementation plan; completion tracked in the delivery report).
