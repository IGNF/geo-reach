import type { LiveInfo } from '../components/MapView';
import { TRAFFIC } from '../engine/profile';
import { t } from '../locales';
import type { Mode } from './config';

/** Traffic level of an hour, from the estimated speed share on major roads */
export const trafficLevel = (hour: number) => {
  const k = TRAFFIC.major[hour];

  return k >= 0.8 ? t.traffic.fluid : k >= 0.6 ? t.traffic.moderate : t.traffic.dense;
};

const km2 = (v: number) => v.toLocaleString(t.numberLocale, { maximumFractionDigits: v < 10 ? 1 : 0 });

/** The sentence of the bottom bar: what matters for the chosen mode */
export const insight = (mode: Mode, info: LiveInfo, hour: number) => {
  const min = Math.round(info.limit / 60);
  const area = t.insight.area(km2(info.areaKm2), min);
  // The duration is said once, in the first part
  const areaShort = t.insight.areaShort(km2(info.areaKm2));
  if (mode === 'transit' && info.transit) return `${t.insight.transit(info.transit.stations, info.transit.lines, min)} · ${areaShort}`;
  if (mode === 'pedestrian' && info.nearestStation)
    return `${t.insight.pedestrian(info.nearestStation.name, Math.max(1, Math.round(info.nearestStation.seconds / 60)))} · ${area}`;
  if (mode === 'bike' && info.cyclewayKm !== undefined) return `${t.insight.bike(Math.round(info.cyclewayKm), min)} · ${areaShort}`;
  if (mode === 'car') {
    // How far one gets: the farthest landmark reached within the limit
    const reached = info.landmarks.filter((l) => l.seconds <= info.limit);
    const far = reached.reduce<(typeof reached)[number] | undefined>((a, l) => (!a || l.km > a.km ? l : a), undefined);
    const traffic = t.insight.car(t.hour(hour), trafficLevel(hour));
    if (!far) return `${area} · ${traffic}`;
    const km = far.km.toLocaleString(t.numberLocale, { maximumFractionDigits: 1 });

    return `${t.insight.farthest(far.name, km, Math.max(1, Math.round(far.seconds / 60)))} · ${traffic}`;
  }

  return area;
};

export const formatKm2 = km2;
