/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

import { useState, type ReactNode } from 'react'
import { Box, ButtonBase, Popover, Tooltip } from '@mui/material'
import AspectRatioOutlined from '@mui/icons-material/AspectRatioOutlined'
import ImageOutlined from '@mui/icons-material/ImageOutlined'
import { InfoTip, helpTooltipSlotProps } from '@/modules_shared/common/components/ui/help'
import type { ModelInfo } from '@/modules/model-catalog'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { LabelTooltip, ratioOf } from '@/modules/studio-core'
import type { Asset, GenParams } from '@/modules/studio-core'
import { formatMegapixels } from '@/modules/studio-core/lib/format'
import { IMAGE_HELP } from '../lib/help'
import { ASPECTS, aspectLabel, isQualityActive, resolveSize, visibleQualities } from '../lib/size'

const ACCENT = 'color-mix(in oklab, var(--safe) 60%, transparent)'

/** Rectangle drawn at the proportions of a format. */
function Shape({ ratio, active }: { ratio: number; active: boolean }) {
  const width = ratio >= 1 ? 22 : 22 * ratio
  const height = ratio >= 1 ? 22 / ratio : 22
  return (
    <Box component="span" sx={{ display: 'grid', width: 24, height: 24, placeItems: 'center' }}>
      <Box component="span" sx={{ width, height, borderRadius: '3px', border: '1.5px solid', borderColor: active ? 'var(--safe)' : 'currentColor', backgroundColor: active ? 'var(--safe-soft)' : 'transparent', transition: 'border-color 0.15s' }} />
    </Box>
  )
}

function AspectTile({ active, onClick, label, sub, children }: { active: boolean; onClick: () => void; label: string; sub: string; children: ReactNode }) {
  return (
    <ButtonBase onClick={onClick} aria-pressed={active} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '12px', border: '1px solid', px: '4px', py: 1, transition: 'border-color 0.15s, color 0.15s', borderColor: active ? ACCENT : 'var(--line)', backgroundColor: active ? 'var(--safe-soft)' : 'var(--surface)', color: active ? 'var(--ink)' : 'var(--muted)', '&:hover': { borderColor: active ? ACCENT : 'var(--line-strong)', color: 'var(--ink)' } }}>
      {children}
      <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1 }}>{label}</Box>
      <Box component="span" sx={{ fontSize: 10, lineHeight: 1, color: 'var(--faint)' }}>{sub}</Box>
    </ButtonBase>
  )
}

function DimensionInput({ label, value, model, onChange }: { label: string; value: number; model: ModelInfo; onChange: (value: number) => void }) {
  return (
    <Box component="label" sx={{ flex: 1 }}>
      <Box component="span" sx={{ mb: '4px', display: 'block', fontSize: 11, color: 'var(--muted)' }}>{label}</Box>
      <Box component="input" type="number" min={model.min_side} max={model.max_side} step={model.size_multiple} value={value} onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))} sx={{ height: 36, width: '100%', borderRadius: '8px', border: '1px solid var(--line)', backgroundColor: 'var(--surface)', px: 1.25, fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--ink)', '&:focus': { borderColor: 'var(--line-strong)', outline: 'none' } }} />
    </Box>
  )
}

function QualityRow({ model, params, reference, aspect, onChange }: { model: ModelInfo; params: GenParams; reference: Asset | undefined; aspect: string; onChange: (patch: GenParams) => void }) {
  const t = useT()
  const qualities = visibleQualities(!!reference, aspect)
  return (
    <>
      <Box className="cn-eyebrow" sx={{ mb: 1, mt: 2, display: 'flex', alignItems: 'center', gap: '6px' }}>
        {t('imageStudio.quality.title')} <InfoTip {...IMAGE_HELP.megapixels} />
      </Box>
      <Box sx={{ display: 'grid', gap: '4px', gridTemplateColumns: `repeat(${qualities.length}, 1fr)`, borderRadius: '12px', backgroundColor: 'var(--surface)', p: '4px', boxShadow: '0 0 0 1px var(--line)' }}>
        {qualities.map((quality) => {
          const active = isQualityActive(params, model, quality.mp)
          return (
            <Tooltip key={quality.mp} title={t(quality.hintKey)} placement="top" enterDelay={350} slotProps={helpTooltipSlotProps}>
              <ButtonBase onClick={() => onChange({ megapixels: quality.mp })} aria-pressed={active} sx={{ borderRadius: '8px', px: '4px', py: '6px', fontSize: 12, transition: 'background-color 0.15s, color 0.15s', backgroundColor: active ? 'var(--surface-3)' : 'transparent', color: active ? 'var(--ink)' : 'var(--muted)', '&:hover': { color: 'var(--ink)' } }}>
                {t(quality.labelKey)}
              </ButtonBase>
            </Tooltip>
          )
        })}
      </Box>
    </>
  )
}

/**
 * Format and definition of the image: a button with the current format and size, opening a popover with the format tiles
 * ("Auto" follows the first reference, "Custom" takes pixels), the definition (draft to very high, or the reference's own
 * size) and the resulting size in pixels and megapixels.
 */
export function AspectPicker({ model, params, reference, onChange }: { model: ModelInfo; params: GenParams; reference: Asset | undefined; onChange: (patch: GenParams) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const size = resolveSize(params, model, reference)
  const aspect = params.aspect ?? '1:1'
  const label = aspectLabel(aspect)
  return (
    <>
      <LabelTooltip label={t('imageStudio.aspect.tip')}>
        <ButtonBase onClick={(event) => setAnchor(event.currentTarget)} aria-haspopup="dialog" aria-expanded={!!anchor} sx={{ display: 'flex', height: 32, gap: '6px', borderRadius: '8px', border: '1px solid', borderColor: anchor ? 'var(--line-strong)' : 'var(--line)', backgroundColor: 'var(--surface-2)', px: 1.25, fontSize: 13, color: anchor ? 'var(--ink)' : 'var(--ink-2)', '&:hover': { borderColor: 'var(--line-strong)', color: 'var(--ink)' } }}>
          <AspectRatioOutlined sx={{ fontSize: 14 }} />
          <span>{'key' in label ? t(label.key) : label.text}</span>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>{size.width}×{size.height}</Box>
        </ButtonBase>
      </LabelTooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { width: 340, maxWidth: 'calc(100vw - 24px)', p: 1.5, mt: -1 } } }}>
        <Box className="cn-eyebrow" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {t('imageStudio.aspect.title')} <InfoTip {...IMAGE_HELP.aspect} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
          {reference && (
            <AspectTile active={aspect === 'auto'} onClick={() => onChange({ aspect: 'auto' })} label={t('imageStudio.aspect.auto')} sub={t('imageStudio.aspect.autoSub')}>
              <ImageOutlined sx={{ fontSize: 16 }} />
            </AspectTile>
          )}
          {ASPECTS.map((item) => (
            <AspectTile key={item.id} active={aspect === item.id} onClick={() => onChange({ aspect: item.id })} label={item.id} sub={t(item.labelKey)}>
              <Shape ratio={ratioOf(item.id) ?? 1} active={aspect === item.id} />
            </AspectTile>
          ))}
          <AspectTile active={aspect === 'custom'} onClick={() => onChange({ aspect: 'custom', width: size.width, height: size.height })} label={t('imageStudio.aspect.custom')} sub={t('imageStudio.aspect.customSub')}>
            <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>W×H</Box>
          </AspectTile>
        </Box>

        {aspect === 'custom' ? (
          <>
            <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'flex-end', gap: 1 }}>
              <DimensionInput label={t('imageStudio.size.width')} value={params.width ?? size.width} model={model} onChange={(width) => onChange({ width })} />
              <Box component="span" sx={{ pb: 1, color: 'var(--faint)' }}>×</Box>
              <DimensionInput label={t('imageStudio.size.height')} value={params.height ?? size.height} model={model} onChange={(height) => onChange({ height })} />
            </Box>
            <Box component="p" sx={{ m: 0, mt: '6px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: 11, lineHeight: 1.4, color: 'var(--faint)' }}>
              <span>{t('imageStudio.size.rounding', [model.size_multiple, model.min_side, model.max_side])}</span>
              <InfoTip {...IMAGE_HELP.sizeCustom} />
            </Box>
          </>
        ) : (
          <QualityRow model={model} params={params} reference={reference} aspect={aspect} onChange={onChange} />
        )}
        <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>
          <span>{t('imageStudio.size.output')}</span>
          <Box component="span" sx={{ color: 'var(--ink-2)' }}>{t('imageStudio.size.result', [size.width, size.height])} · {formatMegapixels(size.width, size.height)}</Box>
        </Box>
      </Popover>
    </>
  )
}
