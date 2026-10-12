// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m} min ${r.toString().padStart(2, "0")}`;
  return `${Math.floor(m / 60)} h ${(m % 60).toString().padStart(2, "0")}`;
}

/** Seconds of a clip: "5 s", "5,5 s". */
export function formatSeconds(seconds: number): string {
  return `${(Math.round(seconds * 10) / 10).toString().replace(".", ",")} s`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function formatTime(ts: number): string {
  return timeFmt.format(new Date(ts * 1000));
}

export function formatDay(ts: number): string {
  return dayFmt.format(new Date(ts * 1000));
}

/** Groups by period, like chat apps. */
export function periodOf(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000;
  if (diff <= 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  if (diff < 7) return "7 derniers jours";
  if (diff < 30) return "30 derniers jours";
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(d);
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Download size label: "650 Mo" below 1 GB, "4,5 Go" above; empty if unknown. */
export function formatModelSize(gb: number | null | undefined): string {
  if (!gb || gb <= 0) return "";
  if (gb < 1) return `${Math.max(10, Math.round((gb * 1000) / 10) * 10)} Mo`;
  return `${(gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)).replace(".", ",")} Go`;
}

/** Installed models first, then the rest; catalog order is kept within each group. */
export function installedFirst<T extends { install: string }>(models: T[]): T[] {
  const rank = (m: T) => (m.install === "installed" ? 0 : 1);
  return models.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m);
}
