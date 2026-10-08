/** Texts of the "How it works" page, English and French (same keys) */

export type StepId =
  | 'wfs'
  | 'gtfs'
  | 'buildGraph'
  | 'gtfsPrep'
  | 'graphBin'
  | 'transitBin'
  | 'engineCrate'
  | 'wasm'
  | 'loaders'
  | 'profile'
  | 'snap'
  | 'dijkstra'
  | 'layer'
  | 'panel'
  | 'map'
  | 'tiles'
  | 'route'
  | 'geocode';

interface Box {
  label: string;
  detail: string;
  /** Shown when the box is chosen */
  text: string;
  file?: string;
}

const en = {
  title: 'How it works',
  lead:
    'Every mouse move recomputes the travel time to about a hundred thousand street crossings and redraws them, in a few milliseconds, with no server. Here is how.',
  backToMap: 'Back to the map',
  sourceCode: 'Source code',
  diagram: {
    title: 'From open data to colors on the screen',
    hint: 'Click a box to read what it does.',
    label: 'Pipeline of geo-reach',
    labels: { zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit', reset: 'Reset the layout' },
    groups: { offline: 'Prepared once, offline', browser: 'In your browser, at every mouse move', gpf: 'Géoplateforme, online' },
    edges: {
      zone: 'zone',
      cargo: 'cargo build',
      loaded: 'loaded once',
      csr: 'graph arrays',
      sources: '2 start points',
      instance: 'runs in',
      times: 'node times',
      path: 'path',
      stop: 'cursor stops',
    },
    legend: {
      primary: 'IGN / Géoplateforme',
      warning: 'Rust',
      accent: 'TypeScript',
      success: 'Graphics card',
      neutral: 'Data files',
    },
    boxes: {
      wfs: {
        label: 'BD TOPO roads',
        detail: 'Géoplateforme WFS',
        text: 'Every road section of the zone, with its traffic direction, pedestrian and car access, average speed, cycle lanes and street name. Downloaded page by page from the Géoplateforme WFS service.',
      },
      gtfs: {
        label: 'IDFM timetables',
        detail: 'GTFS, transport.data.gouv.fr',
        text: 'The Île-de-France Mobilités timetables: every metro, RER, tram and bus trip of the region, in the GTFS standard format.',
      },
      buildGraph: {
        label: 'buildGraph.ts',
        detail: 'Bun script',
        text: 'Turns the road sections into a graph: section ends become nodes (crossings), sections become edges. Coordinates are stored in metres relative to the centre of the zone, so that they fit in 32-bit numbers without losing precision.',
        file: 'scripts/buildGraph.ts',
      },
      gtfsPrep: {
        label: 'gtfs-prep',
        detail: 'Rust, native',
        text: 'Reads the timetables of the whole region and keeps, for a reference weekday and for each hour, the median ride time between two stations and the average wait (half the time between two departures).',
        file: 'crates/gtfs-prep/src/main.rs',
      },
      graphBin: {
        label: 'graph.bin',
        detail: '9 MB · 98 k nodes',
        text: 'A compact binary file: plain arrays of numbers, one after another. The browser reads it as typed arrays straight from the download, with no parsing.',
      },
      transitBin: {
        label: 'transit.bin',
        detail: '4 MB · 401 lines',
        text: 'Stations, lines with their colors, waits and ride times hour by hour, and the line shapes. Grafted on the road graph when the page loads: each station is linked to its nearest streets.',
      },
      engineCrate: {
        label: 'crates/engine',
        detail: 'Rust, ~180 lines',
        text: 'The shortest path engine: a Dijkstra algorithm, bounded by the chosen maximum time, that starts from several points at once. No dependency, no memory allocation while it runs.',
        file: 'crates/engine/src/lib.rs',
      },
      wasm: {
        label: 'engine.wasm',
        detail: '30 KB · wasm32-unknown-unknown',
        text: 'The engine compiled to WebAssembly, a binary format every browser runs at near native speed. The target wasm32-unknown-unknown means: 32-bit WebAssembly, no vendor, no operating system. Pure computation, which is all a browser needs.',
      },
      loaders: {
        label: 'Loaders',
        detail: 'network.ts · transit.ts',
        text: 'Download the two binary files, read them as typed arrays and merge the transit layer into the road graph.',
        file: 'web/src/engine/network.ts',
      },
      profile: {
        label: 'Profile',
        detail: 'mode, hour, direction',
        text: 'Computes the time to travel each edge for the chosen mode (walk 4 km/h, bike 15 km/h, car with the traffic of the hour, transit with the waits of the hour), then packs the graph into compact arrays (CSR) written once into the engine memory. Changing mode rebuilds it; moving the mouse does not.',
        file: 'web/src/engine/profile.ts',
      },
      snap: {
        label: 'Snap',
        detail: 'cursor → nearest street',
        text: 'The cursor can be in a park or on a roof. A grid of 80 m cells finds the nearest street the mode can use, and where along it the cursor falls. The walk to that street is added to the trip.',
        file: 'web/src/engine/snap.ts',
      },
      dijkstra: {
        label: 'Dijkstra',
        detail: 'WebAssembly · 1 to 6 ms',
        text: 'Starts from the two ends of the snapped street and spreads out until the maximum time. Results are written into buffers that JavaScript reads in place: no copy. Only the crossings reached last time are reset, not the whole network.',
        file: 'crates/engine/src/lib.rs',
      },
      layer: {
        label: 'WebGL layer',
        detail: 'colors on the GPU',
        text: 'The geometry of the streets is sent to the graphics card once. At each move, only the time of each crossing is sent (one number per crossing); the graphics card works out the color of every piece of street, then draws a wide glow (the heat map) and thin lines on top.',
        file: 'web/src/map/networkLayer.ts',
      },
      panel: {
        label: 'Trip panel',
        detail: 'path, legs, figures',
        text: 'With a pinned point, the path to the cursor is read back from the last computation (no new Dijkstra): streets, waits and lines become the legs of the trip. The figures (area, stations, cycle lanes) come from the same result.',
        file: 'web/src/engine/legs.ts',
      },
      map: {
        label: 'MapLibre map',
        detail: 'vector basemap',
        text: 'MapLibre GL draws the basemap and hosts the custom WebGL layer between the streets of the basemap and its labels.',
      },
      tiles: {
        label: 'Plan IGN',
        detail: 'vector tiles',
        text: 'The basemap: Plan IGN vector tiles from the Géoplateforme, grey style.',
      },
      route: {
        label: 'Route service',
        detail: 'itinéraire',
        text: 'When the cursor stops, the Géoplateforme route service computes the same walk or car trip, shown beside the local result for comparison. Older requests are cancelled.',
        file: 'web/src/lib/gpf.ts',
      },
      geocode: {
        label: 'Reverse geocoding',
        detail: 'address of a point',
        text: 'Gives the address of the start and of the destination, once the cursor stops.',
        file: 'web/src/lib/gpf.ts',
      },
    } satisfies Record<StepId, Box>,
  },
  move: {
    title: 'One mouse move, step by step',
    steps: [
      { title: 'The mouse moves', description: 'The position is only stored; nothing is computed yet.' },
      { title: 'Next frame', description: 'At most one computation per screen refresh, for the latest position, however fast the mouse goes.' },
      { title: 'Snap', description: 'The cursor is attached to the nearest usable street.' },
      { title: 'Dijkstra in WebAssembly', description: 'Times to the whole network within the maximum time: 1 to 6 ms.' },
      { title: 'Upload', description: 'One number per crossing goes to the graphics card.' },
      { title: 'Draw', description: 'The graphics card colors every piece of street from the times of its two ends.' },
    ],
  },
  why: {
    title: 'Why Rust and WebAssembly',
    text: 'A routing server takes about half a second to answer: far too slow to follow the mouse. So the computation runs on your own computer, with no round trip to a server. The engine is written in Rust and compiled to WebAssembly, a format close to machine code that the browser runs almost as fast as an installed program. JavaScript could do the same work, but more slowly and with small freezes: from time to time it stops to clean up its memory (the garbage collector). The Rust engine reuses the same memory on every computation, so it never pauses.',
    stats: [
      { value: '30 KB', label: 'engine, compiled' },
      { value: '1–6 ms', label: 'per computation' },
      { value: '0', label: 'server, request or copy per move' },
      { value: '98 k', label: 'street crossings' },
    ],
    rust: 'The heart of the engine (Rust): spread from the closest node, never beyond the maximum time.',
    js: 'The page side (TypeScript): write the start points, run, read the times in place.',
  },
  limits: {
    title: 'Limits of the proof of concept',
    items: [
      'Transit: average waits on a typical weekday, not the exact timetable.',
      'Car: typical traffic curve, no live traffic, no traffic lights.',
      'Zone: Paris and the inner suburbs.',
    ],
  },
  more: 'Technical documentation',
};

const fr: typeof en = {
  title: 'Comment ça marche',
  lead:
    'Chaque mouvement de souris recalcule le temps de trajet vers une centaine de milliers de carrefours et les redessine, en quelques millisecondes, sans serveur. Voici comment.',
  backToMap: 'Retour à la carte',
  sourceCode: 'Code source',
  diagram: {
    title: 'Des données ouvertes aux couleurs à l’écran',
    hint: 'Cliquez sur une boîte pour lire ce qu’elle fait.',
    label: 'Chaîne de traitement de geo-reach',
    labels: { zoomIn: 'Zoomer', zoomOut: 'Dézoomer', fit: 'Ajuster', reset: 'Rétablir la disposition' },
    groups: { offline: 'Préparé une fois, hors ligne', browser: 'Dans votre navigateur, à chaque mouvement', gpf: 'Géoplateforme, en ligne' },
    edges: {
      zone: 'zone',
      cargo: 'cargo build',
      loaded: 'chargé une fois',
      csr: 'tableaux du graphe',
      sources: '2 points de départ',
      instance: 'tourne dans',
      times: 'temps des nœuds',
      path: 'chemin',
      stop: 'curseur arrêté',
    },
    legend: {
      primary: 'IGN / Géoplateforme',
      warning: 'Rust',
      accent: 'TypeScript',
      success: 'Carte graphique',
      neutral: 'Fichiers de données',
    },
    boxes: {
      wfs: {
        label: 'Routes BD TOPO',
        detail: 'WFS Géoplateforme',
        text: 'Tous les tronçons de route de la zone, avec leur sens de circulation, l’accès piéton et voiture, la vitesse moyenne, les aménagements cyclables et le nom de la rue. Téléchargés page par page depuis le service WFS de la Géoplateforme.',
      },
      gtfs: {
        label: 'Horaires IDFM',
        detail: 'GTFS, transport.data.gouv.fr',
        text: 'Les horaires d’Île-de-France Mobilités : toutes les courses de métro, RER, tram et bus de la région, au format standard GTFS.',
      },
      buildGraph: {
        label: 'buildGraph.ts',
        detail: 'script Bun',
        text: 'Transforme les tronçons en graphe : les extrémités deviennent des nœuds (carrefours), les tronçons des arêtes. Les coordonnées sont en mètres relatifs au centre de la zone, pour tenir en nombres 32 bits sans perte de précision.',
        file: 'scripts/buildGraph.ts',
      },
      gtfsPrep: {
        label: 'gtfs-prep',
        detail: 'Rust, natif',
        text: 'Lit les horaires de toute la région et garde, pour un jour de semaine de référence et pour chaque heure, le temps de trajet médian entre deux stations et l’attente moyenne (la moitié du temps entre deux départs).',
        file: 'crates/gtfs-prep/src/main.rs',
      },
      graphBin: {
        label: 'graph.bin',
        detail: '9 Mo · 98 k nœuds',
        text: 'Un fichier binaire compact : de simples tableaux de nombres à la suite. Le navigateur les lit directement comme tableaux typés à la fin du téléchargement, sans analyse.',
      },
      transitBin: {
        label: 'transit.bin',
        detail: '4 Mo · 401 lignes',
        text: 'Stations, lignes avec leurs couleurs, attentes et temps de trajet heure par heure, et tracés des lignes. Greffé sur le graphe routier au chargement de la page : chaque station est reliée aux rues les plus proches.',
      },
      engineCrate: {
        label: 'crates/engine',
        detail: 'Rust, ~180 lignes',
        text: 'Le moteur de plus court chemin : un algorithme de Dijkstra, borné par le temps maximum choisi, qui part de plusieurs points à la fois. Aucune dépendance, aucune allocation mémoire pendant le calcul.',
        file: 'crates/engine/src/lib.rs',
      },
      wasm: {
        label: 'engine.wasm',
        detail: '30 Ko · wasm32-unknown-unknown',
        text: 'Le moteur compilé en WebAssembly, un format binaire que tous les navigateurs exécutent à une vitesse proche du natif. La cible wasm32-unknown-unknown signifie : WebAssembly 32 bits, sans fabricant, sans système d’exploitation. Du calcul pur, tout ce dont un navigateur a besoin.',
      },
      loaders: {
        label: 'Chargement',
        detail: 'network.ts · transit.ts',
        text: 'Télécharge les deux fichiers binaires, les lit comme tableaux typés et fusionne la couche transports en commun dans le graphe routier.',
        file: 'web/src/engine/network.ts',
      },
      profile: {
        label: 'Profil',
        detail: 'mode, heure, sens',
        text: 'Calcule le temps de parcours de chaque arête pour le mode choisi (marche 4 km/h, vélo 15 km/h, voiture avec le trafic de l’heure, transports avec les attentes de l’heure), puis range le graphe en tableaux compacts (CSR) écrits une fois dans la mémoire du moteur. Changer de mode le reconstruit ; bouger la souris, non.',
        file: 'web/src/engine/profile.ts',
      },
      snap: {
        label: 'Accroche',
        detail: 'curseur → rue la plus proche',
        text: 'Le curseur peut être dans un parc ou sur un toit. Une grille de cases de 80 m trouve la rue praticable la plus proche, et l’endroit de la rue où tombe le curseur. La marche jusqu’à cette rue est ajoutée au trajet.',
        file: 'web/src/engine/snap.ts',
      },
      dijkstra: {
        label: 'Dijkstra',
        detail: 'WebAssembly · 1 à 6 ms',
        text: 'Part des deux extrémités de la rue accrochée et s’étend jusqu’au temps maximum. Les résultats sont écrits dans des tampons que JavaScript lit sur place : aucune copie. Seuls les carrefours atteints la fois précédente sont remis à zéro, pas tout le réseau.',
        file: 'crates/engine/src/lib.rs',
      },
      layer: {
        label: 'Couche WebGL',
        detail: 'couleurs sur le GPU',
        text: 'La géométrie des rues est envoyée une fois à la carte graphique. À chaque mouvement, seul le temps de chaque carrefour est envoyé (un nombre par carrefour) ; la carte graphique calcule la couleur de chaque bout de rue, puis dessine un halo large (la carte de chaleur) et des lignes fines par-dessus.',
        file: 'web/src/map/networkLayer.ts',
      },
      panel: {
        label: 'Panneau de trajet',
        detail: 'chemin, étapes, chiffres',
        text: 'Avec un point fixé, le chemin jusqu’au curseur est relu dans le dernier calcul (pas de nouveau Dijkstra) : rues, attentes et lignes deviennent les étapes du trajet. Les chiffres (surface, stations, pistes cyclables) viennent du même résultat.',
        file: 'web/src/engine/legs.ts',
      },
      map: {
        label: 'Carte MapLibre',
        detail: 'fond vectoriel',
        text: 'MapLibre GL dessine le fond de carte et accueille la couche WebGL sur mesure, entre les rues du fond et ses étiquettes.',
      },
      tiles: {
        label: 'Plan IGN',
        detail: 'tuiles vectorielles',
        text: 'Le fond de carte : tuiles vectorielles Plan IGN de la Géoplateforme, style gris.',
      },
      route: {
        label: 'Calcul d’itinéraire',
        detail: 'itineraire',
        text: 'Quand le curseur s’arrête, le service d’itinéraire de la Géoplateforme calcule le même trajet à pied ou en voiture, affiché à côté du résultat local pour comparaison. Les requêtes plus anciennes sont annulées.',
        file: 'web/src/lib/gpf.ts',
      },
      geocode: {
        label: 'Géocodage inverse',
        detail: 'adresse d’un point',
        text: 'Donne l’adresse du départ et de la destination, une fois le curseur arrêté.',
        file: 'web/src/lib/gpf.ts',
      },
    },
  },
  move: {
    title: 'Un mouvement de souris, pas à pas',
    steps: [
      { title: 'La souris bouge', description: 'La position est seulement retenue ; rien n’est encore calculé.' },
      { title: 'Image suivante', description: 'Au plus un calcul par rafraîchissement d’écran, pour la dernière position, quelle que soit la vitesse de la souris.' },
      { title: 'Accroche', description: 'Le curseur est rattaché à la rue praticable la plus proche.' },
      { title: 'Dijkstra en WebAssembly', description: 'Temps vers tout le réseau dans la limite du temps maximum : 1 à 6 ms.' },
      { title: 'Envoi', description: 'Un nombre par carrefour part vers la carte graphique.' },
      { title: 'Dessin', description: 'La carte graphique colore chaque bout de rue à partir des temps de ses deux extrémités.' },
    ],
  },
  why: {
    title: 'Pourquoi Rust et WebAssembly',
    text: 'Un serveur de calcul d’itinéraire met environ une demi-seconde à répondre : bien trop lent pour suivre la souris. Le calcul se fait donc sur votre ordinateur, sans aller-retour vers un serveur. Le moteur est écrit en Rust et compilé en WebAssembly, un format proche du langage machine que le navigateur exécute presque aussi vite qu’un programme installé. JavaScript pourrait faire le même travail, mais plus lentement et avec de petits à-coups : de temps en temps, il s’arrête pour faire le ménage dans sa mémoire (le « ramasse-miettes »). Le moteur Rust réutilise la même mémoire à chaque calcul, il n’a donc jamais à s’arrêter.',
    stats: [
      { value: '30 Ko', label: 'moteur compilé' },
      { value: '1–6 ms', label: 'par calcul' },
      { value: '0', label: 'serveur, requête ou copie par mouvement' },
      { value: '98 k', label: 'carrefours' },
    ],
    rust: 'Le cœur du moteur (Rust) : s’étendre depuis le nœud le plus proche, jamais au-delà du temps maximum.',
    js: 'Côté page (TypeScript) : écrire les points de départ, lancer, lire les temps sur place.',
  },
  limits: {
    title: 'Limites de la preuve de concept',
    items: [
      'Transports en commun : attentes moyennes un jour de semaine type, pas les horaires exacts.',
      'Voiture : courbe de trafic type, pas de trafic en temps réel ni de feux.',
      'Zone : Paris et la petite couronne.',
    ],
  },
  more: 'Documentation technique',
};

export const howItWorks = navigator.language.toLowerCase().startsWith('fr') ? fr : en;
