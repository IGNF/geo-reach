import { GPF_BASE, GPF_RESOURCE, type LngLat, type Mode } from '@/shared/config';

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

/** Answers kept, by URL: coming back to a point, or typing back a letter, asks nothing again */
const CACHE_SIZE = 128;
const answers = new Map<string, unknown>();

/** A Géoplateforme answer, from the cache when the same request was answered before (the least recent one goes first) */
const getJson = async <T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> => {
  const url = `${GPF_BASE}${path}?${new URLSearchParams(params)}`;
  if (answers.has(url)) {
    const kept = answers.get(url);
    answers.delete(url);
    answers.set(url, kept);

    return kept as T;
  }

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GPF ${path}: HTTP ${res.status}`);
  const body: unknown = await res.json();
  answers.set(url, body);
  if (answers.size > CACHE_SIZE) answers.delete(answers.keys().next().value as string);

  return body as T;
};

/** Six decimals: a tenth of a metre, the same point gives the same request */
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
export const reverseGeocode = async ([lon, lat]: LngLat, signal?: AbortSignal): Promise<string | undefined> => {
  const body = await getJson<{ features: { properties: { name?: string; city?: string; label?: string } }[] }>(
    '/geocodage/reverse',
    { lon: lon.toFixed(6), lat: lat.toFixed(6), limit: '1' },
    signal,
  );
  const p = body.features[0]?.properties;

  return p ? [p.name, p.city].filter(Boolean).join(', ') || p.label : undefined;
};

/** An address or a place offered while typing */
export interface Suggestion {
  label: string;
  point: LngLat;
}

/**
 * Addresses and places (stations, monuments, towns) of metropolitan France matching the typed text: the completion
 * service of the Géoplateforme, made for typing (a few tens of milliseconds)
 */
export const completeAddress = async (text: string, signal?: AbortSignal): Promise<Suggestion[]> => {
  const body = await getJson<{ results?: { fulltext: string; x: number; y: number }[] }>(
    '/geocodage/completion/',
    { text, type: 'StreetAddress,PositionOfInterest', terr: 'METROPOLE', maximumResponses: '6' },
    signal,
  );

  // One suggestion per label: a town comes back as several kinds of place
  const seen = new Set<string>();

  return (body.results ?? []).flatMap(({ fulltext, x, y }) => {
    if (seen.has(fulltext)) return [];
    seen.add(fulltext);

    return [{ label: fulltext, point: [x, y] }];
  });
};
