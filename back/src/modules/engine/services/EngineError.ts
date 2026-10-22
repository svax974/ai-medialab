/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

/** The engine answered with a non-2xx status. `detail` is FastAPI's `detail` (string or validation list). */
export class EngineError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: unknown,
  ) {
    super(`Engine ${path} -> ${status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    this.name = 'EngineError';
  }
}

/** The engine could not be reached (not started, timeout, connection reset). */
export class EngineUnavailableError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`Engine unreachable (${path}): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'EngineUnavailableError';
  }
}
