import { Button, Stack, Typography } from '@ign-junn/design-system';
import { IconBike, IconCar, IconClockHour4, IconWalk, IconX } from '@ign-junn/design-system/icons';
import type { Leg } from '../engine/legs';
import { rampCss } from '../lib/colors';
import type { Mode } from '../lib/config';
import { formatDistance, formatMinutes, formatStreet } from '../lib/format';
import type { Route } from '../lib/gpf';
import { t } from '../locales';
import type { LiveInfo, TargetInfo } from './MapView';

interface TripPanelProps {
  mode: Mode;
  direction: 'departure' | 'arrival';
  pinned: boolean;
  onUnpin: () => void;
  live?: LiveInfo;
  target?: TargetInfo;
  /** Address of the cursor (live) or of the anchored point */
  originAddress?: string;
  /** Address of the point where the cursor stopped */
  targetAddress?: string;
  gpfRoute?: Route;
  /** Minutes */
  scale: number;
  /** Message about the last action (e.g. location unavailable) */
  notice?: string;
}

const Place = ({ caption, text }: { caption: string; text?: string }) => (
  <Stack gap={2} style={{ minWidth: 0 }}>
    <Typography variant="caption">{caption}</Typography>
    <Typography variant="subtitle2" truncate>
      {text ? t.near(text) : '…'}
    </Typography>
  </Stack>
);

const LegRow = ({ leg }: { leg: Leg }) => {
  if (leg.kind === 'ride' && leg.line)
    return (
      <li>
        <span className="line-badge" style={{ background: leg.line.color, color: leg.line.textColor }}>
          {leg.line.name}
        </span>
        <span className="trip-step-name">
          {leg.from} → {leg.to}
        </span>
        <span className="trip-step-meta">{formatMinutes(leg.seconds / 60)}</span>
      </li>
    );
  const Icon = { drive: IconCar, cycle: IconBike, wait: IconClockHour4, walk: IconWalk, ride: IconWalk }[leg.kind];
  const text =
    leg.kind === 'wait' ? t.wait(leg.line?.name ?? '') : leg.label ? formatStreet(leg.label) : leg.kind === 'walk' ? t.walk : t.unnamedRoad;

  return (
    <li>
      <Icon size={15} />
      <span className="trip-step-name">{text}</span>
      <span className="trip-step-meta">
        {leg.metres > 0 && `${formatDistance(leg.metres)} · `}
        {formatMinutes(leg.seconds / 60)}
      </span>
    </li>
  );
};

/** Key figures of the explored point, none when the mode has none */
const Tiles = ({ mode, live }: { mode: Mode; live: LiveInfo }) => {
  const tiles: [string, string][] = [];
  if (live.transit) tiles.push([String(live.transit.stations), t.stationsTile], [String(live.transit.lines), t.linesTile]);
  if (mode === 'bike' && live.cyclewayKm !== undefined) tiles.push([String(Math.round(live.cyclewayKm)), t.cyclewayTile]);
  if (live.nearestStation) tiles.push([formatMinutes(live.nearestStation.seconds / 60), t.nearestTile]);

  if (!tiles.length) return null;

  return (
    <div className="tiles">
      {tiles.map(([value, label]) => (
        <div key={label} className="tile">
          <strong>{value}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
};

/** Right panel: what the explored or pinned point reaches */
const TripPanel = ({
  mode,
  direction,
  pinned,
  onUnpin,
  live,
  target,
  originAddress,
  targetAddress,
  gpfRoute,
  scale,
  notice,
}: TripPanelProps) => {
  // Map from the departure: the cursor is the departure, the anchored point the arrival; and the reverse
  const [from, to] = direction === 'departure' ? [targetAddress, originAddress] : [originAddress, targetAddress];

  return (
    <section className="glass card">
      <header className="brand">
        <span className="brand-dot" />
        <div>
          <Typography variant="subtitle1">{t.appName}</Typography>
          <Typography variant="caption">{t.tagline}</Typography>
        </div>
      </header>
      {notice && <Typography variant="error">{notice}</Typography>}
      {pinned ? (
        <Stack gap="sm">
          <Stack direction="row" justify="space-between" align="center" wrap="nowrap">
            <Typography variant="subtitle1">{t.panelTrip}</Typography>
            <Button label={t.removePoint} icon={IconX} variant="light" size="xs" onClick={onUnpin} />
          </Stack>
          <Place caption={t.departure} text={from} />
          <Place caption={t.arrival} text={to} />
          {target ? (
            <>
              <Stack direction="row" gap="xs" align="baseline">
                <span className="trip-duration" style={{ color: rampCss(target.seconds / 60 / scale) }}>
                  {formatMinutes(target.seconds / 60)}
                </span>
                {gpfRoute && <Typography variant="hint">{t.gpfDuration(formatMinutes(gpfRoute.duration))}</Typography>}
              </Stack>
              <ol className="trip-steps">
                {target.legs.slice(0, 12).map((leg, i) => (
                  <LegRow key={`${i}-${leg.kind}-${leg.label}`} leg={leg} />
                ))}
              </ol>
            </>
          ) : (
            <Typography variant="hint">{t.tripHint}</Typography>
          )}
          {live && <Tiles mode={mode} live={live} />}
        </Stack>
      ) : (
        <Stack gap="sm">
          <Typography variant="subtitle1">{t.panelExplore}</Typography>
          <Place caption={t.fromCursor} text={originAddress} />
          {live && <Tiles mode={mode} live={live} />}
          {live && (
            <Stack gap={6}>
              <Typography variant="caption">{t.timesTo}</Typography>
              <ol className="trip-steps">
                {live.landmarks.slice(0, 6).map((l) => (
                  <li key={l.name}>
                    <span
                      className="dot"
                      style={{ background: l.seconds <= scale * 60 ? rampCss(l.seconds / 60 / scale) : 'var(--mantine-color-gray-4)' }}
                    />
                    <span className="trip-step-name">{l.name}</span>
                    <span className="trip-step-meta">
                      {Number.isFinite(l.seconds) ? formatMinutes(l.seconds / 60) : t.beyond(scale)}
                    </span>
                  </li>
                ))}
              </ol>
            </Stack>
          )}
          <Typography variant="hint">{t.exploreHint}</Typography>
          {live && (
            <Typography variant="caption">
              {t.engineStats(live.runMs.toFixed(1), live.settled.toLocaleString(t.numberLocale))}
            </Typography>
          )}
        </Stack>
      )}
    </section>
  );
};

export default TripPanel;
