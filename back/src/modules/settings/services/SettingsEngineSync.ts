/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Subscription, filter } from 'rxjs';
import { EngineEventRelay } from 'src/modules/engine';
import { SettingsService } from './SettingsService';

/** Hands the settings to the engine at startup and whenever its event stream reconnects (it may have restarted). */
@Injectable()
export class SettingsEngineSync implements OnApplicationBootstrap, OnModuleDestroy {
  private subscription: Subscription | null = null;

  constructor(
    private readonly settings: SettingsService,
    private readonly relay: EngineEventRelay,
  ) {}

  onApplicationBootstrap(): void {
    this.subscription = this.relay.linkChanges$.pipe(filter((connected) => connected)).subscribe(() => void this.settings.pushToEngine());
    void this.settings.pushToEngine();
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
