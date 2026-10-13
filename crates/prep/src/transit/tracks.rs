//! The BD TOPO railway, to draw the rides of the feeds that come without shapes (the SNCF feed, Ilévia, TaM): the
//! tracks in service of the trains, metros and trams, from the Géoplateforme WFS, tile by tile, each page cached
//! gzipped in .cache/bdtopo-rail/ (delete it to download again). A ride follows the shortest path along the tracks
//! of its kind between its two stations when there is a plausible one, else it stays a straight line.

use crate::geometry::simplify;
use crate::http::{Http, encode};
use crate::{Res, root};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::fs::{self, File};
use std::io::{BufReader, Write};

/// Sections per page
const PAGE: usize = 5000;
/// Tile size, degrees: the railway is sparse
const TILE: f64 = 1.0;
/// How far a station can be from its tracks, metres
const SNAP: f64 = 400.0;
/// Longest path kept, relative to the straight line (plus the snapping at both ends): beyond, the search went
/// round by another branch
const DETOUR: f64 = 1.4;
/// Tolerance of the drawn paths, metres
const SIMPLIFY_METRES: f64 = 5.0;
const METRES_PER_DEGREE: f64 = 111_320.0;
/// Tracks loaded around the zone, degrees: lines leave it on their way to a station just beyond
const MARGIN: f64 = 0.3;

/// The tracks followed, by BD TOPO nature, and how much each metre of them costs: the service tracks only bridge
/// the main ones where the BD TOPO cuts them (in stations, yards)
const NATURES: [(&str, Kind, f64); 5] = [
    ("Voie ferrée principale", Kind::Train, 1.0),
    ("LGV", Kind::Train, 1.0),
    ("Voie de service", Kind::Train, 3.0),
    ("Métro", Kind::Metro, 1.0),
    ("Tramway", Kind::Tram, 1.0),
];

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Train,
    Metro,
    Tram,
}

impl Kind {
    /// The tracks of a basic GTFS route type: 0 tram, 1 metro, 2 rail; none for the others
    fn of_route(route_type: u32) -> Option<Kind> {
        match route_type {
            0 => Some(Kind::Tram),
            1 => Some(Kind::Metro),
            2 => Some(Kind::Train),
            _ => None,
        }
    }

    /// The tracks of a BD TOPO nature, and the cost of their metre
    fn of_nature(nature: &str) -> Option<(Kind, f64)> {
        NATURES
            .iter()
            .find(|(name, ..)| *name == nature)
            .map(|&(_, kind, cost)| (kind, cost))
    }
}

/// A track section, as cached: its nature and its points (lng, lat)
#[derive(Deserialize, Serialize)]
struct Section {
    nature: String,
    points: Vec<(f64, f64)>,
}

#[derive(Deserialize)]
struct Page {
    features: Vec<Feature>,
}

#[derive(Deserialize)]
struct Feature {
    geometry: Option<Geometry>,
    properties: Properties,
}

#[derive(Deserialize)]
struct Geometry {
    /// `[lng, lat]` or `[lng, lat, z]`
    coordinates: Vec<Vec<f64>>,
}

#[derive(Deserialize)]
struct Properties {
    nature: Option<String>,
}

/// A page of a tile, from the cache, else downloaded and cached
fn page(http: &Http, area: [f64; 4], start: usize) -> Res<Vec<Section>> {
    let [w, s, e, n] = area;
    let file = root()
        .join(".cache/bdtopo-rail")
        .join(format!("{w:.2}_{s:.2}-{start}.json.gz"));
    if file.exists() {
        return Ok(serde_json::from_reader(BufReader::new(GzDecoder::new(
            File::open(&file)?,
        )))?);
    }

    let natures: Vec<String> = NATURES.iter().map(|(n, ..)| format!("'{n}'")).collect();
    let params = [
        ("SERVICE", "WFS".to_string()),
        ("VERSION", "2.0.0".into()),
        ("REQUEST", "GetFeature".into()),
        ("TYPENAMES", "BDTOPO_V3:troncon_de_voie_ferree".into()),
        ("OUTPUTFORMAT", "application/json".into()),
        ("COUNT", PAGE.to_string()),
        ("STARTINDEX", start.to_string()),
        ("SORTBY", "cleabs".into()),
        ("PROPERTYNAME", "nature,geometrie".into()),
        (
            "CQL_FILTER",
            format!(
                "etat_de_l_objet = 'En service' AND nature IN ({}) AND BBOX(geometrie,{w},{s},{e},{n},'EPSG:4326')",
                natures.join(",")
            ),
        ),
    ];
    let query: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={}", encode(v)))
        .collect();
    let url = format!("https://data.geopf.fr/wfs/ows?{}", query.join("&"));
    let page: Page = serde_json::from_slice(&http.get(&url)?)?;
    let sections: Vec<Section> = page
        .features
        .into_iter()
        .filter_map(|f| {
            Some(Section {
                nature: f.properties.nature?,
                points: f
                    .geometry?
                    .coordinates
                    .iter()
                    .filter_map(|c| Some((*c.first()?, *c.get(1)?)))
                    .collect(),
            })
        })
        .collect();

    fs::create_dir_all(file.parent().ok_or("cache dir")?)?;
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    gz.write_all(&serde_json::to_vec(&sections)?)?;
    fs::write(&file, gz.finish()?)?;
    Ok(sections)
}

/// The tracks of one kind as a graph: every point of a section is a node (stations lie along the sections), sections
/// sharing an end are joined
#[derive(Default)]
struct Net {
    /// Node positions, local metres
    pos: Vec<(f64, f64)>,
    ids: HashMap<(i64, i64), u32>,
    /// Neighbours and the cost to them: metres, weighted by the nature of the track
    links: Vec<Vec<(u32, f64)>>,
    /// Nodes by cell of `SNAP` metres
    grid: HashMap<(i64, i64), Vec<u32>>,
}

fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

/// Grid cell of a position: far within i64 for metres
#[allow(clippy::cast_possible_truncation)]
fn cell((x, y): (f64, f64)) -> (i64, i64) {
    ((x / SNAP).floor() as i64, (y / SNAP).floor() as i64)
}

impl Net {
    /// The node at a point, keyed by its coordinates to 7 decimals, as the road nodes
    #[allow(clippy::cast_possible_truncation)]
    fn node(&mut self, (lng, lat): (f64, f64), at: (f64, f64)) -> u32 {
        let key = ((lng * 1e7).round() as i64, (lat * 1e7).round() as i64);
        if let Some(&id) = self.ids.get(&key) {
            return id;
        }
        let id = u32::try_from(self.pos.len()).expect("tracks: more than u32::MAX nodes");
        self.pos.push(at);
        self.links.push(Vec::new());
        self.grid.entry(cell(at)).or_default().push(id);
        self.ids.insert(key, id);
        id
    }

    /// The nearest node within `SNAP` metres
    fn snap(&self, at: (f64, f64)) -> Option<u32> {
        let (cx, cy) = cell(at);
        (cx - 1..=cx + 1)
            .flat_map(|x| (cy - 1..=cy + 1).map(move |y| (x, y)))
            .filter_map(|c| self.grid.get(&c))
            .flatten()
            .map(|&n| (n, distance(self.pos[n as usize], at)))
            .filter(|&(_, d)| d <= SNAP)
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(n, _)| n)
    }

    /// A* from `a` to `b`, given up beyond `limit` metres; the nodes of the path
    fn shortest(&self, a: u32, b: u32, limit: f64) -> Option<Vec<u32>> {
        let goal = self.pos[b as usize];
        let estimate = |n: u32| distance(self.pos[n as usize], goal);
        let mut best: HashMap<u32, f64> = HashMap::from([(a, 0.0)]);
        let mut previous: HashMap<u32, u32> = HashMap::new();
        // Non-negative floats order as their bits
        let mut queue = BinaryHeap::from([Reverse((estimate(a).to_bits(), a))]);

        while let Some(Reverse((bits, n))) = queue.pop() {
            if f64::from_bits(bits) > limit {
                return None;
            }
            if n == b {
                let mut path = vec![b];
                while let Some(&p) = previous.get(path.last()?) {
                    path.push(p);
                }
                path.reverse();
                return Some(path);
            }
            let g = best[&n];
            if f64::from_bits(bits) > g + estimate(n) + 1e-6 {
                continue;
            }
            for &(m, metres) in &self.links[n as usize] {
                let through = g + metres;
                if best.get(&m).is_none_or(|&known| through < known) {
                    best.insert(m, through);
                    previous.insert(m, n);
                    queue.push(Reverse(((through + estimate(m)).to_bits(), m)));
                }
            }
        }
        None
    }
}

/// Points (lng, lat)
type Line = Vec<(f64, f64)>;

/// The railway of a zone
pub struct Tracks {
    nets: HashMap<Kind, Net>,
    /// Metres per degree of longitude at the zone centre
    lng_metres: f64,
    /// Paths already found, from the lower node to the higher one
    paths: HashMap<(Kind, u32, u32), Option<Line>>,
    drawn: usize,
    straight: usize,
}

impl Tracks {
    /// The tracks in service in a box (min lng, min lat, max lng, max lat)
    pub fn load(http: &Http, bbox: [f64; 4]) -> Res<Self> {
        let [w, s, e, n] = [
            bbox[0] - MARGIN,
            bbox[1] - MARGIN,
            bbox[2] + MARGIN,
            bbox[3] + MARGIN,
        ];
        let mut tracks = Tracks {
            nets: HashMap::new(),
            lng_metres: METRES_PER_DEGREE * f64::midpoint(s, n).to_radians().cos(),
            paths: HashMap::new(),
            drawn: 0,
            straight: 0,
        };

        let mut sections = 0;
        let mut lng = w;
        while lng < e {
            let mut lat = s;
            while lat < n {
                let area = [lng, lat, (lng + TILE).min(e), (lat + TILE).min(n)];
                let mut start = 0;
                loop {
                    let page = page(http, area, start)?;
                    sections += page.len();
                    for section in &page {
                        tracks.add(section);
                    }
                    if page.len() < PAGE {
                        break;
                    }
                    start += PAGE;
                }
                lat += TILE;
            }
            lng += TILE;
        }

        let nodes: usize = tracks.nets.values().map(|net| net.pos.len()).sum();
        eprintln!("BD TOPO tracks: {sections} sections, {nodes} nodes");
        Ok(tracks)
    }

    fn metres(&self, (lng, lat): (f64, f64)) -> (f64, f64) {
        (lng * self.lng_metres, lat * METRES_PER_DEGREE)
    }

    fn degrees(&self, (x, y): (f64, f64)) -> (f64, f64) {
        (x / self.lng_metres, y / METRES_PER_DEGREE)
    }

    fn add(&mut self, section: &Section) {
        let Some((kind, cost)) = Kind::of_nature(&section.nature) else {
            return;
        };
        let at: Vec<(f64, f64)> = section.points.iter().map(|&p| self.metres(p)).collect();
        let net = self.nets.entry(kind).or_default();
        let nodes: Vec<u32> = section
            .points
            .iter()
            .zip(&at)
            .map(|(&p, &m)| net.node(p, m))
            .collect();
        for pair in nodes.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            if a != b {
                let metres = cost * distance(net.pos[a as usize], net.pos[b as usize]);
                net.links[a as usize].push((b, metres));
                net.links[b as usize].push((a, metres));
            }
        }
    }

    /// The ride of a line of this GTFS route type between two stations (lng, lat) along the tracks, when they lead
    /// from one to the other without a long detour
    pub fn path(
        &mut self,
        route_type: u32,
        from: (f64, f64),
        to: (f64, f64),
    ) -> Option<Vec<(f64, f64)>> {
        let kind = Kind::of_route(route_type)?;
        let (from_m, to_m) = (self.metres(from), self.metres(to));
        let found = self.nets.get(&kind).and_then(|net| {
            let (a, b) = (net.snap(from_m)?, net.snap(to_m)?);
            (a != b).then_some((a, b))
        });
        let Some((a, b)) = found else {
            self.straight += 1;
            return None;
        };

        let key = (kind, a.min(b), a.max(b));
        if !self.paths.contains_key(&key) {
            let net = &self.nets[&kind];
            let limit = DETOUR * distance(from_m, to_m) + 2.0 * SNAP;
            let path = net.shortest(key.1, key.2, limit).map(|nodes| {
                let flat: Vec<f64> = nodes
                    .iter()
                    .flat_map(|&n| {
                        let (x, y) = net.pos[n as usize];
                        [x, y]
                    })
                    .collect();
                simplify(&flat, SIMPLIFY_METRES)
                    .chunks(2)
                    .map(|c| self.degrees((c[0], c[1])))
                    .collect()
            });
            self.paths.insert(key, path);
        }

        let Some(Some(path)) = self.paths.get(&key) else {
            self.straight += 1;
            return None;
        };
        self.drawn += 1;
        // From the station to the station, along the tracks between
        let mut points = Vec::with_capacity(path.len() + 2);
        points.push(from);
        if a < b {
            points.extend(path.iter().copied());
        } else {
            points.extend(path.iter().rev().copied());
        }
        points.push(to);
        Some(points)
    }

    pub fn summary(&self) -> String {
        format!(
            "{} rides drawn along the tracks, {} left straight",
            self.drawn, self.straight
        )
    }
}
