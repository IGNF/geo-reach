import { Button, ChipGroup, CopyButton, SegmentedSwitch, Slider, Stack, Switch, Typography } from '@ign-junn/design-system';
import { IconArrowsExchange, IconCurrentLocation } from '@ign-junn/design-system/icons';
import { RAMP_GRADIENT_CSS } from '../lib/colors';
import { CONTOURS, MAX_SCALE, type Mode } from '../lib/config';
import { t } from '../locales';

interface ControlBarProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  transitAvailable: boolean;
  bus: boolean;
  onBusChange: (bus: boolean) => void;
  contours: number[];
  onContoursChange: (contours: number[]) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  onLocate: () => void;
  onSwap: () => void;
  shareUrl: string;
  /** One sentence of statistics under the controls */
  stat?: string;
}

const ControlBar = ({
  mode,
  onModeChange,
  transitAvailable,
  bus,
  onBusChange,
  contours,
  onContoursChange,
  scale,
  onScaleChange,
  onLocate,
  onSwap,
  shareUrl,
  stat,
}: ControlBarProps) => {
  const max = MAX_SCALE[mode];
  const modes = [
    { value: 'transit' as const, label: t.modes.transit, disabled: !transitAvailable },
    { value: 'pedestrian' as const, label: t.modes.pedestrian },
    { value: 'car' as const, label: t.modes.car },
  ];

  return (
    <div className="control-bar">
      <Stack direction="row" gap="lg" align="center">
        <Stack gap={6}>
          <SegmentedSwitch label={t.mode} options={modes} value={mode} onChange={onModeChange} />
          {mode === 'transit' && <Switch label={t.bus} checked={bus} onChange={onBusChange} size="xs" />}
        </Stack>
        <ChipGroup
          label={t.isochrones}
          options={CONTOURS.filter((c) => c <= max).map((c) => ({ value: String(c), label: `${c} min` }))}
          value={contours.map(String)}
          onChange={(v) => onContoursChange(v.map(Number).slice(-4))}
        />
        <Stack gap={4} className="scale">
          <Stack direction="row" justify="space-between">
            <Typography variant="caption">{t.scale}</Typography>
            <Typography variant="caption">{scale} min</Typography>
          </Stack>
          <div className="legend-ramp" style={{ background: RAMP_GRADIENT_CSS }} />
          <Slider label={t.scale} min={5} max={max} step={5} value={Math.min(scale, max)} onChange={onScaleChange} />
        </Stack>
        <Stack direction="row" gap="xs">
          <Button label={t.locate} icon={IconCurrentLocation} variant="default" size="xs" onClick={onLocate} />
          <Button label={t.swap} icon={IconArrowsExchange} variant="default" size="xs" onClick={onSwap} />
          <CopyButton value={shareUrl} labels={t.share} variant="button" size="xs" />
        </Stack>
      </Stack>
      {stat && (
        <div className="control-stat">
          <Typography variant="body2">{stat}</Typography>
        </div>
      )}
    </div>
  );
};

export default ControlBar;
