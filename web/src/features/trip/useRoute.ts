import { useEffect, useState } from 'react';
import type { Direction, LngLat, Mode } from '@/shared/config';
import { fetchRoute, reverseGeocode, type Route } from '@/shared/gpf';

interface RouteRequest {
  origin: LngLat;
  target: LngLat;
  mode: Mode;
  direction: Direction;
}

/**
 * Géoplateforme route between the anchored point and the point where the cursor stopped, to compare with the local
 * engine (walk and car only: the GPF has no public transport nor bike profile). The latest request wins.
 */
export const useGpfRoute = (origin: LngLat | undefined, target: LngLat | undefined, mode: Mode, direction: Direction): Route | undefined => {
  const [latest, setLatest] = useState<{ asked: RouteRequest; route: Route }>();
  const supported = mode !== 'transit' && mode !== 'bike';

  useEffect(() => {
    if (!origin || !target || !supported) return;
    const controller = new AbortController();
    // Map from the departure: the trip leaves the cursor for the anchored point; from the arrival, the reverse
    const [start, end] = direction === 'departure' ? [target, origin] : [origin, target];
    fetchRoute(start, end, mode, controller.signal)
      .then((route) => setLatest({ asked: { origin, target, mode, direction }, route }))
      .catch(() => undefined);

    return () => controller.abort();
  }, [origin, target, mode, direction, supported]);

  // Only the route of the trip asked now: not the one of another point, mode or direction while the new one comes
  const asked = latest?.asked;
  const current =
    !!asked && supported && asked.origin === origin && asked.target === target && asked.mode === mode && asked.direction === direction;

  return current ? latest?.route : undefined;
};

/** Address near a point, asked once the point stays still a moment */
export const useAddress = (point: LngLat | undefined, delay = 250): string | undefined => {
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

  // While the cursor moves, the last address stays until the next one comes (no flicker); none once the point is gone
  return point ? address : undefined;
};
