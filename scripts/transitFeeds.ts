/**
 * The public transport timetables (GTFS) of each region, on transport.data.gouv.fr. Where there is a regional
 * aggregate of the urban and interurban networks, it alone; elsewhere the national SNCF feed (TER, Intercités, TGV),
 * which gtfs-prep cuts to the region, with the main urban networks and the regional coaches. A region's feeds are
 * merged by gtfs-prep.
 */
export interface TransitFeed {
  /** What it holds, for the logs and the docs */
  name: string;
  url: string;
}

const dataGouv = (id: string): string => `https://www.data.gouv.fr/api/1/datasets/r/${id}`;
const tdg = (id: number): string => `https://transport.data.gouv.fr/resources/${id}/download`;

const SNCF: TransitFeed = { name: 'SNCF (TER, Intercités, TGV)', url: dataGouv('9ae758ec-cd7a-40cd-a890-bb3963224942') };

export const TRANSIT_FEEDS: Record<string, TransitFeed[]> = {
  'ile-de-france': [
    { name: 'Île-de-France Mobilités (metro, RER, train, tram, bus)', url: dataGouv('413988ed-d340-467b-8be2-7b999fcd207a') },
  ],
  normandie: [{ name: 'Agrégat de Normandie (Twisto, Astuce, LiA, Nomad…)', url: tdg(81942) }],
  bretagne: [{ name: 'Agrégat de Bretagne', url: dataGouv('8c7b32d0-6481-4bb8-b903-c50a04c72fec') }],
  'pays-de-la-loire': [{ name: 'Agrégat des Pays de la Loire', url: dataGouv('c0bd9ff1-97f9-43f8-aca4-8e80d7728324') }],
  'centre-val-de-loire': [{ name: 'Agrégat du Centre-Val de Loire', url: dataGouv('a193c142-366b-4a7b-8afb-c0bdf23ca7ea') }],
  'grand-est': [{ name: 'Agrégat du Grand Est', url: tdg(83634) }],
  'nouvelle-aquitaine': [{ name: 'Agrégat de Nouvelle-Aquitaine', url: dataGouv('e09ee736-ae5e-48c8-ac13-3839e3f2f74a') }],
  'auvergne-rhone-alpes': [{ name: 'Agrégat d’Auvergne-Rhône-Alpes', url: dataGouv('231acea2-40cf-4c06-b2eb-646274e0b853') }],
  'hauts-de-france': [
    SNCF,
    { name: 'Ilévia (Lille)', url: dataGouv('c9e5dd3f-8eed-4ad7-aec2-915240599cf6') },
    { name: 'Transvilles (Valenciennes)', url: dataGouv('982e0826-4118-42d9-9b73-c3d3b455cd4f') },
    { name: 'DK’BUS (Dunkerque)', url: dataGouv('f51fabfb-9d7a-44b7-bd03-d1032337fb80') },
    { name: 'Ametis (Amiens)', url: dataGouv('571e3014-066d-4bd6-9f73-fb8065c928c6') },
  ],
  'provence-alpes-cote-dazur': [
    SNCF,
    { name: 'Métropole Aix-Marseille-Provence (RTM, Aix en Bus, Cartreize…)', url: dataGouv('0d9a808a-9a9b-4fa1-b04f-339bbf2cfeb1') },
    { name: 'Lignes d’Azur (Nice)', url: dataGouv('f5678ab2-c863-4b48-ba1f-9021c7d97634') },
    { name: 'Mistral (Toulon)', url: dataGouv('b0789d9e-5077-4124-b6b2-773353ada8cf') },
    { name: 'Orizo (Avignon)', url: dataGouv('40b26c33-9be2-47ea-a46c-8bda9f63273e') },
  ],
  occitanie: [
    SNCF,
    { name: 'Tisséo (Toulouse)', url: dataGouv('64318177-f5b5-4144-a6be-2d0f22d26c77') },
    { name: 'TaM (Montpellier)', url: dataGouv('93a29ce2-cfc8-44ff-b712-bcfd814b7f00') },
    { name: 'Tango (Nîmes)', url: dataGouv('15aeb8a5-1cca-4bb9-ae5f-b6e67e4ff2ab') },
    { name: 'Sankéo (Perpignan)', url: dataGouv('2afffa1f-aa4a-4fe4-9802-4b5f82bb96c6') },
    { name: 'liO (cars régionaux)', url: dataGouv('d747fe79-2915-4cdd-8cc5-51a810baaca5') },
  ],
  'bourgogne-franche-comte': [
    SNCF,
    { name: 'Divia (Dijon)', url: dataGouv('e0dbd217-15cd-4e28-9459-211a27511a34') },
    { name: 'Ginko (Besançon)', url: dataGouv('e18e0aeb-8805-47fd-bcdb-c226d21c96fe') },
    { name: 'Mobigo (cars régionaux)', url: dataGouv('28d3c8bf-97f7-40ed-be9f-00e737f74757') },
  ],
  corse: [
    { name: 'Chemins de fer de la Corse', url: dataGouv('69c3db8a-a5fd-471f-b59f-46b9faded381') },
    { name: 'Via Strada (cars)', url: dataGouv('fe20cb23-34b8-4965-acf7-1b28bf966891') },
    { name: 'Via Bastia', url: dataGouv('ddbec19b-ed75-42f8-9205-573519298632') },
    { name: 'A Berlina (Corse-du-Sud)', url: dataGouv('a84de823-7cb2-4d87-917e-e2dda306d280') },
    { name: 'A Citadina (Sud Corse)', url: dataGouv('74f0577f-f709-49db-9750-53c9341f6e50') },
  ],
};
