// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

// Browser-side audio: shared player, WAV conversion, microphone recording.
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

/** Estimated speech duration (about 15 characters per second, a calm reading pace). */
export function estimateSeconds(text: string, speed = 1): number {
  const chars = text.replace(/\s+/g, " ").trim().length;
  return chars / 15 / Math.max(0.5, speed);
}

export function clock(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function approxDuration(sec: number): string {
  if (sec < 60) return `≈ ${Math.max(1, Math.round(sec))} s`;
  return `≈ ${Math.floor(sec / 60)} min ${String(Math.round(sec % 60)).padStart(2, "0")} s`;
}

// --- Shared player ---

interface PlayerState {
  /** Id of what is loaded in the player (asset or voice). */
  id: string | null;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  toggle: (id: string, url: string, startAt?: number) => void;
  seek: (id: string, url: string, fraction: number) => void;
  setRate: (rate: number) => void;
  stop: () => void;
}

let element: HTMLAudioElement | null = null;
const audio = () => {
  if (!element) {
    element = new Audio();
    element.preload = "auto";
  }
  return element;
};

export const usePlayer = create<PlayerState>((set, get) => {
  const el = audio();
  let ticker: ReturnType<typeof setInterval> | undefined;
  const startTicker = () => {
    clearInterval(ticker);
    ticker = setInterval(() => set({ time: el.currentTime, duration: isFinite(el.duration) ? el.duration : get().duration }), 50);
  };
  el.addEventListener("play", () => (startTicker(), set({ playing: true })));
  el.addEventListener("pause", () => (clearInterval(ticker), set({ playing: false, time: el.currentTime })));
  el.addEventListener("ended", () => (clearInterval(ticker), set({ playing: false, time: 0 })));
  el.addEventListener("loadedmetadata", () => set({ duration: isFinite(el.duration) ? el.duration : 0 }));

  const load = (id: string, url: string) => {
    if (get().id !== id) {
      el.src = url;
      el.playbackRate = get().rate;
      set({ id, time: 0, duration: 0, playing: false });
    }
  };

  return {
    id: null,
    playing: false,
    time: 0,
    duration: 0,
    rate: 1,
    toggle: (id, url, startAt) => {
      load(id, url);
      if (startAt !== undefined) el.currentTime = startAt;
      if (el.paused) el.play().catch(() => set({ playing: false }));
      else el.pause();
    },
    seek: (id, url, fraction) => {
      load(id, url);
      const go = () => {
        el.currentTime = fraction * (isFinite(el.duration) ? el.duration : 0);
        set({ time: el.currentTime });
        if (el.paused) el.play().catch(() => undefined);
      };
      if (isFinite(el.duration) && el.duration > 0) go();
      else el.addEventListener("loadedmetadata", go, { once: true });
    },
    setRate: (rate) => {
      el.playbackRate = rate;
      el.preservesPitch = true;
      set({ rate });
    },
    stop: () => {
      el.pause();
      el.currentTime = 0;
      set({ id: null, playing: false, time: 0 });
    },
  };
});

/** Starts playback without a direct user gesture (autoplay of a take that was just generated). */
export function autoplay(id: string, url: string) {
  const s = usePlayer.getState();
  if (s.id === id && s.playing) return;
  s.toggle(id, url);
}

// --- WAV ---

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Decodes any format the browser can read (m4a, webm, mp3...) and returns mono WAV. */
export async function toWavFile(blob: Blob, name: string): Promise<File> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
    }
    return new File([encodeWav(mono, decoded.sampleRate)], name.replace(/\.[^.]+$/, "") + ".wav", { type: "audio/wav" });
  } finally {
    ctx.close().catch(() => undefined);
  }
}

export function peaksOf(samples: Float32Array, bins = 120): number[] {
  const out: number[] = [];
  const size = Math.max(1, Math.floor(samples.length / bins));
  let top = 0;
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = b * size; i < Math.min(samples.length, (b + 1) * size); i++) m = Math.max(m, Math.abs(samples[i]));
    out.push(m);
    top = Math.max(top, m);
  }
  return out.map((v) => (top ? v / top : 0));
}

/** Waveform peaks of a local file (preview before saving). */
export async function filePeaks(file: Blob, bins = 120): Promise<{ peaks: number[]; duration: number }> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    return { peaks: peaksOf(decoded.getChannelData(0), bins), duration: decoded.duration };
  } finally {
    ctx.close().catch(() => undefined);
  }
}

// --- Recording ---

export type RecorderState = "idle" | "requesting" | "recording" | "denied" | "unsupported";

export function useRecorder(onDone: (blob: Blob) => void) {
  const [state, setState] = useState<RecorderState>(
    typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia ? "unsupported" : "idle",
  );
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const refs = useRef<{ rec?: MediaRecorder; stream?: MediaStream; ctx?: AudioContext; raf?: number; timer?: ReturnType<typeof setInterval> }>({});
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const cleanup = () => {
    const r = refs.current;
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.timer) clearInterval(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => undefined);
    refs.current = {};
    setLevel(0);
  };

  useEffect(() => cleanup, []);

  const start = async () => {
    if (state === "unsupported") return;
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, channelCount: 1 } });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        cleanup();
        setState("idle");
        doneRef.current(blob);
      };
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        refs.current.raf = requestAnimationFrame(loop);
      };
      const t0 = Date.now();
      refs.current = { rec, stream, ctx, timer: setInterval(() => setSeconds((Date.now() - t0) / 1000), 200) };
      setSeconds(0);
      rec.start();
      loop();
      setState("recording");
    } catch {
      setState("denied");
    }
  };

  const stop = () => refs.current.rec?.state === "recording" && refs.current.rec.stop();
  return { state, seconds, level, start, stop };
}

// --- Multi-voice script ---

// Same rule as the server (app/dialogue.py): "Name: line" at the start of a line.
const LINE = /^\s*[[(]?\s*([\p{L}][\p{L}\p{N}_ .'’-]{0,28}?)\s*[\])]?\s*[:：]\s*(.*)$/u;

export function speakersIn(text: string): string[] {
  const seen: string[] = [];
  for (const line of text.split("\n")) {
    const m = LINE.exec(line);
    if (m && m[2].trim() && !seen.includes(m[1].trim())) seen.push(m[1].trim());
  }
  return seen;
}
