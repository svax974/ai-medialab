// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

// Video mode helpers: imports with progress, composer slots, frame capture, size and duration maths.
import { toast } from "sonner";
import { api, type Asset, type GenParams, type ModelInfo, type VideoCaps, type VideoResolution } from "./api";
import { focusComposer } from "./composer";
import { keys, queryClient } from "./queries";
import { navigate, paths } from "./router";
import { ratioOf } from "./size";
import { useStore, type VideoSlot } from "./store";

export const VIDEO_ASPECTS = [
  { id: "16:9", label: "Écran" },
  { id: "9:16", label: "Vertical" },
  { id: "1:1", label: "Carré" },
  { id: "4:3", label: "Paysage" },
  { id: "3:4", label: "Portrait" },
] as const;

export const TASK_LABEL: Record<VideoCaps["tasks"][number], string> = {
  t2v: "texte → vidéo",
  i2v: "image → vidéo",
  v2v: "montage vidéo",
};

const VIDEO_RE = /\.(mp4|mov|webm|mkv|m4v)$/i;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/i;

export const isVideoFile = (f: File) => f.type.startsWith("video/") || VIDEO_RE.test(f.name);
export const isImageFile = (f: File) => f.type.startsWith("image/") || IMAGE_RE.test(f.name);

// --- Duration and size ---

/** Number of frames the model will actually render for a requested duration. */
export function frameCount(seconds: number, caps: Pick<VideoCaps, "fps" | "frame_step">): number {
  const step = Math.max(1, caps.frame_step);
  const n = Math.max(1, Math.round((seconds * caps.fps - 1) / step));
  return n * step + 1;
}

/** Approximate output size for an aspect ratio at a given resolution (area of the model's native size). */
export function videoSize(aspect: string, res: Pick<VideoResolution, "short_side" | "long_side"> | undefined): { width: number; height: number } | null {
  if (!res) return null;
  const r = ratioOf(aspect) ?? 16 / 9;
  const area = res.short_side * res.long_side;
  const snap = (v: number) => Math.max(16, Math.round(v / 16) * 16);
  const w = Math.sqrt(area * r);
  return { width: snap(w), height: snap(w / r) };
}

/** Effective params: model defaults, then video settings, then saved preferences (clamped to the model's limits). */
export function effectiveVideoParams(model: ModelInfo, stored: GenParams | undefined): GenParams {
  const caps = model.video!;
  const defaults: GenParams = Object.fromEntries(model.params.map((p) => [p.key, p.default]));
  const merged: GenParams = {
    ...defaults,
    aspect: "16:9",
    resolution: caps.default_resolution,
    seconds: caps.default_seconds,
    ...stored,
  };
  const seconds = Number(merged.seconds);
  merged.seconds = Math.min(caps.max_seconds, Math.max(caps.min_seconds, isFinite(seconds) ? seconds : caps.default_seconds));
  if (!caps.resolutions.some((r) => r.id === merged.resolution)) merged.resolution = caps.default_resolution;
  if (!VIDEO_ASPECTS.some((a) => a.id === merged.aspect)) merged.aspect = "16:9";
  return merged;
}

// --- Model choice ---

type Catalog = Awaited<ReturnType<typeof api.models>>;

/** Model the video composer is using right now (from the cached catalog). */
function activeVideoModel(): ModelInfo | undefined {
  const data = queryClient.getQueryData<Catalog>(keys.models);
  if (!data) return undefined;
  const mine = data.models.filter((m) => m.kind === "video" && m.video);
  const id = useStore.getState().videoModelId;
  return mine.find((m) => m.id === id) ?? mine.find((m) => m.id === data.video?.default_model_id) ?? mine[0];
}

const SLOT_SUPPORT: Record<VideoSlot, (c: VideoCaps) => boolean> = {
  start: (c) => c.image_input !== "none",
  end: (c) => c.last_frame,
  source: (c) => c.video_input !== "none",
};

const SLOT_WHY: Record<VideoSlot, string> = {
  start: "accepte une image de départ",
  end: "accepte une image de fin",
  source: "sait monter une vidéo existante",
};

/** If the active model cannot use this kind of input, switches to a compatible one (ready models first, lightest first). */
function ensureVideoModel(slot: VideoSlot) {
  const data = queryClient.getQueryData<Catalog>(keys.models);
  const active = activeVideoModel();
  if (!data || !active?.video || SLOT_SUPPORT[slot](active.video)) return;
  const better = data.models
    .filter((m) => m.kind === "video" && m.video && m.compatible && SLOT_SUPPORT[slot](m.video))
    .sort((a, b) => Number(b.ready) - Number(a.ready) || (a.download_size_gb ?? 0) - (b.download_size_gb ?? 0))[0];
  if (better) {
    useStore.getState().setVideoModel(better.id);
    toast.info(`${better.name} ${SLOT_WHY[slot]} : modèle changé.`, { duration: 3200 });
  }
}

// --- Composer slots ---

/** Puts an asset in the matching composer slot (video -> source, image -> start then end). */
export function assignVideoAsset(asset: Asset) {
  const s = useStore.getState();
  if (asset.media === "video") {
    s.setVideoSlot("source", asset);
    ensureVideoModel("source");
  } else {
    const caps = activeVideoModel()?.video;
    const slot: VideoSlot = s.videoStart && !s.videoEnd && caps?.last_frame ? "end" : "start";
    s.setVideoSlot(slot, asset);
    ensureVideoModel(slot);
  }
  focusComposer();
}

// A slot tile that received a drop tells the window-level handler which slot was targeted.
let dropSlot: VideoSlot | undefined;
export const setDropSlot = (slot: VideoSlot | undefined) => {
  dropSlot = slot;
};

/** Window-level drop in video mode. */
export function dropIntoVideo(files: File[]) {
  const slot = dropSlot;
  dropSlot = undefined;
  return importVideoFiles(files, slot);
}

/** Imports local files (drop, paste or picker) into the video composer slots, with upload progress. */
export async function importVideoFiles(files: File[], forced?: VideoSlot) {
  const usable = files.filter((f) => isVideoFile(f) || isImageFile(f));
  if (usable.length < files.length) toast.warning("Certains fichiers ont été ignorés : seules les images et les vidéos sont acceptées.");
  if (!usable.length) return;

  const videos = usable.filter(isVideoFile);
  const images = usable.filter((f) => !isVideoFile(f));
  if (videos.length > 1) toast.warning("Une seule vidéo source à la fois : la première est retenue.");

  const caps = activeVideoModel()?.video;
  const s0 = useStore.getState();
  let startTaken = !!s0.videoStart;
  let endTaken = !!s0.videoEnd;
  const jobs: { file: File; slot: VideoSlot }[] = [];
  if (videos[0]) jobs.push({ file: videos[0], slot: "source" });
  for (const f of images.slice(0, 2)) {
    let slot: VideoSlot = forced === "start" || forced === "end" ? forced : "start";
    if (!forced || forced === "source") {
      if (startTaken && !endTaken && caps?.last_frame) slot = "end";
    }
    if (slot === "start") startTaken = true;
    else endTaken = true;
    jobs.push({ file: f, slot });
  }
  if (images.length > 2) toast.warning("Seules deux images (départ et fin) sont utilisées.");

  await Promise.all(
    jobs.map(async ({ file, slot }) => {
      const id = crypto.randomUUID();
      const { updateVideoUploads, setVideoSlot } = useStore.getState();
      updateVideoUploads((u) => [...u.filter((x) => x.slot !== slot), { id, slot, name: file.name, progress: 0 }]);
      try {
        const [asset] = await api.uploadWithProgress([file], (p) =>
          useStore.getState().updateVideoUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))),
        );
        setVideoSlot(slot, asset);
        ensureVideoModel(slot);
        focusComposer();
      } catch (e) {
        toast.error(`Import impossible : ${(e as Error).message}`);
      } finally {
        useStore.getState().updateVideoUploads((u) => u.filter((x) => x.id !== id));
      }
    }),
  );
}

/** Takes a clip from the gallery or a conversation to the composer as the video to edit. */
export function editAsVideoSource(asset: Asset) {
  const s = useStore.getState();
  s.closeLightbox();
  s.setVideoSlot("source", asset);
  ensureVideoModel("source");
  if (/^\/video\/bibliotheque\/?$/.test(location.pathname)) navigate(paths.videoHome);
  focusComposer();
  toast.success("Vidéo source prête : décrivez la modification", { duration: 2200 });
}

// --- Frame capture ---

/** Draws one frame of a video to a PNG file (default: the last one). Same-origin, so the canvas stays readable. */
export function captureFrame(url: string, at: "last" | number = "last"): Promise<File> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    const fail = (msg: string) => {
      video.removeAttribute("src");
      video.load();
      reject(new Error(msg));
    };
    video.onerror = () => fail("Lecture de la vidéo impossible.");
    video.onloadedmetadata = () => {
      const t = at === "last" ? Math.max(0, video.duration - 0.06) : Math.min(at, video.duration);
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext("2d")!.drawImage(video, 0, 0);
          canvas.toBlob((blob) => {
            video.removeAttribute("src");
            video.load();
            if (blob) resolve(new File([blob], at === "last" ? "derniere-image.png" : "image.png", { type: "image/png" }));
            else reject(new Error("Capture de l'image impossible."));
          }, "image/png");
        } catch {
          fail("Capture de l'image impossible.");
        }
      };
      video.currentTime = t;
    };
    video.src = url;
  });
}

/** Captures the last frame of a clip and uses it as the start image of the next one (continues the shot). */
export async function continueFromLastFrame(asset: Asset) {
  const id = toast.loading("Capture de la dernière image…");
  try {
    const file = await captureFrame(asset.url, "last");
    const [image] = await api.upload([file]);
    const s = useStore.getState();
    s.closeLightbox();
    s.setVideoSlot("start", image);
    s.setVideoSlot("end", null);
    s.setVideoSlot("source", null);
    ensureVideoModel("start");
    if (/^\/video\/bibliotheque\/?$/.test(location.pathname)) navigate(paths.videoHome);
    focusComposer();
    toast.success("Dernière image prête comme départ : décrivez la suite du plan", { id, duration: 2600 });
  } catch (e) {
    toast.error((e as Error).message, { id });
  }
}
