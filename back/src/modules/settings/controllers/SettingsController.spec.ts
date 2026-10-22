/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it, jest } from '@jest/globals';
import { UnprocessableEntityException } from '@nestjs/common';
import type { SettingsService } from '../services/SettingsService';
import { SettingsController } from './SettingsController';

describe('SettingsController', () => {
  const pub = { keep_alive_minutes: 10, previews: true, low_memory: true, quantize: {}, variant: {}, has_hf_token: false };
  const make = () => {
    const service = { getPublic: jest.fn(async () => pub), update: jest.fn(async () => pub) };
    return { service, controller: new SettingsController(service as unknown as SettingsService) };
  };

  it('GET returns the public settings', async () => {
    const { controller } = make();
    expect(await controller.get()).toEqual(pub);
  });

  it('PUT validates the body, then hands the patch to the service', async () => {
    const { controller, service } = make();
    await controller.put({ previews: false, unknown: 1 });
    expect(service.update).toHaveBeenCalledWith({ previews: false });
  });

  it('PUT answers 422 on a wrong type without touching the service', () => {
    const { controller, service } = make();
    expect(() => controller.put({ low_memory: 'x' })).toThrow(UnprocessableEntityException);
    expect(service.update).not.toHaveBeenCalled();
  });
});
