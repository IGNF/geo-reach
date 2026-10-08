import { Button, CopyButton, PreviewPanel, SegmentedSwitch, Slider, Stack, Switch, Typography } from '@ign-junn/design-system';
import { IconAdjustmentsHorizontal, IconInfoCircle } from '@ign-junn/design-system/icons';
import { RAMP_GRADIENT_CSS } from '../lib/colors';
import { trafficLevel } from '../lib/insights';
import { contourMinutes, type Direction, MAX_SCALE, type Mode } from '../lib/config';
import { t } from '../locales';
import type { ModelOptions } from '../engine/profile';
import ModelSection from './ModelSection';
import ModePicker from './ModePicker';

interface SettingsPanelProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  transitAvailable: boolean;
  bus: boolean;
  onBusChange: (bus: boolean) => void;
  hour: number;
  onHourChange: (hour: number) => void;
  model: ModelOptions;
  onModelChange: (patch: Partial<ModelOptions>) => void;
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  contours: boolean;
  onContoursChange: (contours: boolean) => void;
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
  mode,
  onModeChange,
  transitAvailable,
  bus,
  onBusChange,
  hour,
  onHourChange,
  model,
  onModelChange,
  direction,
  onDirectionChange,
  contours,
  onContoursChange,
  scale,
  onScaleChange,
  shareUrl,
  open,
  onOpenChange,
  width,
  onWidthChange,
}: SettingsPanelProps) => {
  const max = MAX_SCALE[mode];
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
      <div className="settings-wrap">
      <div className="settings">
      <ModePicker value={mode} onChange={onModeChange} disabled={transitAvailable ? [] : ['transit']} />
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
            <Typography variant="strong">{t.hour(hour)}</Typography>
          </Stack>
          <Slider label={t.departureAt} min={0} max={23} step={1} value={hour} onChange={onHourChange} marks={HOUR_MARKS} />
          <Typography variant="hint">{mode === 'car' ? t.trafficNote(trafficLevel(hour)) : t.serviceNote}</Typography>
        </Stack>
      )}
      <Stack gap={4} title={t.scaleHint}>
        <Stack direction="row" justify="space-between">
          <Typography variant="caption">{t.scale}</Typography>
          <Typography variant="strong">{Math.min(scale, max)} min</Typography>
        </Stack>
        <Slider label={t.scale} min={5} max={max} step={5} value={Math.min(scale, max)} onChange={onScaleChange} />
        {/* Legend of the map colors, graduated with the chosen max time */}
        <div className="legend-ramp" style={{ background: RAMP_GRADIENT_CSS }} />
        <div className="legend-ticks">
          <span>0</span>
          <span>{Math.round(Math.min(scale, max) / 2)} min</span>
          <span>{Math.min(scale, max)} min</span>
        </div>
      </Stack>
      <Switch
        label={t.contours(contourMinutes(Math.min(scale, max))[0] ?? 10)}
        description={t.contoursHint}
        checked={contours}
        onChange={onContoursChange}
        size="xs"
      />
      {/* Under its caption, the whole width: the labels are never cut */}
      <Stack gap={4}>
        <Typography variant="caption">{t.mapFrom}</Typography>
        <SegmentedSwitch label={t.mapFrom} options={directions} value={direction} onChange={onDirectionChange} fullWidth />
      </Stack>
      <ModelSection mode={mode} model={model} onChange={onModelChange} />
      </div>
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
      </div>
    </PreviewPanel>
  );
};

export default SettingsPanel;
