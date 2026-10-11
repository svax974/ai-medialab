// Calcul des dimensions (miroir de backend/app/media.py:resolve_size).
import type { GenParams, ModelInfo } from "./api";

export const ASPECTS = [
  { id: "1:1", label: "Carré" },
  { id: "4:5", label: "Portrait" },
  { id: "3:4", label: "Portrait" },
  { id: "2:3", label: "Photo" },
  { id: "9:16", label: "Story" },
  { id: "5:4", label: "Paysage" },
  { id: "4:3", label: "Paysage" },
  { id: "3:2", label: "Photo" },
  { id: "16:9", label: "Écran" },
  { id: "21:9", label: "Cinéma" },
] as const;

export const QUALITIES = [
  { mp: 0.5, label: "Brouillon", hint: "≈ 0,5 MP · rapide" },
  { mp: 1, label: "Standard", hint: "≈ 1 MP" },
  { mp: 1.6, label: "Haute", hint: "≈ 1,6 MP · plus lent" },
  { mp: 2.3, label: "Très haute", hint: "≈ 2,3 MP · lent" },
];

const snap = (v: number, m: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v / m) * m));

export function ratioOf(aspect: string): number | null {
  const [a, b] = aspect.split(":").map(Number);
  return a > 0 && b > 0 ? a / b : null;
}

export function resolveSize(
  params: GenParams,
  model: Pick<ModelInfo, "size_multiple" | "min_side" | "max_side" | "default_megapixels">,
  reference?: { width: number | null; height: number | null } | null,
): { width: number; height: number } {
  const { size_multiple: m, min_side: lo, max_side: hi } = model;
  const aspect = params.aspect ?? "1:1";
  if (aspect === "custom") {
    return { width: snap(params.width ?? 1024, m, lo, hi), height: snap(params.height ?? 1024, m, lo, hi) };
  }
  let ratio: number | null = null;
  if (aspect === "auto" && reference?.width && reference?.height) ratio = reference.width / reference.height;
  ratio ??= ratioOf(aspect) ?? 1;
  const mp = Math.max(0.1, Math.min(4, params.megapixels ?? model.default_megapixels));
  const area = mp * 1024 * 1024;
  let w = Math.sqrt(area * ratio);
  let h = w / ratio;
  const scale = Math.min(1, hi / Math.max(w, h));
  w *= scale;
  h *= scale;
  return { width: snap(w, m, lo, hi), height: snap(h, m, lo, hi) };
}
