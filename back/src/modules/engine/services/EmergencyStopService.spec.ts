/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { EmergencyStopService } from './EmergencyStopService';

describe('EmergencyStopService', () => {
  it('runs every registered handler and waits for them', async () => {
    const service = new EmergencyStopService();
    const done: string[] = [];
    service.onStop(async () => {
      await new Promise((r) => setTimeout(r, 10));
      done.push('a');
    });
    service.onStop(async () => void done.push('b'));
    await service.announce();
    expect(done.sort()).toEqual(['a', 'b']);
  });

  it('keeps going when a handler fails, and forgets one that unregistered', async () => {
    const service = new EmergencyStopService();
    const done: string[] = [];
    service.onStop(async () => {
      throw new Error('boom');
    });
    const off = service.onStop(async () => void done.push('gone'));
    service.onStop(async () => void done.push('kept'));
    off();
    await service.announce();
    expect(done).toEqual(['kept']);
  });
});
