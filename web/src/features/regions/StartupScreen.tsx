import { Box, ProgressBar, Typography } from '@ign-junn/design-system';
import type { ReactElement } from 'react';
import type { StartupProgress } from './startup';
import { t } from '@/locales';
import Brand from '@/shared/ui/Brand';

interface StartupScreenProps {
  progress: StartupProgress;
  /** Fading out: the first map is drawn */
  done: boolean;
}

/** Over the app until the first map is drawn: the progress of the download, the decoding, the engine and the map */
const StartupScreen = ({ progress, done }: StartupScreenProps): ReactElement => {
  const { step, percent, mb } = progress;
  const label = step === 'download' ? t.startup.download((mb ?? 0).toFixed(0)) : t.startup[step];

  return (
    <Box className={done ? 'startup done' : 'startup'} role="status" aria-busy={!done}>
      <Box className="startup-card glass">
        <Brand />

        <ProgressBar label={label} value={Math.round(percent)} animated={!done} size="md" />

        <Typography variant="hint">{t.startup.note}</Typography>
      </Box>
    </Box>
  );
};

export default StartupScreen;
