/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** Logo of the app (public/logo-for-*.png, transparent): the variant for the dark theme or the light one, picked by the page's color scheme. */
export function Mark({ size = 24 }: { size?: number }) {
  const common = { height: size, alt: '', 'aria-hidden': true, draggable: false } as const
  return (
    <>
      <img {...common} className="cn-logo-for-dark" src="/logo-for-dark.png" />
      <img {...common} className="cn-logo-for-light" src="/logo-for-light.png" />
    </>
  )
}
