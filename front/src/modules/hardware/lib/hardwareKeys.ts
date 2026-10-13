/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** TanStack Query keys of the hardware module. `system` is also invalidated when models or engines change. */
export const hardwareKeys = {
  system: ['system'] as const,
  status: ['engine-status'] as const,
}
