import { GPF_BASE, GPF_RESOURCE, type LngLat, type Mode } from './config';

export interface RouteStep {
  name: string;
  distance: number;
  duration: number;
}

export interface Route {
  coordinates: LngLat[];
  /** Minutes */
  duration: number;
  /** Metres */
  distance: number;
  steps: RouteStep[];
}

const getJson = async <T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> => {
  const res = await fetch(`${GPF_BASE}${path}?${new URLSearchParams(params)}`, { signal });
  if (!res.ok) throw new Error(`GPF ${path}: HTTP ${res.status}`);

  return res.json() as Promise<T>;
};

const fmt = ([lng, lat]: LngLat) => `${lng.toFixed(6)},${lat.toFixed(6)}`;

interface RawStep {
  distance: number;
  duration: number;
  attributes?: { name?: { nom_1_gauche?: string; nom_1_droite?: string } };
}

const stepName = (s: RawStep) => s.attributes?.name?.nom_1_droite || s.attributes?.name?.nom_1_gauche || '';

/** Consecutive steps on the same street become one line of the trip panel */
const mergeSteps = (steps: RawStep[]): RouteStep[] =>
  steps.reduce<RouteStep[]>((acc, s) => {
    const name = stepName(s);
    const last = acc.at(-1);
    if (last && last.name === name) {
      last.distance += s.distance;
      last.duration += s.duration;
    } else acc.push({ name, distance: s.distance, duration: s.duration });

    return acc;
  }, []);

export const fetchRoute = async (
  start: LngLat,
  end: LngLat,
  mode: Exclude<Mode, 'transit' | 'bike'>,
  signal?: AbortSignal,
): Promise<Route> => {
  const body = await getJson<{
    geometry: { coordinates: LngLat[] };
    duration: number;
    distance: number;
    portions: { steps: RawStep[] }[];
  }>(
    '/navigation/itineraire',
    {
      resource: GPF_RESOURCE,
      start: fmt(start),
      end: fmt(end),
      profile: mode,
      optimization: 'fastest',
      getSteps: 'true',
      geometryFormat: 'geojson',
      timeUnit: 'minute',
      distanceUnit: 'meter',
    },
    signal,
  );

  return {
    coordinates: body.geometry.coordinates,
    duration: body.duration,
    distance: body.distance,
    steps: mergeSteps(body.portions.flatMap((p) => p.steps)).filter((s) => s.distance > 1),
  };
};

/** Short label of the nearest address, or of the place when there is no address */
export const reverseGeocode = async ([lon, lat]: LngLat, signal?: AbortSignal) => {
  const body = await getJson<{ features: { properties: { name?: string; city?: string; label?: string } }[] }>(
    '/geocodage/reverse',
    { lon: String(lon), lat: String(lat), limit: '1' },
    signal,
  );
  const p = body.features[0]?.properties;

  return p ? [p.name, p.city].filter(Boolean).join(', ') || p.label : undefined;
};
