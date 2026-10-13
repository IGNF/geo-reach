/**
 * The public transport timetables (GTFS) of each region, on transport.data.gouv.fr: Île-de-France Mobilités, the
 * regional aggregate of the urban and interurban networks where there is one, elsewhere the national SNCF feed (TER,
 * Intercités, TGV), which gtfs-prep cuts to the region.
 */
const SNCF = 'https://www.data.gouv.fr/api/1/datasets/r/9ae758ec-cd7a-40cd-a890-bb3963224942';

export interface TransitFeed {
  /** What it holds, for the logs and the docs */
  name: string;
  url: string;
}

export const TRANSIT_FEEDS: Record<string, TransitFeed> = {
  'ile-de-france': {
    name: 'Île-de-France Mobilités (metro, RER, train, tram, bus)',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/413988ed-d340-467b-8be2-7b999fcd207a',
  },
  normandie: {
    name: 'Agrégat des réseaux de Normandie (Twisto, Astuce, LiA, Nomad…)',
    url: 'https://transport.data.gouv.fr/resources/81942/download',
  },
  bretagne: {
    name: 'Agrégat des réseaux de Bretagne',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/8c7b32d0-6481-4bb8-b903-c50a04c72fec',
  },
  'pays-de-la-loire': {
    name: 'Agrégat des réseaux des Pays de la Loire',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/c0bd9ff1-97f9-43f8-aca4-8e80d7728324',
  },
  'centre-val-de-loire': {
    name: 'Agrégat des réseaux du Centre-Val de Loire',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/a193c142-366b-4a7b-8afb-c0bdf23ca7ea',
  },
  'grand-est': {
    name: 'Agrégat des réseaux du Grand Est',
    url: 'https://transport.data.gouv.fr/resources/83634/download',
  },
  'nouvelle-aquitaine': {
    name: 'Agrégat des réseaux de Nouvelle-Aquitaine',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/e09ee736-ae5e-48c8-ac13-3839e3f2f74a',
  },
  'auvergne-rhone-alpes': {
    name: 'Agrégat des réseaux d’Auvergne-Rhône-Alpes',
    url: 'https://www.data.gouv.fr/api/1/datasets/r/231acea2-40cf-4c06-b2eb-646274e0b853',
  },
  'hauts-de-france': { name: 'SNCF (TER, Intercités, TGV)', url: SNCF },
  'provence-alpes-cote-dazur': { name: 'SNCF (TER, Intercités, TGV)', url: SNCF },
  occitanie: { name: 'SNCF (TER, Intercités, TGV)', url: SNCF },
  'bourgogne-franche-comte': { name: 'SNCF (TER, Intercités, TGV)', url: SNCF },
};
