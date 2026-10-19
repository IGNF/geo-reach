import { Box, Button, CopyButton, PreviewPanel, SegmentedSwitch, Slider, Stack, Switch, Typography } from '@ign-junn/design-system';
import { IconAdjustmentsHorizontal, IconInfoCircle, IconScissors } from '@ign-junn/design-system/icons';
import { RAMP_GRADIENT_CSS } from '@/shared/colors';
import { trafficLevel } from '@/features/trip';
import { type Direction, MAX_SCALE, type Mode, PERSPECTIVES, type Perspective } from '@/shared/config';
import { t } from '@/locales';
import type { ModelOptions } from '@/features/routing';
import ModelSection from './ModelSection';
import ModePicker from './ModePicker';
import { useDraft } from './useDraft';
import type { ReactElement } from 'react';
import type { Region } from '@/features/regions';

interface SettingsPanelProps {
  /** Region whose network is loaded: it follows the view */
  region: Region;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  transitAvailable: boolean;
  bus: boolean;
  onBusChange: (bus: boolean) => void;
  hour: number;
  onHourChange: (hour: number) => void;
  model: ModelOptions;
  onModelChange: (patch: Partial<ModelOptions>) => void;
  onReset: () => void;
  /** Cut mode: a click on the map closes a section */
  cutMode: boolean;
  onCutModeChange: (on: boolean) => void;
  perspective: Perspective;
  onPerspectiveChange: (perspective: Perspective) => void;
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  shareUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width: number;
  onWidthChange: (width: number) => void;
}

const HOUR_MARKS = [0, 6, 12, 18, 23].map((h) => ({ value: h, label: t.hour(h) }));

/** Right panel, as high as the window and foldable: what to compute (mode, its options, time, isochrones) */
const SettingsPanel = ({
  region,
  mode,
  onModeChange,
  transitAvailable,
  bus,
  onBusChange,
  hour,
  onHourChange,
  model,
  onModelChange,
  onReset,
  cutMode,
  onCutModeChange,
  perspective,
  onPerspectiveChange,
  direction,
  onDirectionChange,
  scale,
  onScaleChange,
  shareUrl,
  open,
  onOpenChange,
  width,
  onWidthChange,
}: SettingsPanelProps): ReactElement => {
  const max = MAX_SCALE[mode];
  // The hour rebuilds the profile: committed once the thumb is released
  const hourDraft = useDraft(hour, onHourChange);
  const shownHour = hourDraft.value;
  const timed = mode === 'transit' || mode === 'car';
  const directions = [
    { value: 'departure' as const, label: t.directions.departure },
    { value: 'arrival' as const, label: t.directions.arrival },
  ];

  return (
    <PreviewPanel
      open={open}
      onOpenChange={onOpenChange}
      icon={IconAdjustmentsHorizontal}
      caption={t.settingsCaption}
      title={t.modes[mode]}
      labels={t.preview}
      width={width}
      onWidthChange={onWidthChange}
    >
      <Box className="settings-wrap">
      <Box className="settings">
      <Stack gap={2}>
        <Stack direction="row" justify="space-between" align="baseline">
          <Typography variant="caption">{t.region.label}</Typography>
          <Typography variant="strong">{region.name}</Typography>
        </Stack>
        <Typography variant="hint">
          {t.region.follows} {region.transit ? '' : t.region.noTransit}
        </Typography>
      </Stack>
      <Button
        label={cutMode ? t.cuts.done : t.cuts.start}
        icon={IconScissors}
        variant={cutMode ? 'filled' : 'light'}
        color="red"
        fullWidth
        onClick={() => onCutModeChange(!cutMode)}
      />
      <ModePicker value={mode} onChange={onModeChange} disabled={transitAvailable ? [] : ['transit']} />
      <Stack gap={4}>
        <Typography variant="caption">{t.perspective.label}</Typography>
        <SegmentedSwitch
          label={t.perspective.label}
          fullWidth
          value={perspective}
          onChange={onPerspectiveChange}
          options={PERSPECTIVES.map((p) => ({ value: p, label: t.perspective.options[p] }))}
        />
        {perspective !== 'flat' && <Typography variant="hint">{t.perspective.hints[perspective]}</Typography>}
      </Stack>
      {mode === 'transit' && <Switch label={t.bus} checked={bus} onChange={onBusChange} size="xs" />}
      {(mode === 'transit' || mode === 'car') && (
        <Stack gap={4}>
          <Typography variant="caption">{t.scenario}</Typography>
          <SegmentedSwitch
            label={t.scenario}
            fullWidth
            value={model.scenario}
            onChange={(v) => onModelChange({ scenario: v })}
            options={(['normal', 'disrupted', 'severe'] as const).map((v) => ({ value: v, label: t.scenarios[mode][v] }))}
          />
          <Typography variant="hint">
            {t.scenarioHint[mode][model.scenario]}
            {model.scenario !== 'normal' && ` · ${t.scenarioNote}`}
          </Typography>
        </Stack>
      )}
      {timed && (
        <Stack gap={4}>
          <Stack direction="row" justify="space-between">
            <Typography variant="caption">{t.departureAt}</Typography>
            <Typography variant="strong">{t.hour(shownHour)}</Typography>
          </Stack>
          <Slider label={t.departureAt} min={0} max={23} step={1} {...hourDraft} marks={HOUR_MARKS} />
          <Typography variant="hint">{mode === 'car' ? t.trafficNote(trafficLevel(shownHour)) : t.serviceNote}</Typography>
        </Stack>
      )}
      <Stack gap={4} title={t.scaleHint}>
        <Stack direction="row" justify="space-between">
          <Typography variant="caption">{t.scale}</Typography>
          <Typography variant="strong">{Math.min(scale, max)} min</Typography>
        </Stack>
        <Slider label={t.scale} min={5} max={max} step={5} value={Math.min(scale, max)} onChange={onScaleChange} />
        {/* Legend of the map colors, graduated with the chosen max time */}
        <Box className="legend-ramp" style={{ background: RAMP_GRADIENT_CSS }} />
        <Stack direction="row" justify="space-between">
          <Typography variant="caption">0</Typography>
          <Typography variant="caption">{Math.round(Math.min(scale, max) / 2)} min</Typography>
          <Typography variant="caption">{Math.min(scale, max)} min</Typography>
        </Stack>
      </Stack>
      {/* Under its caption, the whole width: the labels are never cut */}
      <Stack gap={4}>
        <Typography variant="caption">{t.mapFrom}</Typography>
        <SegmentedSwitch label={t.mapFrom} options={directions} value={direction} onChange={onDirectionChange} fullWidth />
      </Stack>
      <ModelSection mode={mode} model={model} onChange={onModelChange} onReset={onReset} />
      </Box>
      {/* Fixed at the bottom of the panel, whatever its scroll */}
      <footer className="settings-footer">
        <CopyButton value={shareUrl} labels={t.share} variant="button" size="xs" />
        <Button
          component="a"
          href={`${import.meta.env.BASE_URL}how-it-works.html`}
          label={t.howItWorks}
          icon={IconInfoCircle}
          variant="subtle"
          size="xs"
        />
      </footer>
      </Box>
    </PreviewPanel>
  );
};

export default SettingsPanel;
