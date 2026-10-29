import { Box, Button, Grid, Stack, Typography } from '@ign-junn/design-system';
import {
  IconBike,
  IconCar,
  IconClockHour4,
  IconTrendingDown,
  IconTrendingUp,
  IconWalk,
  IconX,
} from '@ign-junn/design-system/icons';
import type { Leg } from './legs';
import { rampCss } from '@/shared/colors';
import type { Mode } from '@/shared/config';
import { formatDistance, formatMinutes, formatStreet } from '@/shared/format';
import type { Route } from '@/shared/gpf';
import { t } from '@/locales';
import type { LiveInfo, TargetInfo } from '@/features/map';
import type { ReactElement } from 'react';
import ModeComparison from './ModeComparison';
import Brand from '@/shared/ui/Brand';
import LineBadge from '@/shared/ui/LineBadge';

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
  /** The same trip in each mode */
  comparison?: { modes: Mode[]; seconds?: Partial<Record<Mode, number>> };
  onModeChange: (mode: Mode) => void;
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
      <Box component="li">
        <LineBadge name={leg.line.name} color={leg.line.color} textColor={leg.line.textColor} />
        <Box component="span" className="trip-step-name">
          {leg.from} → {leg.to}
        </Box>
        <Box component="span" className="trip-step-meta">{formatMinutes(leg.seconds / 60)}</Box>
      </Box>
    );
  const Icon = { drive: IconCar, cycle: IconBike, wait: IconClockHour4, walk: IconWalk, ride: IconWalk }[leg.kind];
  const text =
    leg.kind === 'wait' ? t.wait(leg.line?.name ?? '') : leg.label ? formatStreet(leg.label) : leg.kind === 'walk' ? t.walk : t.unnamedRoad;

  return (
    <Box component="li">
      <Icon size={15} />
      <Box component="span" className="trip-step-name">{text}</Box>
      <Box component="span" className="trip-step-meta">
        {leg.metres > 0 && `${formatDistance(leg.metres)} · `}
        {formatMinutes(leg.seconds / 60)}
      </Box>
    </Box>
  );
};

/** Climb and descent of the trip, when it has some: walking and cycling, slopes from the BD TOPO Z */
const Relief = ({ legs }: { legs: Leg[] }) => {
  const climb = Math.round(legs.reduce((sum, leg) => sum + (leg.climb ?? 0), 0));
  const descent = Math.round(legs.reduce((sum, leg) => sum + (leg.descent ?? 0), 0));
  if (climb < 2 && descent < 2) return null;

  return (
    <Box component="span" className="trip-relief">
      <Box component="span" title={t.climb(climb)} aria-label={t.climb(climb)}>
        <IconTrendingUp size={14} /> {climb} m
      </Box>
      <Box component="span" title={t.descent(descent)} aria-label={t.descent(descent)}>
        <IconTrendingDown size={14} /> {descent} m
      </Box>
    </Box>
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
    <Grid cols={tiles.length} gap="xs">
      {tiles.map(([value, label]) => (
        <Stack key={label} gap={2} className="tile">
          <Typography variant="strong">{value}</Typography>
          <Typography variant="caption">{label}</Typography>
        </Stack>
      ))}
    </Grid>
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
  comparison,
  onModeChange,
}: TripPanelProps): ReactElement => {
  // Map from the departure: the cursor is the departure, the anchored point the arrival; and the reverse
  const [from, to] = direction === 'departure' ? [targetAddress, originAddress] : [originAddress, targetAddress];

  return (
    <Box component="section" className="glass card">
      <Brand />
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
                <Box component="span" className="trip-duration" style={{ color: rampCss(target.seconds / 60 / scale, direction) }}>
                  {formatMinutes(target.seconds / 60)}
                </Box>
                {gpfRoute && <Typography variant="hint">{t.gpfDuration(formatMinutes(gpfRoute.duration))}</Typography>}
                <Relief legs={target.legs} />
              </Stack>
              {comparison && (
                <ModeComparison modes={comparison.modes} seconds={comparison.seconds} mode={mode} onModeChange={onModeChange} />
              )}
              <Box component="ol" className="trip-steps">
                {target.legs.slice(0, 12).map((leg, i) => (
                  <LegRow key={`${i}-${leg.kind}-${leg.label}`} leg={leg} />
                ))}
              </Box>
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
              <Box component="ol" className="trip-steps">
                {live.landmarks.slice(0, 6).map((l) => (
                  <Box component="li" key={l.name}>
                    <Box component="span"
                      className="dot"
                      style={{ background: l.seconds <= scale * 60 ? rampCss(l.seconds / 60 / scale, direction) : 'var(--mantine-color-gray-4)' }}
                    />
                    <Box component="span" className="trip-step-name">{l.name}</Box>
                    <Box component="span" className="trip-step-meta">
                      {Number.isFinite(l.seconds) ? formatMinutes(l.seconds / 60) : t.beyond(scale)}
                    </Box>
                  </Box>
                ))}
              </Box>
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
    </Box>
  );
};

export default TripPanel;
