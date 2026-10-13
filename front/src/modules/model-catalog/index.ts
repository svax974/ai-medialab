/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

export { ModelsDialog } from './components/ModelsDialog'
export { ModelPicker } from './components/ModelPicker'
export { GatedNotice, LicenseWarning, VideoBadges } from './components/ModelBadges'
export { Notice, Section, Tag } from './components/panels'
export { useSizeLabel } from './hooks/useSizeLabel'
export { useActiveModel, useModels, useRefreshCatalog, useStartDownload, useCancelDownload, useWelcomeModel } from './hooks/useModelCatalog'
export { DOWNLOAD_TOPIC, useDownloadEvents } from './hooks/useDownloadEvents'
export { activeDownload, downloadError } from './lib/downloads'
export { remainingGb } from './lib/catalogFormat'
export { modelCatalogKeys } from './lib/modelCatalogKeys'
export { modelCatalogApi } from './services/modelCatalogApi'
export { useDownloadStore } from './state/downloadStore'
export { useModelSelectionStore } from './state/modelSelectionStore'
export type * from './types'
