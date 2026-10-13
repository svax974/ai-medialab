/**
 * VXFramework
 *
 * Copyright (c) 2025-2026 Stéphane VAXELAIRE <svax974@gmail.com>
 * SPDX-License-Identifier: MIT
 *
 * Licensed under the MIT License. See LICENSE in the project root.
 */

import type { ReactNode } from 'react';
import { ThemeModeProvider } from '@/modules_shared/common/components/ui/theme/ThemeModeProvider';
import { AppMuiTheme } from '@/themes/AppMuiTheme';
import { StudioProviders } from '@/modules/studio-shell';
import { VisualThemeProvider } from '@/modules_shared/common/theme/VisualThemeContext';
import { ThemeShell } from '@/modules_shared/common/theme/ThemeShell';
import Router from './components/Router';
import { PreloaderGate } from '@/modules_shared/common/core/preload/PreloaderGate';
import { PageLayout } from '@/components/PageLayout';
import { configurationService } from './modules_shared/common/services/ConfigurationService';
import { cryptService } from '@/modules_shared/common/services/CryptService';
import { localeService } from '@/modules_shared/common/services/LocaleService';
import { buildPreloadPlan } from '@/modules_shared/common/core/preload/preloadPlan';
import { withPluginProviders } from '@/modules_shared/common/plugins/pluginProviders';
import type { PreloadEntry } from '@/modules_shared/common/plugins/AppPlugin';
import { BrowserRouter } from 'react-router-dom';
import { appPlugins } from './plugins';

interface AppProps {
  children?: ReactNode;
}

/**
 * Services of the core, always loaded (blocking). An app that does not need one removes it here (e.g. `crypt` when it
 * does not use transport encryption); plugins add theirs through `preload` (`mode: 'background'` = not awaited).
 */
export const coreServices: PreloadEntry[] = [
  { key: 'ConfigurationService', service: configurationService },
  { key: 'CryptService', service: cryptService },
  { key: 'LocaleService', service: localeService },
];

const preloadPlan = buildPreloadPlan(coreServices, appPlugins);

function App({ children }: AppProps) {
  return (
    <>
      {withPluginProviders(
        <ThemeModeProvider>
          <AppMuiTheme>
            <BrowserRouter>
              <PreloaderGate services={preloadPlan.blocking} background={preloadPlan.background}>
                <StudioProviders>
                  <VisualThemeProvider>
                    <ThemeShell appName="AI MediaLab">
                      {withPluginProviders(
                        <PageLayout>
                          {children ?? <Router />}
                        </PageLayout>,
                        appPlugins,
                        'inner',
                      )}
                    </ThemeShell>
                  </VisualThemeProvider>
                </StudioProviders>
              </PreloaderGate>
            </BrowserRouter>
          </AppMuiTheme>
        </ThemeModeProvider>,
        appPlugins,
      )}
    </>
  );
}

export default App;
