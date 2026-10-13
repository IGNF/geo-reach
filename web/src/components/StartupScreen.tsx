import { ProgressBar, Typography } from '@ign-junn/design-system';
import type { ReactElement } from 'react';
import type { StartupProgress } from '@/lib/startup';
import { t } from '@/locales';

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
    <div className={done ? 'startup done' : 'startup'} role="status" aria-busy={!done}>
      <div className="startup-card glass">
        <header className="brand">
          <span className="brand-dot" />
          <div>
            <Typography variant="subtitle1">{t.appName}</Typography>
            <Typography variant="caption">{t.tagline}</Typography>
          </div>
        </header>

        <ProgressBar label={label} value={Math.round(percent)} animated={!done} size="md" />

        <Typography variant="hint">{t.startup.note}</Typography>
      </div>
    </div>
  );
};

export default StartupScreen;
