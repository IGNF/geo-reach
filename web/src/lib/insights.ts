import type { LiveInfo } from '../components/MapView';
import { TRAFFIC } from '../engine/profile';
import { t } from '../locales';
import type { Mode } from './config';

/** Traffic level of an hour, from the estimated speed share on major roads */
export const trafficLevel = (hour: number) => {
  const k = TRAFFIC.major[hour];

  return k >= 0.8 ? t.traffic.fluid : k >= 0.6 ? t.traffic.moderate : t.traffic.dense;
};

/** The sentence of the bottom bar: what matters for the chosen mode, undefined when there is nothing to say */
export const insight = (mode: Mode, info: LiveInfo, hour: number) => {
  const min = Math.round(info.limit / 60);
  if (mode === 'transit' && info.transit) return t.insight.transit(info.transit.stations, info.transit.lines, min);
  if (mode === 'pedestrian' && info.nearestStation)
    return t.insight.pedestrian(info.nearestStation.name, Math.max(1, Math.round(info.nearestStation.seconds / 60)));
  if (mode === 'bike' && info.cyclewayKm !== undefined) return t.insight.bike(Math.round(info.cyclewayKm), min);
  if (mode === 'car') {
    // How far one gets: the farthest landmark reached within the limit
    const reached = info.landmarks.filter((l) => l.seconds <= info.limit);
    const far = reached.reduce<(typeof reached)[number] | undefined>((a, l) => (!a || l.km > a.km ? l : a), undefined);
    const traffic = t.insight.car(t.hour(hour), trafficLevel(hour));
    if (!far) return traffic;
    const km = far.km.toLocaleString(t.numberLocale, { maximumFractionDigits: 1 });

    return `${t.insight.farthest(far.name, km, Math.max(1, Math.round(far.seconds / 60)))} · ${traffic}`;
  }

  return undefined;
};
