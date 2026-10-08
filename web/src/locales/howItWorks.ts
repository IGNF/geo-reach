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
  | 'contours'
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
    'Every mouse move recomputes the travel time to more than half a million street crossings of Île-de-France and redraws them, in your browser, with no server. Here is how.',
  backToMap: 'Back to the map',
  sourceCode: 'Source code',
  diagram: {
    title: 'From open data to colors on the screen',
    hint: 'Click a box to read what it does.',
    label: 'Pipeline of geo-reach',
    labels: { zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit', reset: 'Reset the layout' },
    groups: { offline: 'Prepared once, offline', browser: 'In your browser, at every mouse move', gpf: 'Géoplateforme' },
    edges: {
      zone: 'zone',
      cargo: 'cargo build',
      loaded: 'loaded once',
      csr: 'graph arrays',
      sources: '2 start points',
      contours: 'node times',
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
        text: 'Every road section of Île-de-France, with its traffic direction, pedestrian and car access, average speed, cycle lanes and street name. Downloaded page by page from the Géoplateforme WFS service.',
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
        detail: '23 MB · 539 k nodes',
        text: 'A compact binary file: plain arrays of numbers, one after another (11 MB compressed). The browser reads it as typed arrays straight from the download, with no parsing. Outside Paris and the inner suburbs, footpaths and service roads are left out to keep it light.',
      },
      transitBin: {
        label: 'transit.bin',
        detail: '11 MB · 1,984 lines',
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
        text: 'Download the two binary files (once: the browser keeps them for the next visits, even offline), read them as typed arrays and merge the transit layer into the road graph.',
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
        detail: 'WebAssembly, in a worker',
        text: 'Starts from the two ends of the snapped street and spreads out until the maximum time. It runs in a Web Worker, a background thread: even a run over the whole region never freezes the map. The times are handed to the page without being copied, and only the crossings reached last time are reset, not the whole network.',
        file: 'crates/engine/src/dijkstra.rs',
      },
      contours: {
        label: 'Isochrone lines',
        detail: '150 m grid',
        text: 'The times of the streets, and of the transit lines taken (all along their track), are spread on a 150 m grid, at walking pace and never more than 300 m away from them. The lines are traced where the grid crosses each duration: they follow the reached streets, and a metro or RER line draws a tube between its stations rather than circles around them.',
        file: 'web/src/engine/contours.ts',
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
      { title: 'Dijkstra in WebAssembly', description: 'Times to the whole network within the maximum time, in a background thread.' },
      { title: 'Upload', description: 'One number per crossing goes to the graphics card.' },
      { title: 'Draw', description: 'The graphics card colors every piece of street from the times of its two ends.' },
    ],
  },
  why: {
    title: 'Why Rust and WebAssembly',
    text: 'A routing server takes about half a second to answer: far too slow to follow the mouse. So the computation runs on your own computer, with no round trip to a server. The engine is written in Rust and compiled to WebAssembly, a format close to machine code that the browser runs almost as fast as an installed program. JavaScript could do the same work, but more slowly and with small freezes: from time to time it stops to clean up its memory (the garbage collector). The Rust engine reuses the same memory on every computation, so it never pauses.',
    stats: [
      { value: '30 KB', label: 'engine, compiled' },
      { value: '539 k', label: 'street crossings' },
      { value: '1,984', label: 'transit lines' },
      { value: '0', label: 'server or request per move' },
    ],
    rust: 'The heart of the engine (Rust): spread from the closest node, never beyond the maximum time.',
    js: 'The worker side (TypeScript): write the start points, run, hand the times over to the page.',
  },
  limits: {
    title: 'Limits of the proof of concept',
    items: [
      'Transit: average waits on a typical weekday, not the exact timetable.',
      'Car: typical traffic curve, no live traffic, no traffic lights.',
      'Zone: Île-de-France; footpaths and service roads only in Paris and the inner suburbs.',
    ],
  },
  more: 'Technical documentation',
};

const fr: typeof en = {
  title: 'Comment ça marche',
  lead:
    'Chaque mouvement de souris recalcule le temps de trajet vers plus d’un demi-million de carrefours d’Île-de-France et les redessine, dans votre navigateur, sans serveur. Voici comment.',
  backToMap: 'Retour à la carte',
  sourceCode: 'Code source',
  diagram: {
    title: 'Des données ouvertes aux couleurs à l’écran',
    hint: 'Cliquez sur une boîte pour lire ce qu’elle fait.',
    label: 'Chaîne de traitement de geo-reach',
    labels: { zoomIn: 'Zoomer', zoomOut: 'Dézoomer', fit: 'Ajuster', reset: 'Rétablir la disposition' },
    groups: { offline: 'Préparé une fois, hors ligne', browser: 'Dans votre navigateur, à chaque mouvement', gpf: 'Géoplateforme' },
    edges: {
      zone: 'zone',
      cargo: 'cargo build',
      loaded: 'chargé une fois',
      csr: 'tableaux du graphe',
      sources: '2 points de départ',
      contours: 'temps des nœuds',
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
        text: 'Tous les tronçons de route d’Île-de-France, avec leur sens de circulation, l’accès piéton et voiture, la vitesse moyenne, les aménagements cyclables et le nom de la rue. Téléchargés page par page depuis le service WFS de la Géoplateforme.',
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
        detail: '23 Mo · 539 k nœuds',
        text: 'Un fichier binaire compact : de simples tableaux de nombres à la suite (11 Mo compressé). Le navigateur les lit directement comme tableaux typés à la fin du téléchargement, sans analyse. Hors de Paris et de la petite couronne, les chemins et voies de service sont laissés de côté pour l’alléger.',
      },
      transitBin: {
        label: 'transit.bin',
        detail: '11 Mo · 1 984 lignes',
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
        text: 'Télécharge les deux fichiers binaires (une seule fois : le navigateur les garde pour les visites suivantes, même hors ligne), les lit comme tableaux typés et fusionne la couche transports en commun dans le graphe routier.',
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
        detail: 'WebAssembly, dans un worker',
        text: 'Part des deux extrémités de la rue accrochée et s’étend jusqu’au temps maximum. Il tourne dans un Web Worker, un fil d’exécution en arrière-plan : même un calcul sur toute la région ne fige jamais la carte. Les temps sont transmis à la page sans copie, et seuls les carrefours atteints la fois précédente sont remis à zéro, pas tout le réseau.',
        file: 'crates/engine/src/dijkstra.rs',
      },
      contours: {
        label: 'Lignes d’isochrones',
        detail: 'grille de 150 m',
        text: 'Les temps des rues, et des lignes de transport empruntées (sur tout leur tracé), sont étalés sur une grille de 150 m, au pas de marche et jamais à plus de 300 m d’elles. Les lignes sont tracées là où la grille franchit chaque durée : elles suivent les rues atteintes, et une ligne de métro ou de RER dessine un tube entre ses stations plutôt que des cercles autour.',
        file: 'web/src/engine/contours.ts',
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
      { title: 'Dijkstra en WebAssembly', description: 'Temps vers tout le réseau dans la limite du temps maximum, en arrière-plan.' },
      { title: 'Envoi', description: 'Un nombre par carrefour part vers la carte graphique.' },
      { title: 'Dessin', description: 'La carte graphique colore chaque bout de rue à partir des temps de ses deux extrémités.' },
    ],
  },
  why: {
    title: 'Pourquoi Rust et WebAssembly',
    text: 'Un serveur de calcul d’itinéraire met environ une demi-seconde à répondre : bien trop lent pour suivre la souris. Le calcul se fait donc sur votre ordinateur, sans aller-retour vers un serveur. Le moteur est écrit en Rust et compilé en WebAssembly, un format proche du langage machine que le navigateur exécute presque aussi vite qu’un programme installé. JavaScript pourrait faire le même travail, mais plus lentement et avec de petits à-coups : de temps en temps, il s’arrête pour faire le ménage dans sa mémoire (le « ramasse-miettes »). Le moteur Rust réutilise la même mémoire à chaque calcul, il n’a donc jamais à s’arrêter.',
    stats: [
      { value: '30 Ko', label: 'moteur compilé' },
      { value: '539 k', label: 'carrefours' },
      { value: '1 984', label: 'lignes de transport' },
      { value: '0', label: 'serveur ou requête par mouvement' },
    ],
    rust: 'Le cœur du moteur (Rust) : s’étendre depuis le nœud le plus proche, jamais au-delà du temps maximum.',
    js: 'Côté worker (TypeScript) : écrire les points de départ, lancer, transmettre les temps à la page.',
  },
  limits: {
    title: 'Limites de la preuve de concept',
    items: [
      'Transports en commun : attentes moyennes un jour de semaine type, pas les horaires exacts.',
      'Voiture : courbe de trafic type, pas de trafic en temps réel ni de feux.',
      'Zone : Île-de-France ; chemins et voies de service seulement à Paris et en petite couronne.',
    ],
  },
  more: 'Documentation technique',
};

export const howItWorks = navigator.language.toLowerCase().startsWith('fr') ? fr : en;
