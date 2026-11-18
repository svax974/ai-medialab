/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Module } from '@nestjs/common';
import { DesktopDonationsController } from './DesktopDonationsController';

@Module({ controllers: [DesktopDonationsController] })
export class StudioShellModule {}
