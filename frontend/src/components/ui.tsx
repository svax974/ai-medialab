// Petits composants d'interface partagés.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cx } from "../lib/format";

export function Tip({ label, children, side = "top", kbd }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; kbd?: string }) {
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[70] flex items-center gap-2 rounded-lg border border-line-strong bg-surface-3 px-2.5 py-1.5 text-xs text-ink shadow-xl animate-fade"
        >
          {label}
          {kbd && <Kbd>{kbd}</Kbd>}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
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
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, kbd, tone = "ghost", size = "md", active, className, children, tipSide, ...rest },
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
    <Tip label={label} kbd={kbd} side={tipSide}>
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

/** Logo : un objectif / une lumière inactinique. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="var(--safe)" strokeWidth="3" />
      <circle cx="16" cy="16" r="3.5" fill="var(--safe)" />
    </svg>
  );
}
