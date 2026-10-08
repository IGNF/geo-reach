import { useEffect, useState } from 'react';
import type { Direction, LngLat, Mode } from './config';
import { fetchRoute, reverseGeocode, type Route } from './gpf';

/**
 * Géoplateforme route between the pinned origin and the point where the cursor stopped, to compare with the local
 * engine (walk and car only: the GPF has no public transport nor bike profile). The latest request wins.
 */
export const useGpfRoute = (origin: LngLat | undefined, target: LngLat | undefined, mode: Mode, direction: Direction) => {
  const [latest, setLatest] = useState<{ target: LngLat; route: Route }>();

  useEffect(() => {
    if (!origin || !target || mode === 'transit' || mode === 'bike') return;
    const controller = new AbortController();
    const [start, end] = direction === 'departure' ? [origin, target] : [target, origin];
    fetchRoute(start, end, mode, controller.signal)
      .then((route) => setLatest({ target, route }))
      .catch(() => undefined);

    return () => controller.abort();
  }, [origin, target, mode, direction]);

  return latest && latest.target === target ? latest.route : undefined;
};

/** Address near a point, asked once the point stays still a moment */
export const useAddress = (point: LngLat | undefined, delay = 250) => {
  const [address, setAddress] = useState<string>();

  useEffect(() => {
    if (!point) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        reverseGeocode(point, controller.signal)
          .then(setAddress)
          .catch(() => undefined),
      delay,
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [point, delay]);

  return address;
};
