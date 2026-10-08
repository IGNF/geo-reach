export const formatMinutes = (minutes: number) => {
  const m = Math.max(1, Math.round(minutes));

  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

export const formatDistance = (metres: number) =>
  metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1).replace('.', ',')} km`;

/** BD TOPO abbreviations of street types (French data values) */
const STREET_TYPES: Record<string, string> = {
  ALL: 'Allée',
  AV: 'Avenue',
  BD: 'Boulevard',
  CHE: 'Chemin',
  CRS: 'Cours',
  IMP: 'Impasse',
  PAS: 'Passage',
  PL: 'Place',
  QU: 'Quai',
  R: 'Rue',
  RTE: 'Route',
  SQ: 'Square',
  VLA: 'Villa',
};
const LOWER = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'aux', 'au', 'sur']);

/** `AV DE LA REPUBLIQUE` → `Avenue de la Republique` */
export const formatStreet = (name: string) =>
  name
    .split(/\s+/)
    .map((word, i) => {
      if (i === 0 && STREET_TYPES[word]) return STREET_TYPES[word];
      const lower = word.toLowerCase();
      if (i > 0 && LOWER.has(lower)) return lower;

      return lower.replace(/(^|[-'])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
    })
    .join(' ');
