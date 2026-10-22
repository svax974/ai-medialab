/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it, jest } from '@jest/globals';
import { Subject } from 'rxjs';
import type { EngineEventRelay } from 'src/modules/engine';
import { SettingsEngineSync } from './SettingsEngineSync';
import type { SettingsService } from './SettingsService';

describe('SettingsEngineSync', () => {
  const make = () => {
    const link = new Subject<boolean>();
    const settings = { pushToEngine: jest.fn(async () => true) };
    const sync = new SettingsEngineSync(settings as unknown as SettingsService, { linkChanges$: link.asObservable() } as unknown as EngineEventRelay);
    return { link, settings, sync };
  };

  it('pushes at startup and at each reconnection, not when the link drops', () => {
    const { link, settings, sync } = make();
    sync.onApplicationBootstrap();
    expect(settings.pushToEngine).toHaveBeenCalledTimes(1);
    link.next(true);
    link.next(false);
    link.next(true);
    expect(settings.pushToEngine).toHaveBeenCalledTimes(3);
  });

  it('stops listening when the module is destroyed', () => {
    const { link, settings, sync } = make();
    sync.onApplicationBootstrap();
    sync.onModuleDestroy();
    link.next(true);
    expect(settings.pushToEngine).toHaveBeenCalledTimes(1);
  });
});
