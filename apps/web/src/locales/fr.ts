import type { Messages } from './en';

/** Interface texts, French */
export const fr: Messages = {
  loading: 'Chargement du réseau BD TOPO…',
  attribution: 'Réseau © IGN BD TOPO (Licence Ouverte) · Horaires © Île-de-France Mobilités (ODbL)',
  modes: { transit: 'Transports', pedestrian: 'À pied', car: 'Voiture' },
  mode: 'Mode',
  bus: 'Bus',
  isochrones: 'Isochrones',
  scale: 'Échelle',
  locate: 'Ma position',
  swap: 'Inverser',
  share: { copy: 'Partager', copied: 'Lien copié' },
  panelExplore: 'Exploration',
  panelTrip: 'Trajet',
  collapse: { collapse: 'Replier', expand: 'Déplier' },
  mapFrom: 'Carte depuis',
  directions: { departure: 'le départ', arrival: "l'arrivée" },
  fromCursor: 'Depuis le curseur',
  departure: 'Départ',
  arrival: 'Arrivée',
  near: (place) => `Près de ${place}`,
  removePoint: 'Retirer le point',
  exploreHint: 'Glissez la souris : tout se recalcule en direct. Cliquez pour fixer le point et voir les trajets.',
  tripHint: 'Survolez la carte : le trajet suit le curseur.',
  within: (minutes) => `En ${minutes} min`,
  streetsKm: (km) => `${km} km de rues`,
  engineStats: (ms, nodes) => `Moteur local : ${ms} ms · ${nodes} nœuds`,
  gpfDuration: (duration) => `Géoplateforme : ${duration}`,
  wait: (line) => `Attente ${line}`,
  walk: 'À pied',
  unnamedRoad: 'Voie sans nom',
  outsideZone: 'Hors zone',
  stationShare: (percent, minutes, direction, pinned) =>
    `${percent} % des stations de métro, RER et tram sont à moins de ${minutes} min ${
      direction === 'departure' ? (pinned ? 'de ce départ' : 'du curseur') : 'pour rejoindre ce point'
    }.`,
  numberLocale: 'fr-FR',
};
