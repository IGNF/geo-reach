/** Texts of the detailed figures of the "How it works" diagram, English and French (same keys) */

/** A formula: its lines, then what its symbols stand for */
export interface FormulaText {
  lines: string[];
  terms: [symbol: string, meaning: string][];
}

export type ReferenceKey =
  | 'tobler'
  | 'parkin'
  | 'osuna'
  | 'ingvardson'
  | 'singh'
  | 'gtfs'
  | 'dijkstra'
  | 'chen'
  | 'sharir'
  | 'borgefors'
  | 'lorensen';

const en = {
  example: 'Made-up example: the values show the computation.',
  where: 'where:',
  source: 'Source:',
  references: {
    tobler: 'Tobler (1993), “Three presentations on geographical analysis and modeling”, NCGIA technical report 93-1',
    parkin: 'Parkin and Rotheram (2010), “Design speeds and acceleration characteristics of bicycle traffic”, Transport Policy 17',
    osuna: 'Osuna and Newell (1972), “Control strategies for an idealized public transportation system”, Transportation Science 6',
    ingvardson:
      'Ingvardson, Nielsen, Raveau and Nielsen (2018), “Passenger arrival and waiting time distributions dependent on train service frequency”, Transportation Research C 90',
    singh:
      'Singh, Graham, Hörcher and Anderson (2021), “The boundary between random and non-random passenger arrivals”, Transportation Research C 130',
    gtfs: 'GTFS Schedule reference (MobilityData)',
    dijkstra: 'Dijkstra (1959), “A note on two problems in connexion with graphs”, Numerische Mathematik 1',
    chen: 'Chen, Chowdhury, Ramachandran, Roche and Tong (2007), “Priority queues and Dijkstra’s algorithm”, UTCS TR-07-54',
    sharir: 'Sharir (1981), “A strong-connectivity algorithm and its applications in data flow analysis” (Kosaraju’s algorithm)',
    borgefors: 'Borgefors (1986), “Distance transformations in digital images”, Computer Vision, Graphics, and Image Processing 34',
    lorensen: 'Lorensen and Cline (1987), “Marching cubes”, ACM SIGGRAPH Computer Graphics 21 (marching squares in 2D)',
  } satisfies Record<ReferenceKey, string>,
  buildGraph: {
    head: ['Point', 'Height', 'Counted'],
    up: 'climb',
    down: 'descent',
    ignored: 'ignored (< 0.5 m)',
    distance: 'distance along the section',
    result: (up: string, down: string, rawUp: string, rawDown: string): string =>
      `Climb ${up} m, descent ${down} m (point to point: ${rawUp} m and ${rawDown} m).`,
    formula: {
      lines: ['Δz = z_i − z_r', 'counted if Δz goes the same way as before, or if |Δz| ≥ 0.5 m'],
      terms: [
        ['z_i', 'height of the point, BD TOPO (road draped on the RGE ALTI)'],
        ['z_r', 'height of the last point counted'],
      ],
    } satisfies FormulaText,
    note: 'The 0.5 m threshold only applies when the slope turns: the small bumps of the terrain model (a kerb, a bridge end) are not counted as climbs.',
  },
  gtfsPrep: {
    head: ['Line', 'Departures / h', 'H, min', 'H/2, min', 'W, min'],
    lines: { metro: 'Metro', tram: 'Tram', bus: 'Bus' },
    random: 'H/2 (random arrivals)',
    model: 'W (used)',
    headwayAxis: 'H, minutes between departures',
    waitAxis: 'wait, min',
    formula: {
      lines: ['H = 60 / n', 'W = H/2   if H ≤ 10 min', 'W = 5 + (H − 10) / 3   beyond', 'boarding = W + 1 min'],
      terms: [
        ['n', 'departures of the line at the stop in the hour, reference weekday'],
        ['H', 'headway, minutes'],
        ['W', 'average wait, minutes'],
      ],
    } satisfies FormulaText,
    note: 'On a frequent line one arrives at random and waits half the headway. Beyond about 10 min, passengers follow the timetable: each extra minute of headway adds only a third of a minute of wait. The “worst case” setting waits the whole headway.',
  },
  profile: {
    head: ['Grade', 'Walk', 'Bike'],
    walk: 'walk (Tobler)',
    bike: 'bike (Parkin & Rotheram)',
    gradeAxis: 'grade',
    factorAxis: 'time factor',
    formula: {
      lines: ['t = L / v × f(g) + p', 'f_walk(g) = exp(3.5 (|g + 0.05| − 0.05))', 'f_bike(g) = 1 / max(1 − 6.67 g, 1/3)   uphill', 'f_bike(g) = 1 / min(1 + 3.98 g, 1.4)   downhill'],
      terms: [
        ['t', 'seconds to travel the edge'],
        ['L', 'length of the edge, metres'],
        ['v', 'speed on the flat: walk 4 km/h, bike 15 km/h, car BD TOPO speed × traffic of the hour'],
        ['g', 'grade, climb or descent over the length (capped at 25 %)'],
        ['p', 'crossings: 1.5 s per section by bike and on local streets by car'],
      ],
    } satisfies FormulaText,
    calc: (walk: string, bike: string): string => `200 m climbing 10 m (g = 5 %): walk 180 s × ${walk}, bike 48 s × ${bike} + 1.5 s`,
    note: 'Bike coefficients from GPS tracks of everyday cyclists: 21.6 km/h on the flat, 1.44 km/h less per percent uphill, 0.86 km/h more per percent downhill, kept as shares of the chosen speed. Beyond 10 %, the cyclist pushes the bike.',
  },
  snap: {
    cursor: 'cursor',
    edge: 'street',
    walk: 'walk',
    head: ['Start point', 'Cost'],
    formula: {
      lines: ['f = (P − A) · (B − A) / |B − A|²', 'c_A = d / v + f × c_BA', 'c_B = d / v + (1 − f) × c_AB'],
      terms: [
        ['P', 'cursor; A and B, ends of the nearest street the mode can use'],
        ['f', 'place of the projection along the street, 0 at A, 1 at B'],
        ['d', 'distance from the cursor to the street, walked at v = 4 km/h'],
        ['c_AB', 'cost of the street from A to B (c_BA the other way)'],
      ],
    } satisfies FormulaText,
    note: 'Only the streets of the large strongly connected component count: from any of them one can reach any other and come back.',
  },
  dijkstra: {
    head: ['Step', 'Node out of the heap', 'Time, s', 'Updates'],
    stale: 'stale entry, skipped',
    beyond: (node: string, time: string): string => `${node} at ${time}: beyond T, refused`,
    formula: {
      lines: ['d(v) ← d(u) + c(u, v)   if smaller than d(v) and ≤ T'],
      terms: [
        ['d(v)', 'best time known to node v, seconds'],
        ['c(u, v)', 'cost of the arc from u to v (profile)'],
        ['T', 'maximum time of the map, the bound of the search'],
      ],
    } satisfies FormulaText,
    note: 'Starts from the two ends of the street under the cursor at once. No decrease-key: an improved node is pushed again and its old entry is skipped when it comes out, which is faster in practice.',
  },
  contours: {
    level: (t: string): string => `${t} min line`,
    formula: {
      lines: ['t(c) = min(t(c), t(n) + w × k)', 'x = (T − t_0) / (t_1 − t_0)'],
      terms: [
        ['t(c)', 'time of a 150 m cell: its best street node first'],
        ['w', 'walk across a cell (150 m at 4 km/h = 135 s), at most 2 cells from a street'],
        ['k', '1 to a side neighbour n, √2 to a diagonal one'],
        ['x', 'where the line of duration T crosses the side of a cell, between its corners t_0 and t_1'],
      ],
    } satisfies FormulaText,
    note: 'Two passes over the grid (chamfer distance) spread the times between the streets; each cell then gives a piece of line where its corners fall on both sides of the duration (marching squares).',
  },
  layer: {
    meet: 'two waves meet',
    formula: {
      lines: ['t(x) = min(t_A + x c_AB, t_B + (1 − x) c_BA)', 'color = ramp(t / T)'],
      terms: [
        ['t_A', 'time of node A from the engine, one number per node sent to the GPU at each move'],
        ['x', 'place along the street, 0 at A, 1 at B'],
        ['c_AB', 'cost of the whole street from A to B'],
      ],
    } satisfies FormulaText,
    note: 'The vertex shader reads the times of the two ends in a texture and computes t at each point of the geometry; the GPU blends the colors between the points.',
  },
  engineCrate: {
    graph: 'graph',
    arrays: 'arrays (CSR)',
    arcsOf: (n: number): string => `arcs of node ${n}`,
    formula: {
      lines: ['arcs(n) = offsets[n] … offsets[n + 1] − 1'],
      terms: [
        ['offsets', 'where the arcs of each node start, one number per node (+ 1)'],
        ['heads, costs', 'end node and seconds of each arc, side by side in memory'],
      ],
    } satisfies FormulaText,
    note: 'The whole graph is four plain arrays of numbers: no object per node, no pointer to follow. The buffers are allocated once per profile; a run only writes into them, and resets just the nodes the previous run reached.',
  },
  wasm: {
    page: 'Page (TypeScript)',
    worker: 'Web Worker',
    memory: 'Wasm memory',
    write: 'graph, once per profile',
    run: 'run(2 starts, T)',
    back: 'times (transferred, not copied)',
    note: 'The page snaps the cursor and sends two start nodes; the worker writes them into the engine memory, calls run, and hands the times back. The map thread never computes a path.',
  },
  loaders: {
    file: '.bin.gz',
    inflate: 'inflated by the browser',
    kept: 'kept for the next visits',
    views: 'typed arrays: views, no copy',
    cache: 'Cache Storage',
    blocks: ['header', 'nodes x, y', 'edge A', 'edge B', 'lengths', 'flags', '…'],
    note: 'Each block of the file is read as an array of numbers right where it lies in the downloaded buffer: nothing is parsed. The transit file then adds its stations and line stops after the street nodes.',
  },
  cuts: {
    closed: 'closed',
    open: 'all open',
    withCut: 'with the closure',
    head: ['Station', 'All open', 'Closure', 'Delay'],
    formula: {
      lines: ['c(e) = ∞   for every closed edge e, both ways', 'Δ(s) = t_cut(s) − t_open(s)'],
      terms: [
        ['t_cut', 'time to station s with the closure (first worker)'],
        ['t_open', 'time with everything open (second worker, same start)'],
      ],
    } satisfies FormulaText,
    note: 'The closed edges leave the graph; the profile is rebuilt in about 120 ms. The panel counts the stations that lose more than 5 min.',
  },
  panel: {
    back: 'walked back from the destination, predecessor by predecessor',
    legs: ['Walk, Rue A', 'Wait', 'Line M'],
    head: ['Edges of the path', 'Leg'],
    rows: [
      ['Rue A 1 min 30 · Rue A 1 min', 'Walk, Rue A, 2 min 30'],
      ['link 20 s', 'joins the walk'],
      ['boarding 2 min 30', 'Wait, line M'],
      ['ride 1 min 10 · ride 1 min 10', 'Line M, 2 stops, 2 min 20'],
      ['alighting 1 min 30', 'joins the ride'],
    ],
    note: 'No new computation: the last run keeps, for each node, the node and the edge it was reached from. Consecutive streets of the same name merge, as do the rides of one line.',
  },
  compare: {
    modes: { pedestrian: 'Walk', bike: 'Bike', car: 'Car', transit: 'Transit' },
    note: 'Once the cursor stops: one Dijkstra per mode, in a worker of its own, stopped as soon as the destination is settled (its time can no longer drop). The network of each mode is prepared once per setting.',
  },
  buildings: {
    building: 'building',
    street: 'its nearest street',
    caption: (street: number, walk: number): string => `Street A–B: ${street} min end to end · then ${walk} s on foot`,
    formula: {
      lines: ['t(b) = min(t_A + c_A, t_B + c_B)'],
      terms: [
        ['t_A', 'time of the ends A and B of the street nearest to the middle of building b'],
        ['c_A', 'seconds from A to the building along the street, then on foot'],
      ],
    } satisfies FormulaText,
    note: 'The join is computed once per profile; at every move the graphics card reads the times of A and B in the same texture as the streets.',
  },
};

const fr: typeof en = {
  example: 'Exemple fictif : les valeurs montrent le calcul.',
  where: 'où :',
  source: 'Source :',
  references: en.references,
  buildGraph: {
    head: ['Point', 'Altitude', 'Compté'],
    up: 'montée',
    down: 'descente',
    ignored: 'ignoré (< 0,5 m)',
    distance: 'distance le long du tronçon',
    result: (up, down, rawUp, rawDown) => `Montée ${up} m, descente ${down} m (point à point : ${rawUp} m et ${rawDown} m).`,
    formula: {
      lines: ['Δz = z_i − z_r', 'compté si Δz va dans le même sens qu’avant, ou si |Δz| ≥ 0,5 m'],
      terms: [
        ['z_i', 'altitude du point, BD TOPO (route drapée sur le RGE ALTI)'],
        ['z_r', 'altitude du dernier point compté'],
      ],
    },
    note: 'Le seuil de 0,5 m ne joue que quand la pente change de sens : les petites bosses du modèle de terrain (une bordure, une culée de pont) ne comptent pas comme des montées.',
  },
  gtfsPrep: {
    head: ['Ligne', 'Passages / h', 'H, min', 'H/2, min', 'W, min'],
    lines: { metro: 'Métro', tram: 'Tram', bus: 'Bus' },
    random: 'H/2 (arrivées au hasard)',
    model: 'W (retenu)',
    headwayAxis: 'H, minutes entre deux passages',
    waitAxis: 'attente, min',
    formula: {
      lines: ['H = 60 / n', 'W = H/2   si H ≤ 10 min', 'W = 5 + (H − 10) / 3   au-delà', 'montée = W + 1 min'],
      terms: [
        ['n', 'passages de la ligne à l’arrêt dans l’heure, jour ouvré de référence'],
        ['H', 'intervalle entre deux passages, minutes'],
        ['W', 'attente moyenne, minutes'],
      ],
    },
    note: 'Sur une ligne fréquente on arrive au hasard et on attend la moitié de l’intervalle. Au-delà de 10 min environ, les voyageurs suivent l’horaire : chaque minute d’intervalle en plus n’ajoute qu’un tiers de minute d’attente. Le réglage « pire cas » attend l’intervalle entier.',
  },
  profile: {
    head: ['Pente', 'Marche', 'Vélo'],
    walk: 'marche (Tobler)',
    bike: 'vélo (Parkin & Rotheram)',
    gradeAxis: 'pente',
    factorAxis: 'facteur de temps',
    formula: {
      lines: ['t = L / v × f(g) + p', 'f_marche(g) = exp(3,5 (|g + 0,05| − 0,05))', 'f_vélo(g) = 1 / max(1 − 6,67 g, 1/3)   en montée', 'f_vélo(g) = 1 / min(1 + 3,98 g, 1,4)   en descente'],
      terms: [
        ['t', 'secondes pour parcourir l’arête'],
        ['L', 'longueur de l’arête, mètres'],
        ['v', 'vitesse sur le plat : marche 4 km/h, vélo 15 km/h, voiture vitesse BD TOPO × trafic de l’heure'],
        ['g', 'pente, montée ou descente sur la longueur (plafonnée à 25 %)'],
        ['p', 'intersections : 1,5 s par tronçon à vélo et sur les rues locales en voiture'],
      ],
    },
    calc: (walk, bike) => `200 m qui montent de 10 m (g = 5 %) : marche 180 s × ${walk}, vélo 48 s × ${bike} + 1,5 s`,
    note: 'Coefficients vélo tirés de traces GPS de cyclistes du quotidien : 21,6 km/h sur le plat, 1,44 km/h de moins par pour cent de montée, 0,86 km/h de plus par pour cent de descente, gardés en proportion de la vitesse choisie. Au-delà de 10 %, le cycliste pousse son vélo.',
  },
  snap: {
    cursor: 'curseur',
    edge: 'rue',
    walk: 'marche',
    head: ['Point de départ', 'Coût'],
    formula: {
      lines: ['f = (P − A) · (B − A) / |B − A|²', 'c_A = d / v + f × c_BA', 'c_B = d / v + (1 − f) × c_AB'],
      terms: [
        ['P', 'curseur ; A et B, extrémités de la rue la plus proche praticable par le mode'],
        ['f', 'position du projeté le long de la rue, 0 en A, 1 en B'],
        ['d', 'distance du curseur à la rue, parcourue à pied à v = 4 km/h'],
        ['c_AB', 'coût de la rue de A vers B (c_BA dans l’autre sens)'],
      ],
    },
    note: 'Seules comptent les rues de la grande composante fortement connexe : depuis chacune on peut atteindre toutes les autres et revenir.',
  },
  dijkstra: {
    head: ['Étape', 'Nœud sorti du tas', 'Temps, s', 'Mises à jour'],
    stale: 'entrée périmée, ignorée',
    beyond: (node, time) => `${node} à ${time} : au-delà de T, refusé`,
    formula: {
      lines: ['d(v) ← d(u) + c(u, v)   si plus petit que d(v) et ≤ T'],
      terms: [
        ['d(v)', 'meilleur temps connu jusqu’au nœud v, secondes'],
        ['c(u, v)', 'coût de l’arc de u vers v (profil)'],
        ['T', 'temps maximal de la carte, borne de la recherche'],
      ],
    },
    note: 'Part des deux extrémités de la rue sous le curseur à la fois. Pas de « decrease-key » : un nœud amélioré est remis dans le tas et son ancienne entrée ignorée à sa sortie, ce qui est plus rapide en pratique.',
  },
  contours: {
    level: (t) => `ligne ${t} min`,
    formula: {
      lines: ['t(c) = min(t(c), t(n) + w × k)', 'x = (T − t_0) / (t_1 − t_0)'],
      terms: [
        ['t(c)', 'temps d’une maille de 150 m : d’abord son meilleur nœud de rue'],
        ['w', 'traversée d’une maille à pied (150 m à 4 km/h = 135 s), au plus 2 mailles depuis une rue'],
        ['k', '1 vers un voisin n de côté, √2 en diagonale'],
        ['x', 'où la ligne de durée T coupe le côté d’une maille, entre ses coins t_0 et t_1'],
      ],
    },
    note: 'Deux passes sur la grille (distance de chanfrein) étalent les temps entre les rues ; chaque maille donne ensuite un morceau de ligne là où ses coins tombent de part et d’autre de la durée (marching squares).',
  },
  layer: {
    meet: 'deux fronts se rejoignent',
    formula: {
      lines: ['t(x) = min(t_A + x c_AB, t_B + (1 − x) c_BA)', 'couleur = rampe(t / T)'],
      terms: [
        ['t_A', 'temps du nœud A donné par le moteur, un nombre par nœud envoyé au GPU à chaque mouvement'],
        ['x', 'position le long de la rue, 0 en A, 1 en B'],
        ['c_AB', 'coût de toute la rue de A vers B'],
      ],
    },
    note: 'Le vertex shader lit les temps des deux extrémités dans une texture et calcule t en chaque point de la géométrie ; le GPU fond les couleurs entre les points.',
  },
  engineCrate: {
    graph: 'graphe',
    arrays: 'tableaux (CSR)',
    arcsOf: (n) => `arcs du nœud ${n}`,
    formula: {
      lines: ['arcs(n) = offsets[n] … offsets[n + 1] − 1'],
      terms: [
        ['offsets', 'où commencent les arcs de chaque nœud, un nombre par nœud (+ 1)'],
        ['heads, costs', 'nœud d’arrivée et secondes de chaque arc, côte à côte en mémoire'],
      ],
    },
    note: 'Tout le graphe tient en quatre tableaux de nombres : pas d’objet par nœud, pas de pointeur à suivre. Les tampons sont alloués une fois par profil ; un calcul ne fait qu’écrire dedans et ne remet à zéro que les nœuds atteints la fois précédente.',
  },
  wasm: {
    page: 'Page (TypeScript)',
    worker: 'Web Worker',
    memory: 'Mémoire Wasm',
    write: 'graphe, une fois par profil',
    run: 'run(2 départs, T)',
    back: 'temps (transférés, pas copiés)',
    note: 'La page accroche le curseur et envoie deux nœuds de départ ; le worker les écrit dans la mémoire du moteur, appelle run et rend les temps. Le fil de la carte ne calcule jamais d’itinéraire.',
  },
  loaders: {
    file: '.bin.gz',
    inflate: 'décompressé par le navigateur',
    kept: 'gardé pour les visites suivantes',
    views: 'tableaux typés : des vues, sans copie',
    cache: 'Cache Storage',
    blocks: ['en-tête', 'nœuds x, y', 'arête A', 'arête B', 'longueurs', 'drapeaux', '…'],
    note: 'Chaque bloc du fichier est lu comme un tableau de nombres là où il se trouve dans le tampon téléchargé : rien n’est analysé. Le fichier TC ajoute ensuite ses stations et arrêts de ligne après les nœuds des rues.',
  },
  cuts: {
    closed: 'fermé',
    open: 'tout ouvert',
    withCut: 'avec la fermeture',
    head: ['Station', 'Tout ouvert', 'Fermeture', 'Retard'],
    formula: {
      lines: ['c(e) = ∞   pour chaque arête fermée e, dans les deux sens', 'Δ(s) = t_cut(s) − t_open(s)'],
      terms: [
        ['t_cut', 'temps jusqu’à la station s avec la fermeture (premier worker)'],
        ['t_open', 'temps avec tout ouvert (second worker, même départ)'],
      ],
    },
    note: 'Les arêtes fermées sortent du graphe ; le profil est reconstruit en 120 ms environ. Le panneau compte les stations qui perdent plus de 5 min.',
  },
  panel: {
    back: 'remonté depuis la destination, prédécesseur après prédécesseur',
    legs: ['Marche, rue A', 'Attente', 'Ligne M'],
    head: ['Arêtes du chemin', 'Étape'],
    rows: [
      ['Rue A 1 min 30 · Rue A 1 min', 'Marche, rue A, 2 min 30'],
      ['lien 20 s', 'rejoint la marche'],
      ['montée 2 min 30', 'Attente, ligne M'],
      ['trajet 1 min 10 · trajet 1 min 10', 'Ligne M, 2 arrêts, 2 min 20'],
      ['descente 1 min 30', 'rejoint le trajet'],
    ],
    note: 'Aucun nouveau calcul : le dernier Dijkstra garde, pour chaque nœud, le nœud et l’arête d’où il a été atteint. Les rues consécutives de même nom fusionnent, comme les trajets d’une même ligne.',
  },
  compare: {
    modes: { pedestrian: 'Marche', bike: 'Vélo', car: 'Voiture', transit: 'TC' },
    note: 'Une fois le curseur arrêté : un Dijkstra par mode, dans un worker à part, arrêté dès que la destination est traitée (son temps ne peut plus baisser). Le réseau de chaque mode est préparé une fois par réglage.',
  },
  buildings: {
    building: 'bâtiment',
    street: 'sa rue la plus proche',
    caption: (street, walk) => `Rue A–B : ${street} min de bout en bout · puis ${walk} s à pied`,
    formula: {
      lines: ['t(b) = min(t_A + c_A, t_B + c_B)'],
      terms: [
        ['t_A', 'temps des extrémités A et B de la rue la plus proche du milieu du bâtiment b'],
        ['c_A', 'secondes de A jusqu’au bâtiment le long de la rue, puis à pied'],
      ],
    },
    note: 'Le rattachement est calculé une fois par profil ; à chaque mouvement la carte graphique lit les temps de A et B dans la même texture que les rues.',
  },
};

export const details = navigator.language.toLowerCase().startsWith('fr') ? fr : en;

/** The publications and specifications the model rests on */
export const REFERENCES: Record<ReferenceKey, string> = {
  tobler: 'https://escholarship.org/uc/item/05r820mz',
  parkin: 'https://doi.org/10.1016/j.tranpol.2010.03.001',
  osuna: 'https://doi.org/10.1287/trsc.6.1.52',
  ingvardson: 'https://doi.org/10.1016/j.trc.2018.03.006',
  singh: 'https://doi.org/10.1016/j.trc.2021.103267',
  gtfs: 'https://gtfs.org/documentation/schedule/reference/',
  dijkstra: 'https://doi.org/10.1007/BF01386390',
  chen: 'https://www.cs.utexas.edu/ftp/techreports/tr07-54.pdf',
  sharir: 'https://doi.org/10.1016/0898-1221(81)90008-0',
  borgefors: 'https://doi.org/10.1016/S0734-189X(86)80047-0',
  lorensen: 'https://doi.org/10.1145/37402.37422',
};
