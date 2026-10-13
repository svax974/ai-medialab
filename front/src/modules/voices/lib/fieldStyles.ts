/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

/** Style of the text fields of the voice studio (input, select, textarea). */
export const inputSx = { height: 36, width: '100%', borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', px: 1.25, fontFamily: 'inherit', fontSize: 14, color: 'var(--ink)', '&::placeholder': { color: 'var(--faint)' }, '&:focus': { borderColor: 'var(--line-strong)', outline: 'none' } } as const
