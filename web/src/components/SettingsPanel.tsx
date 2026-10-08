import { ChipGroup, CopyButton, PreviewPanel, SegmentedSwitch, Slider, Stack, Switch, Typography } from '@ign-junn/design-system';
import { IconAdjustmentsHorizontal } from '@ign-junn/design-system/icons';
import { RAMP_GRADIENT_CSS } from '../lib/colors';
import { trafficLevel } from '../lib/insights';
import { CONTOURS, type Direction, MAX_SCALE, type Mode } from '../lib/config';
import { t } from '../locales';
import ModePicker from './ModePicker';

interface SettingsPanelProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  transitAvailable: boolean;
  bus: boolean;
  onBusChange: (bus: boolean) => void;
  hour: number;
  onHourChange: (hour: number) => void;
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  contours: number[];
  onContoursChange: (contours: number[]) => void;
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
      <div className="settings">
      <ModePicker value={mode} onChange={onModeChange} disabled={transitAvailable ? [] : ['transit']} />
      {mode === 'transit' && <Switch label={t.bus} checked={bus} onChange={onBusChange} size="xs" />}
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
      <ChipGroup
        label={t.isochrones}
        options={CONTOURS.filter((c) => c <= max).map((c) => ({ value: String(c), label: `${c} min` }))}
        value={contours.filter((c) => c <= max).map(String)}
        onChange={(v) => onContoursChange(v.map(Number).slice(-4))}
      />
      <Stack direction="row" justify="space-between" align="center">
        <Typography variant="caption">{t.mapFrom}</Typography>
        <SegmentedSwitch label={t.mapFrom} options={directions} value={direction} onChange={onDirectionChange} />
      </Stack>
      <CopyButton value={shareUrl} labels={t.share} variant="button" size="xs" />
      </div>
    </PreviewPanel>
  );
};

export default SettingsPanel;
