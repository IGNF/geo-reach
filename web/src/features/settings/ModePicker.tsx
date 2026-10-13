import { Box } from '@ign-junn/design-system';
import type { IconComponent } from '@ign-junn/design-system';
import { IconBike, IconCar, IconTrain, IconWalk } from '@ign-junn/design-system/icons';
import type { Mode } from '@/shared/config';
import { t } from '@/locales';
import type { ReactElement } from 'react';

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
const ModePicker = ({ value, onChange, disabled = [] }: ModePickerProps): ReactElement => (
  <Box className="mode-picker" role="radiogroup" aria-label={t.mode}>
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
          <Box component="span">{t.modes[mode]}</Box>
        </button>
    ))}
  </Box>
);

export default ModePicker;
