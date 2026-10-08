import type { IconComponent } from '@ign-junn/design-system';
import { IconBike, IconCar, IconTrain, IconWalk } from '@ign-junn/design-system/icons';
import type { Mode } from '../lib/config';
import { t } from '../locales';

const MODES: { value: Mode; icon: IconComponent }[] = [
  { value: 'transit', icon: IconTrain },
  { value: 'pedestrian', icon: IconWalk },
  { value: 'bike', icon: IconBike },
  { value: 'car', icon: IconCar },
];

interface ModePickerProps {
  value: Mode;
  onChange: (mode: Mode) => void;
  /** Modes whose data is missing */
  disabled?: Mode[];
}

/** The travel modes as large icon tiles */
const ModePicker = ({ value, onChange, disabled = [] }: ModePickerProps) => (
  <div className="mode-picker" role="radiogroup" aria-label={t.mode}>
    {MODES.map(({ value: mode, icon: Icon }) => (
      <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          className="mode-tile"
          disabled={disabled.includes(mode)}
          onClick={() => onChange(mode)}
        >
          <Icon size={22} stroke={1.8} />
          <span>{t.modes[mode]}</span>
        </button>
    ))}
  </div>
);

export default ModePicker;
