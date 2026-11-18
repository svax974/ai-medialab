/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { NoTransportCrypt } from 'src/modules_shared/common/decorators/NoTransportCrypt';
import { Public } from 'src/modules_shared/common/decorators/Public';
import { vtrace } from 'src/modules_shared/common/validation';

interface DesktopDonationMethods {
  btc: string;
  eth: string;
  sol: string;
  stripeUrl: string;
}

/** Only the shell supplies these project-wide public destinations. */
@Controller('api/studio')
@Public()
@NoTransportCrypt()
export class DesktopDonationsController {
  @Get('desktop-donations')
  @Header('Cache-Control', 'no-store')
  get(): { methods: DesktopDonationMethods | null } {
    if (!process.env.DESKTOP_PARENT_PID) return { methods: null };
    const {
      AI_MEDIALAB_DONATION_BTC: btc = '', AI_MEDIALAB_DONATION_ETH: eth = '',
      AI_MEDIALAB_DONATION_SOL: sol = '', AI_MEDIALAB_DONATION_STRIPE_URL: stripeUrl = '',
    } = process.env;
    const valid = /^bc1q[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(btc)
      && /^0x[0-9a-fA-F]{40}$/.test(eth)
      && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(sol)
      && /^https:\/\/buy\.stripe\.com\/[a-zA-Z0-9]+$/.test(stripeUrl);
    if (!valid) {
      vtrace('studio.desktop_donation_config', 'violation');
      throw new ServiceUnavailableException();
    }
    vtrace('studio.desktop_donation_config', 'ok');
    return { methods: { btc, eth, sol, stripeUrl } };
  }
}
