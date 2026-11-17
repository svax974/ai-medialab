# Mesh studio

The 3D studio creates one GLB per conversation message from text or a single image reference, according to the selected model's capabilities. The catalog supplies platform compatibility, settings, installation and gated repository IDs; the composer links each required license to its Hugging Face repository; the existing Nest queue supplies status, cancellation, retries and history. Creation is disabled in private mode. Drafts are held only in memory and cleared on private-session transitions.

`meshStudio.tsx` provides the home and composer, `meshStudioAdapter.tsx` connects the conversation, `meshDraft.ts` keeps the in-memory draft; `composerRules.ts` validates inputs and builds the message, `MeshAssistant.tsx` renders queue controls and results, and `MeshPreview.tsx` owns the viewer lifecycle. The renderer downloads the GLB through Nest, rejects external URIs and compressed formats requiring remote decoders, and displays a self-contained blob using `@google/model-viewer`. The original remains available for download even when preview validation fails. The component uses theme tokens and English/French locales.

The composer uses existing `POST /api/assets` and `POST /api/messages` services. Conversation loading, retry, cancellation and deletion use the existing studio services documented in `studio-core` and `studio-shell`; no engine endpoint is contacted from the browser.

`composerRules.spec.ts` covers text, image, private and busy request rules; `render.smoke.spec.ts` checks composer controls without a browser or a viewer; `validateGlb.spec.ts` covers bounded container parsing and unsafe resources.
