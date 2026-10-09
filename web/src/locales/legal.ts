/** Texts of the legal notice page, English and French (same keys) */

interface Section {
  title: string;
  lines: string[];
}

const en = {
  title: 'Legal notice',
  backToMap: 'Back to the map',
  sections: [
    {
      title: 'Publisher',
      lines: [
        'Institut national de l’information géographique et forestière (IGN), public administrative body, 73 avenue de Paris, 94160 Saint-Mandé, France.',
        'Director of publication: the Director General of IGN.',
      ],
    },
    {
      title: 'Nature of the site',
      lines: [
        'geo-reach is a proof of concept, not an official IGN service. Travel times are estimates (average waits, typical traffic), for comparing places and modes, not for planning a trip.',
      ],
    },
    {
      title: 'Hosting',
      lines: ['GitHub Pages, GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, United States.'],
    },
    {
      title: 'Personal data',
      lines: [
        'No account, no cookie, no audience measurement.',
        'The network data is kept in the cache of your browser, on your device only.',
        'To show an address and compare a route, the coordinates of the points you look at are sent to the Géoplateforme (reverse geocoding, route service), as are the basemap tile requests. Your position is used only when you click “My location”, and is then handled the same way.',
        'GitHub, as host, may log technical data such as IP addresses (GitHub Privacy Statement).',
      ],
    },
    {
      title: 'Data and licences',
      lines: [
        'Road network (BD TOPO), basemap (Plan IGN), geocoding and route service: IGN, Géoplateforme, Licence Ouverte Etalab 2.0.',
        'Public transport timetables: Île-de-France Mobilités (GTFS), ODbL; the transit layer of the site is a derived database under the same licence.',
        'Map display: MapLibre GL JS (BSD-3-Clause).',
      ],
    },
    {
      title: 'Contact',
      lines: ['Through the issues of the source code repository.'],
    },
  ] satisfies Section[],
  repository: 'Source code repository',
};

const fr: typeof en = {
  title: 'Mentions légales',
  backToMap: 'Retour à la carte',
  sections: [
    {
      title: 'Éditeur',
      lines: [
        'Institut national de l’information géographique et forestière (IGN), établissement public à caractère administratif, 73 avenue de Paris, 94160 Saint-Mandé.',
        'Directeur de la publication : le directeur général de l’IGN.',
      ],
    },
    {
      title: 'Nature du site',
      lines: [
        'geo-reach est une preuve de concept, pas un service officiel de l’IGN. Les temps de trajet sont des estimations (attentes moyennes, trafic type), pour comparer des lieux et des modes, pas pour préparer un déplacement.',
      ],
    },
    {
      title: 'Hébergement',
      lines: ['GitHub Pages, GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis.'],
    },
    {
      title: 'Données personnelles',
      lines: [
        'Aucun compte, aucun cookie, aucune mesure d’audience.',
        'Les données du réseau sont gardées dans le cache de votre navigateur, sur votre appareil uniquement.',
        'Pour afficher une adresse et comparer un itinéraire, les coordonnées des points consultés sont envoyées à la Géoplateforme (géocodage inverse, calcul d’itinéraire), de même que les demandes de tuiles du fond de carte. Votre position n’est utilisée que si vous cliquez sur « Ma position », et suit alors le même chemin.',
        'GitHub, en tant qu’hébergeur, peut journaliser des données techniques comme les adresses IP (déclaration de confidentialité de GitHub).',
      ],
    },
    {
      title: 'Données et licences',
      lines: [
        'Réseau routier (BD TOPO), fond de carte (Plan IGN), géocodage et calcul d’itinéraire : IGN, Géoplateforme, Licence Ouverte Etalab 2.0.',
        'Horaires de transports en commun : Île-de-France Mobilités (GTFS), ODbL ; la couche transports du site est une base dérivée sous la même licence.',
        'Affichage de la carte : MapLibre GL JS (BSD-3-Clause).',
      ],
    },
    {
      title: 'Contact',
      lines: ['Par les tickets (issues) du dépôt du code source.'],
    },
  ],
  repository: 'Dépôt du code source',
};

export const legal = navigator.language.toLowerCase().startsWith('fr') ? fr : en;
