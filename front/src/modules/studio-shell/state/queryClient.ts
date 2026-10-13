/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { QueryClient } from '@tanstack/react-query'

/** Single query client of the app. Data is kept fresh by invalidations from the event stream, not by window focus. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
})
