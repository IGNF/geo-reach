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
  if (mode === 'transit' && info.transit) return `${t.insight.transit(info.transit.stations, info.transit.lines, min)} · ${area}`;
  if (mode === 'pedestrian' && info.nearestStation)
    return `${t.insight.pedestrian(info.nearestStation.name, Math.max(1, Math.round(info.nearestStation.seconds / 60)))} · ${area}`;
  if (mode === 'bike' && info.cyclewayKm !== undefined) return `${t.insight.bike(Math.round(info.cyclewayKm), min)} · ${area}`;
  if (mode === 'car') return `${t.insight.car(t.hour(hour), trafficLevel(hour))} · ${area}`;

  return area;
};

export const formatKm2 = km2;
