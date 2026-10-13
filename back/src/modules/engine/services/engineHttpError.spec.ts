/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { BadGatewayException, HttpException } from '@nestjs/common';
import { EngineError, EngineUnavailableError } from './EngineError';
import { engineErrorToHttp } from './engineHttpError';

describe('engineErrorToHttp', () => {
  it('relays the engine status and string detail', () => {
    const http = engineErrorToHttp(new EngineError(409, '/x', 'Busy'));
    expect(http).toBeInstanceOf(HttpException);
    expect(http).toMatchObject({ status: 409, response: 'Busy' });
  });

  it('keeps a structured detail (validation errors)', () => {
    const detail = [{ loc: ['body', 'x'], msg: 'bad' }];
    expect(engineErrorToHttp(new EngineError(422, '/x', detail))).toMatchObject({ status: 422, response: detail });
  });

  it('maps an unreachable engine to 502', () => {
    expect(engineErrorToHttp(new EngineUnavailableError('/x', new Error('down')))).toBeInstanceOf(BadGatewayException);
  });

  it('returns other errors unchanged', () => {
    const err = new Error('other');
    expect(engineErrorToHttp(err)).toBe(err);
  });
});
