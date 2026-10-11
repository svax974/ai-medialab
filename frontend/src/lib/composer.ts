// Actions du composer partagées entre composants (import, focus, paramètres effectifs).
import { toast } from "sonner";
import { api, type Asset, type GenParams, type ModelInfo } from "./api";
import { useStore } from "./store";

let textarea: HTMLTextAreaElement | null = null;

export function registerComposer(el: HTMLTextAreaElement | null) {
  textarea = el;
}

export function focusComposer(selectAll = false) {
  requestAnimationFrame(() => {
    textarea?.focus();
    if (selectAll) textarea?.select();
    else if (textarea) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  });
}

const ACCEPTED = /^image\/(png|jpe?g|webp|gif|bmp|tiff|heic|heif|avif)$/i;

export async function uploadFiles(files: File[]) {
  const images = files.filter((f) => ACCEPTED.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|avif)$/i.test(f.name));
  if (images.length < files.length) toast.warning("Certains fichiers ont été ignorés : seules les images sont acceptées.");
  if (!images.length) return;

  const { setUploading, addReferences } = useStore.getState();
  const pending = images.map((f) => ({ tempId: crypto.randomUUID(), previewUrl: URL.createObjectURL(f), name: f.name }));
  setUploading([...useStore.getState().uploading, ...pending]);
  try {
    const assets = await api.upload(images);
    addReferences(assets);
    focusComposer();
  } catch (e) {
    toast.error(`Import impossible : ${(e as Error).message}`);
  } finally {
    const ids = new Set<string>(pending.map((p) => p.tempId));
    pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setUploading(useStore.getState().uploading.filter((u) => !ids.has(u.tempId)));
  }
}

/** Ajoute une image (générée ou importée) comme référence du prochain message. */
export function addAsReference(asset: Asset) {
  useStore.getState().addReferences([asset]);
  useStore.getState().closeLightbox();
  focusComposer();
  toast.success("Image ajoutée comme référence", { duration: 1800 });
}

/** Paramètres effectifs : défauts du modèle + préférences mémorisées. */
export function effectiveParams(model: ModelInfo, stored: GenParams | undefined, hasRefs: boolean): GenParams {
  const defaults: GenParams = Object.fromEntries(model.params.map((p) => [p.key, p.default]));
  const merged: GenParams = { ...defaults, megapixels: model.default_megapixels, ...stored };
  // Avec des références, la définition par défaut est « Origine » (0) : on garde la taille de l'image.
  if (hasRefs && stored?.megapixels === undefined) merged.megapixels = 0;
  if (!merged.aspect || (merged.aspect === "auto" && !hasRefs)) merged.aspect = hasRefs ? "auto" : "1:1";
  return merged;
}
