import type { LngLatBox } from '@/features/regions/regions';

/**
 * City centres where the whole BD TOPO network is kept (footpaths, stairs, service roads): walking there goes through
 * them. Elsewhere only the roads that matter at the scale of a region are kept, and filtered by the WFS itself.
 */
export const DENSE_AREAS: readonly LngLatBox[] = [
  // Paris and the inner suburbs
  [2.15, 48.72, 2.6, 48.96],
  // Lyon, Marseille, Toulouse, Nice, Nantes, Montpellier, Strasbourg, Bordeaux, Lille, Rennes
  [4.75, 45.7, 4.95, 45.82],
  [5.3, 43.22, 5.5, 43.36],
  [1.36, 43.55, 1.52, 43.66],
  [7.18, 43.65, 7.32, 43.74],
  [-1.63, 47.17, -1.48, 47.27],
  [3.81, 43.57, 3.94, 43.65],
  [7.69, 48.53, 7.81, 48.63],
  [-0.65, 44.79, -0.52, 44.89],
  [2.97, 50.58, 3.15, 50.69],
  [-1.73, 48.08, -1.62, 48.14],
  // Reims, Toulon, Grenoble, Dijon, Angers, Nîmes, Clermont-Ferrand, Le Havre, Rouen, Tours
  [3.98, 49.22, 4.08, 49.29],
  [5.88, 43.1, 5.98, 43.15],
  [5.68, 45.15, 5.78, 45.21],
  [5.0, 47.3, 5.08, 47.35],
  [-0.6, 47.44, -0.51, 47.5],
  [4.31, 43.81, 4.4, 43.86],
  [3.05, 45.75, 3.13, 45.8],
  [0.08, 49.48, 0.2, 49.53],
  [1.03, 49.41, 1.14, 49.47],
  [0.65, 47.37, 0.73, 47.42],
  // Caen, Brest, Metz, Nancy, Orléans, Limoges, Perpignan, Poitiers, Besançon, Le Mans
  [-0.41, 49.16, -0.33, 49.21],
  [-4.53, 48.37, -4.44, 48.42],
  [6.14, 49.09, 6.22, 49.14],
  [6.14, 48.66, 6.21, 48.71],
  [1.87, 47.88, 1.95, 47.93],
  [1.22, 45.81, 1.29, 45.86],
  [2.86, 42.68, 2.93, 42.72],
  [0.31, 46.56, 0.37, 46.6],
  [5.99, 47.22, 6.06, 47.26],
  [0.16, 47.97, 0.24, 48.03],
  // Avignon, Aix-en-Provence, Pau, La Rochelle, Ajaccio, Bastia
  [4.78, 43.92, 4.85, 43.96],
  [5.42, 43.51, 5.48, 43.55],
  [-0.39, 43.28, -0.33, 43.32],
  [-1.2, 46.14, -1.12, 46.18],
  [8.7, 41.91, 8.76, 41.95],
  [9.42, 42.68, 9.46, 42.72],
];
