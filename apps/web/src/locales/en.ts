/** Interface texts, English (reference: every locale has the same keys) */
export const en = {
  loading: 'Loading the BD TOPO road network…',
  attribution: 'Network © IGN BD TOPO (Licence Ouverte) · Timetables © Île-de-France Mobilités (ODbL)',
  modes: { transit: 'Transit', pedestrian: 'Walk', car: 'Car' },
  mode: 'Mode',
  bus: 'Bus',
  isochrones: 'Isochrones',
  scale: 'Scale',
  locate: 'My location',
  swap: 'Reverse',
  share: { copy: 'Share', copied: 'Link copied' },
  panelExplore: 'Explore',
  panelTrip: 'Trip',
  collapse: { collapse: 'Collapse', expand: 'Expand' },
  mapFrom: 'Map from',
  directions: { departure: 'departure', arrival: 'arrival' },
  fromCursor: 'From the cursor',
  departure: 'Departure',
  arrival: 'Arrival',
  near: (place: string) => `Near ${place}`,
  removePoint: 'Remove the point',
  exploreHint: 'Move the mouse: everything is recomputed live. Click to pin the point and see the trips.',
  tripHint: 'Hover the map: the trip follows the cursor.',
  within: (minutes: number) => `Within ${minutes} min`,
  streetsKm: (km: number) => `${km} km of streets`,
  engineStats: (ms: string, nodes: string) => `Local engine: ${ms} ms · ${nodes} nodes`,
  gpfDuration: (duration: string) => `Géoplateforme: ${duration}`,
  wait: (line: string) => `Wait ${line}`,
  walk: 'Walk',
  unnamedRoad: 'Unnamed road',
  outsideZone: 'Outside the zone',
  stationShare: (percent: number, minutes: number, direction: 'departure' | 'arrival', pinned: boolean) =>
    `${percent} % of the metro, RER and tram stations are within ${minutes} min ${
      direction === 'departure' ? (pinned ? 'of this departure' : 'of the cursor') : 'of reaching this point'
    }.`,
  numberLocale: 'en-GB',
};

export type Messages = typeof en;
