import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Info, Sparkles, TriangleAlert, Users, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { api, type ModelInfo, type VoiceRef } from "../lib/api";
import { approxDuration, estimateSeconds, speakersIn } from "../lib/audio";
import { registerComposer } from "../lib/composer";
import { cx } from "../lib/format";
import { keys, queryClient, upsertMessage, useActiveModel, useModels, useVoices } from "../lib/queries";
import { navigate, paths } from "../lib/router";
import { useStore } from "../lib/store";
import { ModelPicker } from "./ModelPicker";
import { ParamsPopover } from "./ParamsPopover";
import { SetupPrompt, useWelcomeModel } from "./Setup";
import { LanguagePicker, VoicePicker, defaultLanguage, effectiveVoice, presetsFor } from "./VoicePicker";
import { Spinner, Tip } from "./ui";

export function AudioComposer({ conversationId, hero = false }: { conversationId: string | null; hero?: boolean }) {
  const model = useActiveModel("audio");
  const { isError } = useModels();
  if (!model || !model.audio) {
    return (
      <div className="panel flex h-28 items-center justify-center rounded-3xl text-sm text-muted">
        {isError ? "Serveur injoignable — le backend est-il démarré ?" : <Spinner />}
      </div>
    );
  }
  return <Inner model={model} conversationId={conversationId} hero={hero} />;
}

function Inner({ model, conversationId, hero }: { model: ModelInfo; conversationId: string | null; hero: boolean }) {
  const caps = model.audio!;
  const prompt = useStore((s) => s.audioPrompt);
  const setPrompt = useStore((s) => s.setAudioPrompt);
  const storedLang = useStore((s) => s.languageByModel[model.id]);
  const setLanguage = useStore((s) => s.setLanguage);
  const voiceRef = useStore((s) => s.voiceByModel[model.id]);
  const setVoice = useStore((s) => s.setVoice);
  const instruct = useStore((s) => s.instructByModel[model.id] ?? "");
  const setInstruct = useStore((s) => s.setInstruct);
  const stored = useStore((s) => s.paramsByModel[model.id]);
  const setParams = useStore((s) => s.setParams);
  const cast = useStore((s) => s.cast);
  const setCast = useStore((s) => s.setCast);
  const count = useStore((s) => s.audioCount);
  const setCount = useStore((s) => s.setAudioCount);
  const seed = useStore((s) => s.seed);
  const autoplay = useStore((s) => s.autoplay);
  const setAutoplay = useStore((s) => s.setAutoplay);
  const { data: library } = useVoices();
  const [sending, setSending] = useState(false);
  const [scriptMode, setScriptMode] = useState(true);
  const ref = useRef<HTMLTextAreaElement>(null);
  const welcomeShown = !!useWelcomeModel("audio");

  const language = defaultLanguage(caps, storedLang);
  const params = { ...Object.fromEntries(model.params.map((p) => [p.key, p.default])), ...stored };
  const voice = effectiveVoice(caps, voiceRef, language, library);

  useEffect(() => {
    registerComposer(ref.current);
    return () => registerComposer(null);
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [prompt]);

  // Scénario : « Nom : réplique ». Au moins deux personnages, et un modèle qui a plusieurs voix à proposer.
  const speakers = useMemo(() => speakersIn(prompt), [prompt]);
  const pool: VoiceRef[] = useMemo(
    () => [
      ...presetsFor(caps, language).map((p) => ({ source: "preset" as const, id: p.id })),
      ...(caps.clone !== "none" ? (library ?? []).map((v) => ({ source: "library" as const, id: v.id })) : []),
    ],
    [caps, language, library],
  );
  const scriptActive = scriptMode && speakers.length >= 2 && !caps.design && pool.length > 0;
  const castFor = (name: string, i: number): VoiceRef | undefined => {
    const chosen = cast[name];
    if (chosen && pool.some((p) => p.source === chosen.source && p.id === chosen.id)) return chosen;
    // Distribution automatique : le 1er personnage garde la voix choisie, les suivants prennent d'autres voix.
    if (i === 0 && voice.ref) return voice.ref;
    const others = pool.filter((p) => !(voice.ref && p.source === voice.ref.source && p.id === voice.ref.id));
    // Les voix de genre opposé à la voix principale d'abord : deux personnages se distinguent mieux.
    const genderOf = (p: VoiceRef) => caps.voices.find((v) => p.source === "preset" && v.id === p.id)?.gender;
    const mainGender = voice.preset?.gender;
    const opposite = others.filter((p) => mainGender && genderOf(p) && genderOf(p) !== mainGender);
    const list = opposite.length ? [...opposite, ...others.filter((p) => !opposite.includes(p))] : others.length ? others : pool;
    return list[(i - 1) % list.length];
  };

  const seconds = estimateSeconds(prompt, Number(params.speed) || 1);
  const needsVoice = !caps.design && !voice.ref;
  const needsDescription = caps.design && !instruct.trim();
  const notReady = !model.ready;
  const blocked = needsVoice || needsDescription || notReady || !model.compatible;
  const canSend = prompt.trim().length > 0 && !blocked && !sending && prompt.length <= 8000;

  const notices: { tone: "warn" | "info"; text: string }[] = [];
  if (!model.compatible) notices.push({ tone: "warn", text: model.engine_reason || model.plan.note || `${model.name} ne peut pas tourner sur cette machine.` });
  else if (model.plan.note && model.plan.strategy !== "full") notices.push({ tone: "info", text: model.plan.note });
  else if (model.plan.note) notices.push({ tone: "info", text: model.plan.note });
  if (needsVoice && model.compatible) notices.push({ tone: "warn", text: "Ce modèle clone une voix : choisissez ou enregistrez une voix de référence." });
  if (prompt.length > 6000) notices.push({ tone: "info", text: "Texte très long : il sera lu par morceaux, la synthèse peut prendre plusieurs minutes." });

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = { ...params, language, seed };
      if (voice.ref) body.voice = voice.ref;
      if (caps.instruct || caps.design) body.instruct = instruct.trim();
      if (scriptActive) body.cast = Object.fromEntries(speakers.map((n, i) => [n, castFor(n, i)]).filter(([, v]) => v));
      const res = await api.send({
        conversation_id: conversationId,
        prompt: prompt.trim(),
        model_id: model.id,
        params: body,
        reference_ids: [],
        count,
      });
      setPrompt("");
      if (conversationId) {
        upsertMessage(res.user_message);
        upsertMessage(res.assistant_message);
      } else {
        await queryClient.prefetchQuery({ queryKey: keys.conversation(res.conversation_id), queryFn: () => api.conversation(res.conversation_id) });
        navigate(paths.conversation(res.conversation_id));
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const instructLabel = caps.design ? "Voix" : "Style";

  return (
    <div
      className={cx(
        "panel group/composer relative rounded-[22px] transition-[border-color,box-shadow] focus-within:border-line-strong",
        hero && "shadow-[0_30px_80px_-30px_var(--safe-glow)]",
      )}
    >
      {(caps.instruct || caps.design) && (
        <label className="flex items-start gap-2.5 border-b border-line/70 px-4.5 pb-2.5 pt-3.5">
          <span className="mt-[3px] flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-safe">
            <Sparkles className="size-3.5" /> {instructLabel}
          </span>
          <textarea
            rows={1}
            value={instruct}
            onChange={(e) => setInstruct(model.id, e.target.value)}
            placeholder={caps.instruct_help}
            className="min-h-6 min-w-0 flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
        </label>
      )}

      <textarea
        ref={ref}
        value={prompt}
        rows={hero ? 4 : 2}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={caps.design ? "Le texte à faire dire… (« Nom : réplique » pour un dialogue)" : "Le texte à lire à voix haute… (« Alice : … » / « Marc : … » pour un dialogue à plusieurs voix)"}
        className="block w-full resize-none bg-transparent px-4.5 pb-1 pt-4 text-[15.5px] leading-relaxed text-ink placeholder:text-faint focus:outline-none"
      />

      <div className="flex items-center gap-3 px-4.5 pb-1.5 font-mono text-[10.5px] text-faint">
        <span>{prompt.length.toLocaleString("fr-FR")} caractères</span>
        {prompt.trim() && <span>· {approxDuration(seconds)} d'audio</span>}
      </div>

      {scriptActive && (
        <div className="mx-3.5 mb-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-ink-2">
            <Users className="size-3.5 text-safe" />
            <span className="font-medium text-ink">Scénario à {speakers.length} voix</span>
            <button onClick={() => setScriptMode(false)} className="ml-auto text-[11.5px] text-faint hover:text-ink">
              C'est un simple texte
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {speakers.map((name, i) => (
              <VoicePicker
                key={name}
                compact
                label={name}
                model={model}
                language={language}
                value={castFor(name, i)}
                onChange={(v) => setCast(name, v)}
              />
            ))}
          </div>
        </div>
      )}
      {!scriptMode && speakers.length >= 2 && (
        <div className="mx-4.5 mb-2 text-[11.5px] text-faint">
          Dialogue détecté.{" "}
          <button onClick={() => setScriptMode(true)} className="underline-offset-2 hover:text-ink hover:underline">
            Attribuer une voix à chaque personnage
          </button>
        </div>
      )}

      {model.compatible && !model.ready && !(hero && welcomeShown) && <SetupPrompt model={model} />}

      {notices.length > 0 && (
        <div className="space-y-1 px-4.5 pb-1">
          {notices.map((n) => (
            <div key={n.text} className={cx("flex items-start gap-1.5 text-[12px] leading-snug", n.tone === "warn" ? "text-warn" : "text-muted")}>
              {n.tone === "warn" ? <TriangleAlert className="mt-px size-3.5 shrink-0" /> : <Info className="mt-px size-3.5 shrink-0" />}
              <span className="min-w-0 flex-1">{n.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5 pt-1.5">
        <ModelPicker model={model} />
        {!scriptActive && <VoicePicker model={model} language={language} value={voice.ref} onChange={(v) => setVoice(model.id, v)} />}
        <LanguagePicker caps={caps} value={language} onChange={(l) => setLanguage(model.id, l)} />
        <ParamsPopover model={model} params={params} hasRefs={false} onChange={(p) => setParams(model.id, p)} />
        <TakesPicker value={count} onChange={setCount} />
        <Tip label={autoplay ? "Lecture automatique activée" : "Lecture automatique désactivée"}>
          <button
            onClick={() => setAutoplay(!autoplay)}
            aria-label="Lecture automatique"
            className={cx("grid size-8 place-items-center rounded-lg border border-line bg-surface-2 transition-colors hover:border-line-strong", autoplay ? "text-ink-2" : "text-faint")}
          >
            {autoplay ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          </button>
        </Tip>

        <div className="flex-1" />
        <span className="hidden pr-1 text-[11px] text-faint lg:inline">⇧↵ nouvelle ligne</span>
        <Tip
          label={
            notReady && model.compatible ? "À installer avant de générer" : !model.compatible ? "Modèle incompatible avec cette machine"
              : needsDescription ? "Décrivez la voix" : needsVoice ? "Choisissez une voix" : "Synthétiser"
          }
          kbd="↵"
        >
          <button
            onClick={send}
            disabled={!canSend}
            aria-label="Synthétiser"
            className={cx(
              "grid size-9 place-items-center rounded-xl transition-all",
              canSend ? "bg-safe text-safe-ink shadow-[0_0_24px_-4px_var(--safe-glow)] hover:brightness-110" : "bg-surface-3 text-faint",
            )}
          >
            {sending ? <Spinner /> : <ArrowUp className="size-[18px]" strokeWidth={2.4} />}
          </button>
        </Tip>
      </div>
    </div>
  );
}

function TakesPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Tip label="Nombre de prises (variantes)">
      <div className="flex h-8 items-center rounded-lg border border-line bg-surface-2 p-0.5">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={cx("h-full w-6 rounded-md font-mono text-[12px] transition-colors", value === n ? "bg-surface-3 text-ink shadow-sm" : "text-faint hover:text-ink")}
          >
            {n}
          </button>
        ))}
      </div>
    </Tip>
  );
}
