import { Typography } from '@ign-junn/design-system';
import { IconBike, IconCar, IconTrain, IconWalk } from '@ign-junn/design-system/icons';
import type { ReactElement } from 'react';
import type { Mode } from '@/lib/config';
import { formatMinutes } from '@/lib/format';
import { t } from '@/locales';

const ICONS = { transit: IconTrain, pedestrian: IconWalk, bike: IconBike, car: IconCar };

interface ModeComparisonProps {
  /** The modes compared, in order */
  modes: Mode[];
  /** Seconds per mode; undefined while computing */
  seconds?: Partial<Record<Mode, number>>;
  /** The mode of the map */
  mode: Mode;
  onModeChange: (mode: Mode) => void;
}

/** The same trip in each mode, side by side: the fastest stands out, a click shows the map of that mode */
const ModeComparison = ({ modes, seconds, mode, onModeChange }: ModeComparisonProps): ReactElement => {
  const times = modes.map((m) => seconds?.[m]).filter((s): s is number => s !== undefined);
  const fastest = times.length ? Math.min(...times) : undefined;

  return (
    <div className="mode-comparison" aria-busy={!seconds}>
      <Typography variant="caption">{t.compare.title}</Typography>
      <div className="mode-comparison-grid">
        {modes.map((m) => {
          const Icon = ICONS[m];
          const s = seconds?.[m];

          return (
            <button
              key={m}
              type="button"
              className={['mode-choice', m === mode && 'current', s !== undefined && s === fastest && 'fastest'].filter(Boolean).join(' ')}
              title={t.modes[m]}
              aria-label={`${t.modes[m]} : ${s === undefined ? t.compare.none : formatMinutes(s / 60)}`}
              onClick={() => onModeChange(m)}
            >
              <Icon size={16} />
              <strong>{!seconds ? '…' : s === undefined ? '—' : formatMinutes(s / 60)}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ModeComparison;
