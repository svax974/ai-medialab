/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { BadGatewayException, HttpException } from '@nestjs/common';
import { EngineError, EngineUnavailableError } from './EngineError';

/**
 * Maps an engine failure to the HTTP error a Nest route returns: the engine's own status and `detail` (a 409 "a
 * generation is running", a 422 "unknown quantization") are relayed; an unreachable engine is a 502 like the proxy's.
 * Any other error is returned unchanged.
 */
export function engineErrorToHttp(error: unknown): unknown {
  if (error instanceof EngineError) {
    const detail = error.detail;
    return new HttpException(typeof detail === 'string' ? detail : (detail ?? error.message), error.status);
  }
  if (error instanceof EngineUnavailableError) return new BadGatewayException('Engine unavailable');
  return error;
}
