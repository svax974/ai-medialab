/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { DesktopDonationsController } from './DesktopDonationsController';

const { server: { env } } = JSON.parse(readFileSync(resolve(__dirname, '../../../../desktop/desktop.config.json'), 'utf8'));

describe('DesktopDonationsController', () => {
  const controller = new DesktopDonationsController();

  afterEach(() => { jest.restoreAllMocks(); });

  it('publishes the bundled desktop recipients without exposing other environment variables', () => {
    jest.replaceProperty(process, 'env', { ...process.env, ...env, DESKTOP_PARENT_PID: '123' });
    expect(controller.get()).toEqual({ methods: {
      btc: env.AI_MEDIALAB_DONATION_BTC,
      eth: env.AI_MEDIALAB_DONATION_ETH,
      sol: env.AI_MEDIALAB_DONATION_SOL,
      stripeUrl: env.AI_MEDIALAB_DONATION_STRIPE_URL,
    } });
  });

  it('withholds desktop recipients on a regular web deployment', () => {
    jest.replaceProperty(process, 'env', { ...process.env, ...env, DESKTOP_PARENT_PID: '' });
    expect(controller.get()).toEqual({ methods: null });
  });

  it('withholds a malformed destination instead of rendering it as a payment link', () => {
    jest.replaceProperty(process, 'env', {
      ...process.env, ...env, DESKTOP_PARENT_PID: '123', AI_MEDIALAB_DONATION_STRIPE_URL: 'https://buy.stripe.com.example.com/a',
    });
    expect(() => controller.get()).toThrow(ServiceUnavailableException);
  });
});
