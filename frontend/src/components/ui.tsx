// Copyright (c) 2026 Stéphane Vaxelaire
// SPDX-License-Identifier: MIT

// Small shared UI components.
import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cx } from "../lib/format";

/** Tooltip around its child. `wide` lets the content wrap (use it with HelpBody for explanations). */
export function Tip({ label, children, side = "top", kbd, wide = false }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; kbd?: string; wide?: boolean }) {
  return (
    <TooltipPrimitive.Root delayDuration={wide ? 250 : 350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className={cx(
            "z-[80] rounded-lg border border-line-strong bg-surface-3 text-xs text-ink shadow-xl animate-fade",
            wide ? "block max-w-[min(19rem,calc(100vw-24px))] px-3 py-2.5 leading-relaxed" : "flex items-center gap-2 px-2.5 py-1.5",
          )}
        >
          {label}
          {kbd && <Kbd>{kbd}</Kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Explanation shown in a tooltip: short title, body, optional advice line. */
export interface Help {
  title?: string;
  body: ReactNode;
  /** Practical advice, shown after "Conseil :". */
  tip?: string;
}

export function HelpBody({ title, body, tip }: Help) {
  return (
    <div className="space-y-1.5">
      {title && <div className="text-[12.5px] font-medium text-ink">{title}</div>}
      <div className="whitespace-pre-line text-ink-2">{body}</div>
      {tip && (
        <div className="border-t border-line pt-1.5 text-ink-2">
          <b className="font-medium text-safe">Conseil :</b> {tip}
        </div>
      )}
    </div>
  );
}

/**
 * Discreet "?" button next to a label. The tooltip opens on hover, on keyboard focus and on tap.
 * It never takes space from the control it describes (fixed 16 px box).
 */
export function InfoTip({ title, body, tip, label, side = "top", className }: Help & { label?: string; side?: "top" | "bottom" | "left" | "right"; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipPrimitive.Root delayDuration={200} open={open} onOpenChange={setOpen}>
      <TooltipPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label ?? `Aide : ${title ?? "ce réglage"}`}
          // Touch devices never fire hover: a click (tap) opens it explicitly.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className={cx(
            "inline-grid size-4 shrink-0 place-items-center rounded-full text-faint transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safe-soft data-[state=delayed-open]:text-ink data-[state=instant-open]:text-ink",
            className,
          )}
        >
          <CircleHelp className="size-3.5" aria-hidden />
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="z-[80] block max-w-[min(19rem,calc(100vw-24px))] rounded-lg border border-line-strong bg-surface-3 px-3 py-2.5 text-xs leading-relaxed text-ink shadow-xl animate-fade"
        >
          <HelpBody title={title} body={body} tip={tip} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** A label followed by its InfoTip. */
export function LabelWithTip({ children, help, className }: { children: ReactNode; help?: Help; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      {children}
      {help && <InfoTip {...help} />}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface-2 px-1 py-px font-mono text-[10px] text-muted">{children}</kbd>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  kbd?: string;
  tone?: "default" | "ghost" | "glass" | "danger";
  size?: "sm" | "md";
  active?: boolean;
  tipSide?: "top" | "bottom" | "left" | "right";
  /** Longer explanation: the tooltip then wraps and shows it under the label. */
  hint?: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, kbd, tone = "ghost", size = "md", active, className, children, tipSide, hint, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      aria-label={label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40",
        size === "sm" ? "size-7" : "size-9",
        tone === "ghost" && "text-muted hover:bg-surface-3 hover:text-ink",
        tone === "default" && "border border-line bg-surface-2 text-ink-2 hover:border-line-strong hover:text-ink",
        tone === "glass" && "bg-black/45 text-white/90 backdrop-blur-md hover:bg-black/70 hover:text-white",
        tone === "danger" && "text-muted hover:bg-danger/15 hover:text-danger",
        active && "bg-surface-3 text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
  return (
    <Tip label={hint ? <HelpBody title={label} body={hint} /> : label} kbd={kbd} side={tipSide} wide={!!hint}>
      {button}
    </Tip>
  );
});

export function Button({
  variant = "secondary",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return (
    <button
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-colors disabled:opacity-45",
        variant === "primary" && "bg-safe text-safe-ink hover:brightness-110",
        variant === "secondary" && "border border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3",
        variant === "ghost" && "text-ink-2 hover:bg-surface-3 hover:text-ink",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("animate-spin", className ?? "size-4")} fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Logo: a lens / an actinic-safe light. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="var(--safe)" strokeWidth="3" />
      <circle cx="16" cy="16" r="3.5" fill="var(--safe)" />
    </svg>
  );
}
