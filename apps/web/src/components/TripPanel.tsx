import { Button, FloatingPanel, SegmentedSwitch, Stack, Typography } from '@ign-junn/design-system';
import { IconCar, IconClockHour4, IconWalk, IconX } from '@ign-junn/design-system/icons';
import type { Leg } from '../engine/legs';
import { rampCss } from '../lib/colors';
import type { Direction } from '../lib/config';
import { formatDistance, formatMinutes, formatStreet } from '../lib/format';
import type { Route } from '../lib/gpf';
import { t } from '../locales';
import type { LiveInfo, TargetInfo } from './MapView';

interface TripPanelProps {
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  pinned: boolean;
  onUnpin: () => void;
  live?: LiveInfo;
  target?: TargetInfo;
  /** Address of the cursor (live) or of the pinned point */
  originAddress?: string;
  targetAddress?: string;
  gpfRoute?: Route;
  /** Minutes */
  scale: number;
  /** Minutes */
  contours: number[];
}

const DIRECTIONS = [
  { value: 'departure' as const, label: t.directions.departure },
  { value: 'arrival' as const, label: t.directions.arrival },
];

const Place = ({ caption, text }: { caption: string; text?: string }) => (
  <Stack gap={2}>
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
  const Icon = leg.kind === 'drive' ? IconCar : leg.kind === 'wait' ? IconClockHour4 : IconWalk;
  const text =
    leg.kind === 'wait'
      ? t.wait(leg.line?.name ?? '')
      : leg.label
        ? formatStreet(leg.label)
        : leg.kind === 'walk'
          ? t.walk
          : t.unnamedRoad;

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

const TripPanel = ({
  direction,
  onDirectionChange,
  pinned,
  onUnpin,
  live,
  target,
  originAddress,
  targetAddress,
  gpfRoute,
  scale,
  contours,
}: TripPanelProps) => {
  const [from, to] = direction === 'departure' ? [originAddress, targetAddress] : [targetAddress, originAddress];

  return (
    <FloatingPanel
      title={pinned ? t.panelTrip : t.panelExplore}
      width={340}
      collapseLabels={t.collapse}
      footer={
        <Stack direction="row" gap="xs" justify="space-between">
          <Typography variant="hint">{t.mapFrom}</Typography>
          <SegmentedSwitch label={t.mapFrom} options={DIRECTIONS} value={direction} onChange={onDirectionChange} />
        </Stack>
      }
    >
      {pinned ? (
        <Stack gap="sm">
          <Stack direction="row" justify="space-between" align="flex-start" wrap="nowrap">
            <Stack gap="xs" style={{ minWidth: 0 }}>
              <Place caption={t.departure} text={from} />
              <Place caption={t.arrival} text={target ? to : undefined} />
            </Stack>
            <Button label={t.removePoint} icon={IconX} iconOnly variant="subtle" onClick={onUnpin} />
          </Stack>
          {target ? (
            <>
              <Stack direction="row" gap="xs" align="baseline">
                <span className="trip-duration" style={{ color: rampCss(target.seconds / 60 / scale) }}>
                  {formatMinutes(target.seconds / 60)}
                </span>
                {gpfRoute && (
                  <Typography variant="hint">{t.gpfDuration(formatMinutes(gpfRoute.duration))}</Typography>
                )}
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
        </Stack>
      ) : (
        <Stack gap="sm">
          <Place caption={t.fromCursor} text={originAddress} />
          {live && contours.length > 0 && (
            <ol className="trip-steps">
              {contours.map((c, i) => (
                <li key={c}>
                  <span className="dot" style={{ background: rampCss(c / scale) }} />
                  <span className="trip-step-name">{t.within(c)}</span>
                  <span className="trip-step-meta">{t.streetsKm(Math.round(live.reachedKm[i] ?? 0))}</span>
                </li>
              ))}
            </ol>
          )}
          <Typography variant="hint">{t.exploreHint}</Typography>
          {live && (
            <Typography variant="caption">
              {t.engineStats(live.runMs.toFixed(1), live.settled.toLocaleString(t.numberLocale))}
            </Typography>
          )}
        </Stack>
      )}
    </FloatingPanel>
  );
};

export default TripPanel;
