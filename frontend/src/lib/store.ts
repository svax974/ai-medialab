// État client (zustand) : brouillon du composer, préférences, progression temps réel, visionneuse.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Asset, DownloadProgress, EngineInstallState, EngineStatus, GenParams, JobProgress, ModelKind, PackInstallState, VoiceRef,
} from "./api";

export interface PendingUpload {
  tempId: string;
  previewUrl: string;
  name: string;
}

export type Theme = "dark" | "light";

interface LightboxState {
  items: Asset[];
  index: number;
}

export interface VoiceStudioState {
  /** Fichier audio déposé / choisi à l'ouverture. */
  file?: File;
  /** Voix existante à modifier. */
  voiceId?: string;
}

interface State {
  // Mode : images ou audio (commutateur du panneau de gauche)
  mode: ModelKind;
  setMode: (m: ModelKind) => void;

  // Composer audio
  audioPrompt: string;
  audioModelId: string | null;
  voiceByModel: Record<string, VoiceRef | undefined>;
  languageByModel: Record<string, string | undefined>;
  instructByModel: Record<string, string | undefined>;
  /** Distribution des voix d'un scénario : nom du personnage -> voix. */
  cast: Record<string, VoiceRef | undefined>;
  audioCount: number;
  autoplay: boolean;
  setAudioPrompt: (p: string) => void;
  setAudioModel: (id: string) => void;
  setVoice: (modelId: string, v: VoiceRef | undefined) => void;
  setLanguage: (modelId: string, l: string) => void;
  setInstruct: (modelId: string, t: string) => void;
  setCast: (name: string, v: VoiceRef | undefined) => void;
  setAudioCount: (n: number) => void;
  setAutoplay: (b: boolean) => void;
  voiceStudio: VoiceStudioState | null;
  openVoiceStudio: (s?: VoiceStudioState) => void;
  closeVoiceStudio: () => void;
  packInstall: PackInstallState;
  setPackInstall: (s: PackInstallState) => void;

  // Composer
  prompt: string;
  references: Asset[];
  uploading: PendingUpload[];
  modelId: string | null;
  paramsByModel: Record<string, GenParams>;
  count: number;
  seed: number | null;
  setPrompt: (p: string) => void;
  addReferences: (a: Asset[]) => void;
  removeReference: (id: string) => void;
  moveReference: (from: number, to: number) => void;
  clearReferences: () => void;
  setUploading: (u: PendingUpload[]) => void;
  setModel: (id: string) => void;
  setParams: (modelId: string, patch: GenParams) => void;
  resetParams: (modelId: string) => void;
  setCount: (n: number) => void;
  setSeed: (s: number | null) => void;

  // Temps réel
  progress: Record<string, JobProgress>;
  engine: EngineStatus | null;
  setProgress: (p: JobProgress) => void;
  clearProgress: (id: string) => void;
  setEngine: (e: EngineStatus) => void;
  downloads: Record<string, DownloadProgress>;
  setDownload: (d: DownloadProgress) => void;
  engineInstall: EngineInstallState;
  setEngineInstall: (s: EngineInstallState) => void;
  /** Modèle à télécharger dès que le moteur sera installé (installation en deux temps, en un clic). */
  pendingModelId: string | null;
  setPendingModel: (id: string | null) => void;

  // Interface
  theme: Theme;
  sidebarOpen: boolean;
  lightbox: LightboxState | null;
  settingsOpen: boolean;
  modelsOpen: boolean;
  setModelsOpen: (open: boolean) => void;
  setTheme: (t: Theme) => void;
  toggleSidebar: () => void;
  openLightbox: (items: Asset[], index: number) => void;
  closeLightbox: () => void;
  setLightboxIndex: (i: number) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      mode: "image",
      setMode: (mode) => set({ mode }),
      audioPrompt: "",
      audioModelId: null,
      voiceByModel: {},
      languageByModel: {},
      instructByModel: {},
      cast: {},
      audioCount: 1,
      autoplay: true,
      setAudioPrompt: (audioPrompt) => set({ audioPrompt }),
      setAudioModel: (audioModelId) => set({ audioModelId }),
      setVoice: (id, v) => set((s) => ({ voiceByModel: { ...s.voiceByModel, [id]: v } })),
      setLanguage: (id, l) => set((s) => ({ languageByModel: { ...s.languageByModel, [id]: l } })),
      setInstruct: (id, t) => set((s) => ({ instructByModel: { ...s.instructByModel, [id]: t } })),
      setCast: (name, v) => set((s) => ({ cast: { ...s.cast, [name]: v } })),
      setAudioCount: (audioCount) => set({ audioCount }),
      setAutoplay: (autoplay) => set({ autoplay }),
      voiceStudio: null,
      openVoiceStudio: (s) => set({ voiceStudio: s ?? {} }),
      closeVoiceStudio: () => set({ voiceStudio: null }),
      packInstall: { state: "idle" },
      setPackInstall: (packInstall) => set({ packInstall }),

      prompt: "",
      references: [],
      uploading: [],
      modelId: null,
      paramsByModel: {},
      count: 1,
      seed: null,
      setPrompt: (prompt) => set({ prompt }),
      addReferences: (assets) =>
        set((s) => {
          const ids = new Set(s.references.map((r) => r.id));
          return { references: [...s.references, ...assets.filter((a) => !ids.has(a.id))] };
        }),
      removeReference: (id) => set((s) => ({ references: s.references.filter((r) => r.id !== id) })),
      moveReference: (from, to) =>
        set((s) => {
          const refs = [...s.references];
          const [item] = refs.splice(from, 1);
          refs.splice(to, 0, item);
          return { references: refs };
        }),
      clearReferences: () => set({ references: [] }),
      setUploading: (uploading) => set({ uploading }),
      setModel: (modelId) => set({ modelId }),
      setParams: (modelId, patch) =>
        set((s) => ({ paramsByModel: { ...s.paramsByModel, [modelId]: { ...s.paramsByModel[modelId], ...patch } } })),
      resetParams: (modelId) =>
        set((s) => {
          const next = { ...s.paramsByModel };
          delete next[modelId];
          return { paramsByModel: next };
        }),
      setCount: (count) => set({ count }),
      setSeed: (seed) => set({ seed }),

      progress: {},
      engine: null,
      setProgress: (p) => set((s) => ({ progress: { ...s.progress, [p.message_id]: { ...s.progress[p.message_id], ...p } } })),
      clearProgress: (id) =>
        set((s) => {
          if (!(id in s.progress)) return s;
          const next = { ...s.progress };
          delete next[id];
          return { progress: next };
        }),
      setEngine: (engine) => set({ engine }),
      downloads: {},
      setDownload: (d) => set((s) => ({ downloads: { ...s.downloads, [d.model_id]: d } })),
      engineInstall: { state: "idle" },
      setEngineInstall: (engineInstall) => set({ engineInstall }),
      pendingModelId: null,
      setPendingModel: (pendingModelId) => set({ pendingModelId }),

      theme: (document.documentElement.dataset.theme as Theme) ?? "dark",
      sidebarOpen: true,
      lightbox: null,
      settingsOpen: false,
      modelsOpen: false,
      setModelsOpen: (modelsOpen) => set({ modelsOpen }),
      setTheme: (theme) => {
        document.documentElement.dataset.theme = theme;
        try {
          localStorage.setItem("cn-theme", theme);
        } catch {
          /* stockage indisponible */
        }
        set({ theme });
      },
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      openLightbox: (items, index) => set({ lightbox: { items, index } }),
      closeLightbox: () => set({ lightbox: null }),
      setLightboxIndex: (index) => set((s) => (s.lightbox ? { lightbox: { ...s.lightbox, index } } : s)),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    }),
    {
      name: "cn-prefs",
      partialize: (s) => ({
        modelId: s.modelId,
        paramsByModel: s.paramsByModel,
        count: s.count,
        sidebarOpen: s.sidebarOpen,
        prompt: s.prompt,
        mode: s.mode,
        audioPrompt: s.audioPrompt,
        audioModelId: s.audioModelId,
        voiceByModel: s.voiceByModel,
        languageByModel: s.languageByModel,
        instructByModel: s.instructByModel,
        cast: s.cast,
        audioCount: s.audioCount,
        autoplay: s.autoplay,
      }),
    },
  ),
);
