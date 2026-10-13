/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Standalone Vitest config (not the Vite app config): pure unit tests of framework-agnostic logic, node environment,
// no DOM, no app bootstrap. The shared modules (symlinked under src/modules_shared) have their own specs, run by the
// owner repository, so they are excluded here. Run ONE file at a time under docs/migration/tools/guarded_run.sh.
import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'src/modules_shared/**'],
    globals: false,
  },
})
