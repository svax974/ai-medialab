/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Logo: a lens / an actinic-safe light. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="var(--safe)" strokeWidth="3" />
      <circle cx="16" cy="16" r="3.5" fill="var(--safe)" />
    </svg>
  )
}
