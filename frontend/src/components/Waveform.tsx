// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

import { useId, useMemo } from "react";
import { cx } from "../lib/format";

interface Props {
  peaks: number[];
  /** Progress 0..1 (the played part is colored). */
  progress?: number;
  className?: string;
  /** Click/drag on the waveform -> position 0..1. */
  onSeek?: (fraction: number) => void;
  /** Bar height at rest (0 = flat). */
  floor?: number;
  active?: boolean;
}

/** Bar waveform: background layer plus a colored layer clipped to the progress. */
export function Waveform({ peaks, progress = 0, className, onSeek, floor = 0.07, active = false }: Props) {
  const clip = useId();
  const bars = useMemo(() => {
    const n = peaks.length || 1;
    return peaks.map((p, i) => {
      const h = Math.max(floor, Math.min(1, p)) * 34;
      return <rect key={i} x={i + 0.18} y={20 - h / 2} width={0.64} height={h} rx={0.32} />;
    }).concat(peaks.length ? [] : [<rect key="empty" x={0} y={19.5} width={n} height={1} />]);
  }, [peaks, floor]);
  const n = Math.max(1, peaks.length);

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(frac);
  };

  return (
    <div
      className={cx("relative select-none", onSeek && "cursor-pointer", className)}
      onPointerDown={(e) => {
        if (!onSeek) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        seek(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && seek(e)}
      role={onSeek ? "slider" : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-label={onSeek ? "Position de lecture" : undefined}
    >
      <svg viewBox={`0 0 ${n} 40`} preserveAspectRatio="none" className="block size-full">
        <defs>
          <clipPath id={clip}>
            <rect x={0} y={0} width={n * progress} height={40} />
          </clipPath>
        </defs>
        <g className="fill-faint/70">{bars}</g>
        <g clipPath={`url(#${clip})`} className={cx("fill-safe", active && "drop-shadow-[0_0_3px_var(--safe-glow)]")}>
          {bars}
        </g>
      </svg>
    </div>
  );
}

/** Animated waveform while synthesizing (no profile known yet). */
export function WaveformPending({ fraction = 0, active = true }: { fraction?: number; active?: boolean }) {
  const bars = 72;
  return (
    <div className="flex h-full items-center gap-[3px]">
      {Array.from({ length: bars }, (_, i) => {
        const base = 0.25 + 0.55 * Math.abs(Math.sin(i * 0.61) * Math.cos(i * 0.23));
        const done = i / bars < fraction;
        return (
          <span
            key={i}
            className={cx("w-full min-w-px rounded-full", done ? "bg-safe" : "bg-faint/50", active && "animate-breathe")}
            style={{ height: `${base * 100}%`, animationDelay: `${(i % 12) * 90}ms` }}
          />
        );
      })}
    </div>
  );
}
