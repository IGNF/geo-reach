/** Texts of the "How it works" page, English and French (same keys) */

export type StepId =
  | 'wfs'
  | 'gtfs'
  | 'relief'
  | 'buildGraph'
  | 'gtfsPrep'
  | 'graphBin'
  | 'transitBin'
  | 'engineCrate'
  | 'wasm'
  | 'loaders'
  | 'profile'
  | 'cuts'
  | 'snap'
  | 'dijkstra'
  | 'layer'
  | 'buildings'
  | 'buildingTiles'
  | 'panel'
  | 'compare'
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
    'Every mouse move recomputes the travel time to the street crossings of the region in view, up to a few million, and redraws them, in your browser, with no server. All of metropolitan France, one region at a time. Here is how.',
  backToMap: 'Back to the map',
  sourceCode: 'Source code',
  legalNotice: 'Legal notice',
  diagram: {
    title: 'From open data to colors on the screen',
    hint: 'Click a box to read what it does.',
    label: 'Pipeline of geo-reach',
    labels: { zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit', reset: 'Reset the layout' },
    groups: { offline: 'Prepared once, offline', browser: 'In your browser, at every mouse move' },
    edges: {
      zone: 'zone',
      tracks: 'rail tracks',
      cargo: 'cargo build',
      loaded: 'loaded once',
      csr: 'graph arrays',
      sources: '2 start points',
      instance: 'runs in',
      times: 'node times',
      path: 'path',
      stop: 'when the cursor stops',
      address: 'addresses',
      networkCopy: 'network copy',
      fourModes: 'same trip, 4 modes',
      slopes: 'climb, descent',
      closed: 'closed edges',
      sameTimes: 'same node times',
      basemap: 'basemap',
      extruded: 'extruded in a worker',
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
        text: 'Every road section of metropolitan France, region by region, with its traffic direction, pedestrian and car access, average speed, cycle lanes and street name. Downloaded tile by tile from the Géoplateforme WFS service; away from the main city centres the service itself leaves out the footpaths and service roads. The railway (trains, metros, trams) comes from the same service.',
      },
      gtfs: {
        label: 'Timetables',
        detail: 'GTFS, transport.data.gouv.fr',
        text: 'The public transport timetables in the GTFS standard format: Île-de-France Mobilités, the regional aggregates of the urban and interurban networks (seven regions), elsewhere the SNCF trains with the main urban networks and the regional coaches, merged.',
      },
      relief: {
        label: 'BD TOPO heights',
        detail: 'Z of the sections, RGE ALTI',
        text: 'Every road section comes with the height of each of its points (Z), the road surface draped on the RGE ALTI terrain model, to the decimetre. Read from the same WFS service as the roads.',
      },
      buildGraph: {
        label: 'prep roads',
        detail: 'Rust, region by region',
        text: 'Turns the road sections into a graph: section ends become nodes (crossings), sections become edges. Each edge keeps the metres climbed and descended along it, from the heights of its points (bumps under 0.5 m are ignored). Coordinates are stored in metres relative to the centre of the zone, so that they fit in 32-bit numbers without losing precision.',
        file: 'crates/prep/src/roads/graph.rs',
      },
      gtfsPrep: {
        label: 'prep transit',
        detail: 'Rust, region by region',
        text: 'Merges the feeds of each region, aligned on its road network. Reads the timetables of the region and keeps, for a reference weekday and for each hour, the median ride time between two stations and the average wait (half the time between two departures). Lines come with their shapes; where a feed has none (the SNCF trains, the Lille metro, the Montpellier tram), the ride follows the BD TOPO tracks between its two stations.',
        file: 'crates/prep/src/transit.rs',
      },
      graphBin: {
        label: 'Road networks',
        detail: '13 regions · 18 M edges',
        text: 'One compact binary file per region: plain arrays of numbers, one after another, climb and descent included, gzipped (1 to 52 MB). The browser reads them as typed arrays straight from the download, with no parsing. Each region reaches about 20 km beyond its edge, for the trips that cross it.',
      },
      transitBin: {
        label: 'Transport layers',
        detail: '13 regions · 14,000 lines',
        text: 'Per region, the stations, lines with their colors, waits and ride times hour by hour, and the line shapes. Grafted on the road graph when the page loads: each station is linked to its nearest streets.',
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
        detail: 'in a worker',
        text: 'Download the files of the region in view (once: the browser keeps them for the next visits, even offline), inflate them, read them as typed arrays, merge the transit layer into the road graph and prepare the first mode. All of it runs in a Web Worker, a background thread: when the view moves into another region, its files load while the map in view keeps following the mouse, then the new network takes over at the same place.',
        file: 'web/src/features/routing/network.worker.ts',
      },
      profile: {
        label: 'Profile',
        detail: 'mode, hour, direction',
        text: 'Computes the time to travel each edge for the chosen mode (walk 4 km/h and bike 15 km/h on the flat, slower uphill from the BD TOPO heights, car with the traffic of the hour, transit with the waits of the hour), then packs the graph into compact arrays (CSR) written once into the engine memory. Changing mode rebuilds it; moving the mouse does not.',
        file: 'web/src/features/routing/profile.ts',
      },
      cuts: {
        label: 'Closures',
        detail: 'what-if, from the map',
        text: 'A metro, RER or tram line closed between two stations, or a street closed for every mode: their edges become impassable and the profile is rebuilt (about 120 ms). A second worker runs the same computation with everything open, side by side: comparing the two gives the stations that lose more than 5 min.',
        file: 'web/src/features/cuts/cuts.ts',
      },
      snap: {
        label: 'Snap',
        detail: 'cursor → nearest street',
        text: 'The cursor can be in a park or on a roof. A grid of 80 m cells finds the nearest street the mode can use, and where along it the cursor falls. The walk to that street is added to the trip. Only the streets one can leave and come back to count: a one-way street into a dead end, or a car street inside a pedestrian zone, would lead nowhere.',
        file: 'web/src/features/routing/snap.ts',
      },
      dijkstra: {
        label: 'Dijkstra',
        detail: 'WebAssembly, page or worker',
        text: 'Starts from the two ends of the snapped street and spreads out until the maximum time. A long run is made in a Web Worker, a background thread: even a run over the whole region never freezes the map. A short one (a few milliseconds, the usual case) is made on the page itself, right when the mouse moves, so that the very next image shows it. The times of the worker are handed to the page without being copied, and only the crossings reached last time are reset, not the whole network.',
        file: 'crates/engine/src/dijkstra.rs',
      },
      layer: {
        label: 'WebGL layer',
        detail: 'colors on the GPU',
        text: 'The geometry of the streets is prepared by a worker and sent to the graphics card once per mode, sorted in squares of about 2 km: each image draws only the squares in view (some 20,000 pieces of street out of several million). At each move, only the time of each crossing is sent (one number per crossing); the graphics card works out the color of every piece of street, then draws a wide glow (the heat map) and thin lines on top.',
        file: 'web/src/features/map/networkLayer.ts',
      },
      buildings: {
        label: '3D buildings',
        detail: 'colored on the GPU',
        text: 'The BD TOPO buildings, extruded to their height by a worker (walls shaded by the direction they face, flat roofs). Each building is joined once to its nearest street; the graphics card then reads the times of that street in the same texture as the network, so the buildings follow the cursor at every move, at no cost on the page.',
        file: 'web/src/features/buildings/buildingGlLayer.ts',
      },
      panel: {
        label: 'Trip panel',
        detail: 'path, legs, figures',
        text: 'With a pinned point, the path to the cursor is read back from the last computation (no new Dijkstra): streets, waits and lines become the legs of the trip. The figures (area, stations, cycle lanes, stations delayed by closures) come from the same result.',
        file: 'web/src/features/trip/legs.ts',
      },
      compare: {
        label: 'Mode comparison',
        detail: 'a worker of its own',
        text: 'Once the cursor stops on a destination, the same trip on foot, by bike, by car and by public transport. This worker prepares the network of each mode once for the current settings, then each trip is a Dijkstra that stops at its destination: the map that follows the mouse never waits for it.',
        file: 'web/src/features/routing/compare.worker.ts',
      },
      tiles: {
        label: 'Plan IGN',
        detail: 'vector tiles',
        text: 'The basemap: Plan IGN vector tiles from the Géoplateforme, grey style. The isard engine draws it with the network, the buildings and the closed sections between its streets and its labels.',
      },
      buildingTiles: {
        label: 'BD TOPO tiles',
        detail: 'buildings and heights',
        text: 'The BD TOPO vector tiles of the Géoplateforme, from zoom 15: the outline and the height of every building. Only the tiles around the view are downloaded.',
      },
      route: {
        label: 'Route service',
        detail: 'itinéraire',
        text: 'When the cursor stops, the Géoplateforme route service computes the same walk or car trip, shown beside the local result for comparison. Older requests are cancelled.',
        file: 'web/src/shared/gpf.ts',
      },
      geocode: {
        label: 'Geocoding',
        detail: 'addresses, search',
        text: 'Gives the address of the start and of the destination, once the cursor stops; and while you type in the search field, the addresses and places that match (completion service).',
        file: 'web/src/shared/gpf.ts',
      },
    } satisfies Record<StepId, Box>,
  },
  sandbox: {
    title: 'Try it on a made-up town',
    text: 'The same engine as the map (the WebAssembly Dijkstra in its worker, the snap, the transit grafting) on a small town drawn for the purpose: 3 km of streets every 100 m, a river with three bridges, a hill, an expressway, a pedestrian old town, one-way streets, a park crossed by a path, a metro and a bus. Move the mouse: everything is recomputed from the cursor. Click to pin a start; the mouse is then the destination.',
    mode: 'Mode',
    modes: { pedestrian: 'Walk', bike: 'Bike', car: 'Car', transit: 'Transit' },
    maxTime: (m: number): string => `Maximum time · ${m} min`,
    hour: (h: number): string => `Departure · ${h} h`,
    relief: 'Slopes (the hill)',
    wait: 'Wait',
    waits: { half: 'average', full: 'worst case' },
    bus: 'Bus line 21',
    bridge: 'Close the middle bridge',
    labels: { river: 'River', park: 'Park', oldTown: 'Old town, pedestrian', hill: 'Hill +50 m', expressway: 'Expressway (cars)', boulevard: 'Boulevard, cycle lane' },
    run: (ms: string, nodes: number): string => `Dijkstra: ${ms} ms, ${nodes} nodes settled`,
    reached: (share: number, m: number): string => `${share} % of the crossings within ${m} min`,
    hint: 'Hover the town to start from the cursor. Click to pin the start.',
    pinned: 'Start pinned: the cursor is the destination. Click again to release it.',
    trip: (time: string): string => `Trip: ${time}`,
    unreachable: 'Beyond the maximum time',
    legs: { street: 'streets', link: 'to the station', wait: 'wait', ride: 'ride', transfer: 'exit, transfer', access: 'walk to the street' },
    noService: 'No metro nor bus at this hour',
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
  gpf: {
    title: 'Why not the Géoplateforme route service directly',
    text: 'The first version of this demo did use it: on each click, it asked the Géoplateforme for a series of isochrones and merged them into a map. It works, but one map takes one to three seconds, and the service accepts about five requests per second. Following the mouse needs a new map at every screen refresh: a hundred times more. The service is made to answer route requests, not to feed an interactive map; it also has no public transport. So the data comes from the Géoplateforme, and the computation runs in the browser.',
    stats: [
      { value: '12 to 15', label: 'isochrone requests for one map' },
      { value: '1.2 to 2.7 s', label: 'per map (walk, car)' },
      { value: '≈ 5 / s', label: 'requests accepted by the service' },
      { value: '30 to 60 / s', label: 'maps needed to follow the mouse' },
    ],
    keptTitle: 'What still comes from the Géoplateforme',
    kept: [
      'The road network: BD TOPO sections read from the WFS service (directions, pedestrian and car access, speeds, street names).',
      'The basemap (Plan IGN vector tiles) and the addresses near a point (reverse geocoding).',
      'The route service as a reference: when the cursor stops, its walking or driving time is shown beside ours; the walking speed on the flat is the same (4 km/h), but it ignores slopes; night driving times differ by about 15 %.',
    ],
    next: 'What would let the Géoplateforme serve this directly: a "one to many" service (a matrix of travel times, or isochrones as a grid), or a routing graph one can download.',
  },
  why: {
    title: 'Why Rust and WebAssembly',
    text: 'The computation runs on your own computer, with no round trip to a server. The engine is written in Rust and compiled to WebAssembly, a format close to machine code that the browser runs almost as fast as an installed program. JavaScript could do the same work, but more slowly and with small freezes: from time to time it stops to clean up its memory (the garbage collector). The Rust engine reuses the same memory on every computation, so it never pauses.',
    stats: [
      { value: '30 KB', label: 'engine, compiled' },
      { value: '13', label: 'regions' },
      { value: '18 M', label: 'road edges' },
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
      'Zone: metropolitan France, one region at a time; footpaths and service roads only in the main city centres. Public transport: the networks that publish their timetables, which leaves out a few small towns.',
      'Closures: an express train that skips the closed stations still runs; the Géoplateforme route ignores closures.',
      'Buildings: each one takes the time of the street nearest to its middle, not of its actual entrance.',
    ],
  },
  more: 'Technical documentation',
};

const fr: typeof en = {
  title: 'Comment ça marche',
  lead:
    'Chaque mouvement de souris recalcule le temps de trajet vers les carrefours de la région affichée, jusqu’à quelques millions, et les redessine, dans votre navigateur, sans serveur. Toute la France métropolitaine, une région à la fois. Voici comment.',
  backToMap: 'Retour à la carte',
  sourceCode: 'Code source',
  legalNotice: 'Mentions légales',
  diagram: {
    title: 'Des données ouvertes aux couleurs à l’écran',
    hint: 'Cliquez sur une boîte pour lire ce qu’elle fait.',
    label: 'Chaîne de traitement de geo-reach',
    labels: { zoomIn: 'Zoomer', zoomOut: 'Dézoomer', fit: 'Ajuster', reset: 'Rétablir la disposition' },
    groups: { offline: 'Préparé une fois, hors ligne', browser: 'Dans votre navigateur, à chaque mouvement' },
    edges: {
      zone: 'zone',
      tracks: 'voies ferrées',
      cargo: 'cargo build',
      loaded: 'chargé une fois',
      csr: 'tableaux du graphe',
      sources: '2 points de départ',
      instance: 'tourne dans',
      times: 'temps des nœuds',
      path: 'chemin',
      stop: 'quand le curseur s’arrête',
      address: 'adresses',
      networkCopy: 'copie du réseau',
      fourModes: 'même trajet, 4 modes',
      slopes: 'montée, descente',
      closed: 'arêtes fermées',
      sameTimes: 'mêmes temps des nœuds',
      basemap: 'fond de carte',
      extruded: 'extrudées dans un worker',
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
        text: 'Tous les tronçons de route de France métropolitaine, région par région, avec leur sens de circulation, l’accès piéton et voiture, la vitesse moyenne, les aménagements cyclables et le nom de la rue. Téléchargés tuile par tuile depuis le service WFS de la Géoplateforme ; hors des principaux centres-villes, le service écarte lui-même chemins et voies de service. Les voies ferrées (trains, métros, trams) viennent du même service.',
      },
      gtfs: {
        label: 'Horaires',
        detail: 'GTFS, transport.data.gouv.fr',
        text: 'Les horaires de transports en commun au format standard GTFS : Île-de-France Mobilités, les agrégats régionaux des réseaux urbains et interurbains (sept régions), ailleurs les trains SNCF avec les principaux réseaux urbains et les cars régionaux, fusionnés.',
      },
      relief: {
        label: 'Altitudes BD TOPO',
        detail: 'Z des tronçons, RGE ALTI',
        text: 'Chaque tronçon de route arrive avec l’altitude de chacun de ses points (Z) : la surface de la route drapée sur le modèle de terrain RGE ALTI, au décimètre. Lue dans le même service WFS que les routes.',
      },
      buildGraph: {
        label: 'prep roads',
        detail: 'Rust, région par région',
        text: 'Transforme les tronçons en graphe : les extrémités deviennent des nœuds (carrefours), les tronçons des arêtes. Chaque arête garde les mètres montés et descendus sur son parcours, d’après l’altitude de ses points (les bosses de moins de 0,5 m sont ignorées). Les coordonnées sont en mètres relatifs au centre de la zone, pour tenir en nombres 32 bits sans perte de précision.',
        file: 'crates/prep/src/roads/graph.rs',
      },
      gtfsPrep: {
        label: 'prep transit',
        detail: 'Rust, région par région',
        text: 'Fusionne les flux de chaque région, aligné sur son réseau routier. Lit les horaires de la région et garde, pour un jour de semaine de référence et pour chaque heure, le temps de trajet médian entre deux stations et l’attente moyenne (la moitié du temps entre deux départs). Les lignes arrivent avec leur tracé ; quand un flux n’en a pas (les trains SNCF, le métro de Lille, le tram de Montpellier), le trajet suit les voies BD TOPO entre ses deux stations.',
        file: 'crates/prep/src/transit.rs',
      },
      graphBin: {
        label: 'Réseaux routiers',
        detail: '13 régions · 18 M arêtes',
        text: 'Un fichier binaire compact par région : de simples tableaux de nombres à la suite, montées et descentes comprises, compressés (1 à 52 Mo). Le navigateur les lit directement comme tableaux typés à la fin du téléchargement, sans analyse. Chaque région déborde d’environ 20 km, pour les trajets qui passent sa frontière.',
      },
      transitBin: {
        label: 'Couches transports',
        detail: '13 régions · 14 000 lignes',
        text: 'Par région, les stations, les lignes avec leurs couleurs, attentes et temps de trajet heure par heure, et tracés des lignes. Greffé sur le graphe routier au chargement de la page : chaque station est reliée aux rues les plus proches.',
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
        detail: 'dans un worker',
        text: 'Télécharge les fichiers de la région affichée (une seule fois : le navigateur les garde pour les visites suivantes, même hors ligne), les décompresse, les lit comme tableaux typés, fusionne la couche transports en commun dans le graphe routier et prépare le premier mode. Tout cela tourne dans un Web Worker, un fil d’exécution en arrière-plan : quand la vue passe dans une autre région, ses fichiers se chargent pendant que la carte affichée continue de suivre la souris, puis le nouveau réseau prend le relais au même endroit.',
        file: 'web/src/features/routing/network.worker.ts',
      },
      profile: {
        label: 'Profil',
        detail: 'mode, heure, sens',
        text: 'Calcule le temps de parcours de chaque arête pour le mode choisi (marche 4 km/h et vélo 15 km/h sur le plat, plus lents en montée d’après les altitudes BD TOPO, voiture avec le trafic de l’heure, transports avec les attentes de l’heure), puis range le graphe en tableaux compacts (CSR) écrits une fois dans la mémoire du moteur. Changer de mode le reconstruit ; bouger la souris, non.',
        file: 'web/src/features/routing/profile.ts',
      },
      cuts: {
        label: 'Coupures',
        detail: 'simulation, depuis la carte',
        text: 'Une ligne de métro, RER ou tram coupée entre deux stations, ou une rue fermée pour tous les modes : leurs arêtes deviennent infranchissables et le profil est reconstruit (environ 120 ms). Un second worker fait le même calcul tout ouvert, en parallèle : la comparaison donne les stations qui perdent plus de 5 min.',
        file: 'web/src/features/cuts/cuts.ts',
      },
      snap: {
        label: 'Accroche',
        detail: 'curseur → rue la plus proche',
        text: 'Le curseur peut être dans un parc ou sur un toit. Une grille de cases de 80 m trouve la rue praticable la plus proche, et l’endroit de la rue où tombe le curseur. La marche jusqu’à cette rue est ajoutée au trajet. Seules comptent les rues d’où l’on peut repartir et revenir : un sens unique sans issue, ou une rue voiture au milieu d’une zone piétonne, ne mèneraient nulle part.',
        file: 'web/src/features/routing/snap.ts',
      },
      dijkstra: {
        label: 'Dijkstra',
        detail: 'WebAssembly, page ou worker',
        text: 'Part des deux extrémités de la rue accrochée et s’étend jusqu’au temps maximum. Un calcul long tourne dans un Web Worker, un fil d’exécution en arrière-plan : même un calcul sur toute la région ne fige jamais la carte. Un calcul court (quelques millisecondes, le cas courant) tourne dans la page elle-même, dès que la souris bouge, pour que l’image suivante le montre. Les temps du worker sont transmis à la page sans copie, et seuls les carrefours atteints la fois précédente sont remis à zéro, pas tout le réseau.',
        file: 'crates/engine/src/dijkstra.rs',
      },
      layer: {
        label: 'Couche WebGL',
        detail: 'couleurs sur le GPU',
        text: 'La géométrie des rues est préparée par un worker et envoyée une fois par mode à la carte graphique, rangée en carrés d’environ 2 km : chaque image ne dessine que les carrés à l’écran (quelque 20 000 bouts de rue sur plusieurs millions). À chaque mouvement, seul le temps de chaque carrefour est envoyé (un nombre par carrefour) ; la carte graphique calcule la couleur de chaque bout de rue, puis dessine un halo large (la carte de chaleur) et des lignes fines par-dessus.',
        file: 'web/src/features/map/networkLayer.ts',
      },
      buildings: {
        label: 'Bâtiments 3D',
        detail: 'colorés sur le GPU',
        text: 'Les bâtiments BD TOPO, extrudés à leur hauteur par un worker (façades ombrées selon leur orientation, toits plats). Chaque bâtiment est rattaché une fois à sa rue la plus proche ; la carte graphique lit ensuite les temps de cette rue dans la même texture que le réseau : les bâtiments suivent le curseur à chaque mouvement, sans coût pour la page.',
        file: 'web/src/features/buildings/buildingGlLayer.ts',
      },
      panel: {
        label: 'Panneau de trajet',
        detail: 'chemin, étapes, chiffres',
        text: 'Avec un point fixé, le chemin jusqu’au curseur est relu dans le dernier calcul (pas de nouveau Dijkstra) : rues, attentes et lignes deviennent les étapes du trajet. Les chiffres (surface, stations, pistes cyclables, stations retardées par les coupures) viennent du même résultat.',
        file: 'web/src/features/trip/legs.ts',
      },
      compare: {
        label: 'Comparaison des modes',
        detail: 'un worker dédié',
        text: 'Quand le curseur s’arrête sur une destination, le même trajet à pied, à vélo, en voiture et en transports en commun. Ce worker prépare une fois le réseau de chaque mode pour les réglages en cours, puis chaque trajet est un Dijkstra qui s’arrête à sa destination : la carte qui suit la souris ne l’attend jamais.',
        file: 'web/src/features/routing/compare.worker.ts',
      },
      tiles: {
        label: 'Plan IGN',
        detail: 'tuiles vectorielles',
        text: 'Le fond de carte : tuiles vectorielles Plan IGN de la Géoplateforme, style gris. Le moteur isard le dessine avec le réseau, les bâtiments et les coupures entre ses rues et ses étiquettes.',
      },
      buildingTiles: {
        label: 'Tuiles BD TOPO',
        detail: 'bâtiments et hauteurs',
        text: 'Les tuiles vectorielles BD TOPO de la Géoplateforme, à partir du zoom 15 : le contour et la hauteur de chaque bâtiment. Seules les tuiles autour de la vue sont téléchargées.',
      },
      route: {
        label: 'Calcul d’itinéraire',
        detail: 'itineraire',
        text: 'Quand le curseur s’arrête, le service d’itinéraire de la Géoplateforme calcule le même trajet à pied ou en voiture, affiché à côté du résultat local pour comparaison. Les requêtes plus anciennes sont annulées.',
        file: 'web/src/shared/gpf.ts',
      },
      geocode: {
        label: 'Géocodage',
        detail: 'adresses, recherche',
        text: 'Donne l’adresse du départ et de la destination, une fois le curseur arrêté ; et pendant la saisie dans le champ de recherche, les adresses et lieux qui correspondent (service d’autocomplétion).',
        file: 'web/src/shared/gpf.ts',
      },
    },
  },
  sandbox: {
    title: 'Essayer sur une ville fictive',
    text: 'Le même moteur que la carte (le Dijkstra WebAssembly dans son worker, l’accroche, la greffe des transports) sur une petite ville dessinée pour l’occasion : 3 km de rues tous les 100 m, une rivière et trois ponts, une colline, une voie rapide, un centre ancien piéton, des sens uniques, un parc traversé par un chemin, un métro et un bus. Bougez la souris : tout est recalculé depuis le curseur. Cliquez pour fixer un départ ; la souris devient alors la destination.',
    mode: 'Mode',
    modes: { pedestrian: 'Marche', bike: 'Vélo', car: 'Voiture', transit: 'TC' },
    maxTime: (m) => `Temps maximal · ${m} min`,
    hour: (h) => `Départ · ${h} h`,
    relief: 'Pentes (la colline)',
    wait: 'Attente',
    waits: { half: 'moyenne', full: 'pire cas' },
    bus: 'Bus ligne 21',
    bridge: 'Fermer le pont du milieu',
    labels: { river: 'Rivière', park: 'Parc', oldTown: 'Centre ancien, piéton', hill: 'Colline +50 m', expressway: 'Voie rapide (voitures)', boulevard: 'Boulevard, piste cyclable' },
    run: (ms, nodes) => `Dijkstra : ${ms} ms, ${nodes} nœuds traités`,
    reached: (share, m) => `${share} % des carrefours à moins de ${m} min`,
    hint: 'Survolez la ville pour partir du curseur. Cliquez pour fixer le départ.',
    pinned: 'Départ fixé : le curseur est la destination. Cliquez à nouveau pour le libérer.',
    trip: (time) => `Trajet : ${time}`,
    unreachable: 'Au-delà du temps maximal',
    legs: { street: 'rues', link: 'vers la station', wait: 'attente', ride: 'trajet', transfer: 'sortie, correspondance', access: 'marche jusqu’à la rue' },
    noService: 'Ni métro ni bus à cette heure',
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
  gpf: {
    title: 'Pourquoi ne pas utiliser directement le calcul d’itinéraire de la Géoplateforme',
    text: 'La première version de cette démo l’utilisait : à chaque clic, elle demandait une série d’isochrones à la Géoplateforme et les assemblait en carte. Ça fonctionne, mais une carte prend une à trois secondes, et le service accepte environ cinq requêtes par seconde. Suivre la souris demande une nouvelle carte à chaque rafraîchissement de l’écran : cent fois plus. Le service est fait pour répondre à des demandes d’itinéraire, pas pour alimenter une carte interactive ; il ne gère pas non plus les transports en commun. Les données viennent donc de la Géoplateforme, et le calcul se fait dans le navigateur.',
    stats: [
      { value: '12 à 15', label: 'requêtes d’isochrones pour une carte' },
      { value: '1,2 à 2,7 s', label: 'par carte (à pied, voiture)' },
      { value: '≈ 5 / s', label: 'requêtes acceptées par le service' },
      { value: '30 à 60 / s', label: 'cartes nécessaires pour suivre la souris' },
    ],
    keptTitle: 'Ce qui vient toujours de la Géoplateforme',
    kept: [
      'Le réseau routier : tronçons BD TOPO lus par le service WFS (sens de circulation, accès piéton et voiture, vitesses, noms de voies).',
      'Le fond de carte (tuiles vectorielles Plan IGN) et les adresses près d’un point (géocodage inverse).',
      'Le calcul d’itinéraire comme référence : quand le curseur s’arrête, son temps à pied ou en voiture s’affiche à côté du nôtre ; la vitesse de marche sur le plat est la même (4 km/h), mais il ignore les pentes ; les temps en voiture de nuit diffèrent d’environ 15 %.',
    ],
    next: 'Ce qui permettrait à la Géoplateforme de servir ce besoin directement : un service « un vers plusieurs » (matrice de temps de trajet, ou isochrones en grille), ou un graphe routier téléchargeable.',
  },
  why: {
    title: 'Pourquoi Rust et WebAssembly',
    text: 'Le calcul se fait sur votre ordinateur, sans aller-retour vers un serveur. Le moteur est écrit en Rust et compilé en WebAssembly, un format proche du langage machine que le navigateur exécute presque aussi vite qu’un programme installé. JavaScript pourrait faire le même travail, mais plus lentement et avec de petits à-coups : de temps en temps, il s’arrête pour faire le ménage dans sa mémoire (le « ramasse-miettes »). Le moteur Rust réutilise la même mémoire à chaque calcul, il n’a donc jamais à s’arrêter.',
    stats: [
      { value: '30 Ko', label: 'moteur compilé' },
      { value: '13', label: 'régions' },
      { value: '18 M', label: 'tronçons de route' },
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
      'Zone : France métropolitaine, une région à la fois ; chemins et voies de service seulement dans les principaux centres-villes. Transports en commun : les réseaux qui publient leurs horaires, ce qui laisse de côté quelques petites villes.',
      'Coupures : un train direct qui ne dessert pas les stations coupées circule toujours ; l’itinéraire Géoplateforme ignore les coupures.',
      'Bâtiments : chacun prend le temps de la rue la plus proche de son centre, pas celui de sa véritable entrée.',
    ],
  },
  more: 'Documentation technique',
};

export const howItWorks = navigator.language.toLowerCase().startsWith('fr') ? fr : en;
