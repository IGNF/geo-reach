//! Road sections to the routing graph: section ends become nodes, sections edges with their flags, speed, climb and
//! descent; then consecutive edges with the same attributes are merged, geometries simplified, and everything written
//! as compact arrays (GRF4, read by web/src/features/routing/network.ts):
//!
//! ```text
//! u32 magic 'GRF4', u32 nodeCount, u32 edgeCount, u32 pointCount, u32 namesBytes, u32 pad
//! f64 originX, originY (Web Mercator metres of the zone centre), f64 minLng, minLat, maxLng, maxLat
//! f32 nodes[nodeCount * 2]          node positions, Mercator metres relative to the origin
//! u32 edgeA[E], edgeB[E]            end nodes (geometry runs from A to B)
//! u32 edgeName[E]                   index in `names`, 0xffffffff without a name
//! u32 edgePointStart[E + 1]         first interior point of each edge in `points`
//! u16 edgeLength[E]                 ground metres
//! u16 edgeClimb[E], edgeDescent[E]  decimetres climbed and descended from A to B
//! u8  edgeCarSpeed[E]               km/h, 0 where cars cannot go
//! u8  edgeFlags[E]                  1 car A→B, 2 car B→A, 4 pedestrian, 8 stairs (slow walk),
//!                                   16 bike A→B, 32 bike B→A, 64 cycle lane or greenway, 128 path (slow ride)
//! u8  edgeImportance[E]             BD TOPO importance, 1 (major) to 6, 0 unknown
//! i16 points[pointCount * 2]        interior points: Mercator metres from the previous point (node A first)
//! utf8 names                        JSON array of street names
//! ```

use super::wfs::{NO_Z, Properties, Section};
use crate::regions::{self, Box};
use std::collections::HashMap;

const R: f64 = 6_378_137.0;
const D2R: f64 = std::f64::consts::PI / 180.0;
const MAGIC: u32 = 0x3446_5247;
const NO_NAME: u32 = 0xffff_ffff;
/// Geometries simplified to this many ground metres (Douglas-Peucker)
const SIMPLIFY_METRES: f64 = 3.0;
/// Climb or descent counted only once the terrain has moved this much from the last turning point, metres
const HYSTERESIS: f64 = 0.5;

const CAR_FWD: u8 = 1;
const CAR_BWD: u8 = 2;
const WALK: u8 = 4;
const STAIRS: u8 = 8;
const BIKE_FWD: u8 = 16;
const BIKE_BWD: u8 = 32;
const CYCLEWAY: u8 = 64;
const PATH: u8 = 128;

/// `Math.round` of JavaScript (halves up), so that the data stay those the TypeScript builder gave
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// A value of the file, clamped to its type
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn clamp_u16(x: f64) -> u16 {
    js_round(x).clamp(0.0, 65_535.0) as u16
}

#[allow(clippy::cast_possible_truncation)]
fn clamp_i16(x: f64) -> i16 {
    x.clamp(-32_768.0, 32_767.0) as i16
}

/// An index or a count of the file: u32 there
fn u32_of(n: usize) -> u32 {
    u32::try_from(n).expect("road file: more than u32::MAX items")
}

struct Edge {
    a: usize,
    b: usize,
    /// Relative Mercator metres, A to B, as x, y pairs
    pts: Vec<f64>,
    length: f64,
    /// Metres climbed and descended from A to B
    up: f64,
    down: f64,
    name: u32,
    speed: u8,
    flags: u8,
    importance: u8,
}

/// The graph being built, section after section
pub struct Graph {
    origin: (f64, f64),
    nodes: Vec<(f64, f64)>,
    node_ids: HashMap<(i64, i64), usize>,
    names: Vec<String>,
    name_ids: HashMap<String, u32>,
    edges: Vec<Edge>,
    pub kept: usize,
    pub dropped: usize,
}

/// Ground metres of a line of `[lng, lat, …]` points
fn ground_length(line: &[Vec<f64>]) -> f64 {
    line.windows(2)
        .map(|w| {
            let x = (w[1][0] - w[0][0]) * D2R * (f64::midpoint(w[1][1], w[0][1]) * D2R).cos();
            let y = (w[1][1] - w[0][1]) * D2R;
            x.hypot(y) * R
        })
        .sum()
}

/// Climb and descent along a line, from its first point, in metres; flat when a Z is unknown
fn relief(line: &[Vec<f64>]) -> (f64, f64) {
    if line.iter().any(|c| c[2].is_nan() || c[2] <= NO_Z + 1.0) {
        return (0.0, 0.0);
    }
    let (mut up, mut down, mut reference, mut trend) = (0.0, 0.0, line[0][2], 0.0_f64);
    for c in line {
        let dz = c[2] - reference;
        // Follows the current trend at once, turns only past the hysteresis
        if (trend >= 0.0 && dz > 0.0) || (trend <= 0.0 && dz < 0.0) || dz.abs() >= HYSTERESIS {
            if dz > 0.0 {
                up += dz;
            } else {
                down -= dz;
            }
            if dz != 0.0 {
                trend = dz.signum();
            }
            reference = c[2];
        }
    }
    (up, down)
}

impl Graph {
    /// The zone's origin is the centre of its box
    pub fn new(area: &Box) -> Self {
        let lng = f64::midpoint(area[0], area[2]);
        let lat = f64::midpoint(area[1], area[3]);
        Graph {
            origin: (
                R * lng * D2R,
                R * (std::f64::consts::FRAC_PI_4 + lat * D2R / 2.0).tan().ln(),
            ),
            nodes: Vec::new(),
            node_ids: HashMap::new(),
            names: Vec::new(),
            name_ids: HashMap::new(),
            edges: Vec::new(),
            kept: 0,
            dropped: 0,
        }
    }

    /// Web Mercator metres relative to the zone origin
    fn project(&self, lng: f64, lat: f64) -> (f64, f64) {
        (
            R * lng * D2R - self.origin.0,
            R * (std::f64::consts::FRAC_PI_4 + lat * D2R / 2.0).tan().ln() - self.origin.1,
        )
    }

    /// The node at a point, created at its first use (points equal to 1e-7 degree are one node)
    #[allow(clippy::cast_possible_truncation)]
    fn node(&mut self, c: &[f64]) -> usize {
        let key = ((c[0] * 1e7).round() as i64, (c[1] * 1e7).round() as i64);
        if let Some(&id) = self.node_ids.get(&key) {
            return id;
        }
        let id = self.nodes.len();
        let xy = self.project(c[0], c[1]);
        self.nodes.push(xy);
        self.node_ids.insert(key, id);
        id
    }

    fn name(&mut self, name: Option<&str>) -> u32 {
        let Some(name) = name.filter(|n| !n.is_empty()) else {
            return NO_NAME;
        };
        if let Some(&id) = self.name_ids.get(name) {
            return id;
        }
        let id = u32_of(self.names.len());
        self.names.push(name.to_string());
        self.name_ids.insert(name.to_string(), id);
        id
    }

    /// A road section becomes an edge, unless away from the city centres it is a path or a service road, or no
    /// mode can use it
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    pub fn add(&mut self, section: &Section) {
        let Some(line) = section.geometry.as_ref().map(|g| &g.coordinates) else {
            return;
        };
        if line.len() < 2 {
            return;
        }
        let props = &section.properties;
        let nature = props.nature.as_deref().unwrap_or("");
        let importance: u8 = props
            .importance
            .as_deref()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let (first, last) = (&line[0], &line[line.len() - 1]);
        let dense = |c: &Vec<f64>| {
            regions::DENSE_AREAS
                .iter()
                .any(|b| regions::inside(b, c[0], c[1]))
        };
        let outer_dropped = matches!(
            nature,
            "Sentier" | "Chemin" | "Escalier" | "Route empierrée"
        );
        if !(dense(first) || dense(last)) && (outer_dropped || importance >= 6) {
            self.dropped += 1;
            return;
        }

        let (flags, speed) = access(props, nature);
        if flags & (CAR_FWD | CAR_BWD | WALK | BIKE_FWD | BIKE_BWD) == 0 {
            return;
        }

        self.kept += 1;
        let (node_a, node_b) = (self.node(first), self.node(last));
        let pts = line
            .iter()
            .flat_map(|c| {
                let (x, y) = self.project(c[0], c[1]);
                [x, y]
            })
            .collect();
        let (up, down) = relief(line);
        let street = props
            .nom_voie_ban_droite
            .as_deref()
            .filter(|s| !s.is_empty())
            .or(props.nom_collaboratif_droite.as_deref());
        let name = self.name(street);
        self.edges.push(Edge {
            a: node_a,
            b: node_b,
            pts,
            length: ground_length(line),
            up,
            down,
            name,
            speed,
            flags,
            importance,
        });
    }

    /// Merges, simplifies and writes the graph (GRF4, uncompressed), with its counts for the log
    pub fn finish(self, area: &Box) -> (Vec<u8>, String) {
        let merged = merge(&self.edges, self.nodes.len());
        let summary_merge = format!("{} sections → {} edges", self.edges.len(), merged.len());
        let bytes = encode(&self.nodes, &merged, &self.names, self.origin, area);
        (bytes.0, format!("{summary_merge}; {}", bytes.1))
    }
}

/// Who can use a section and how fast: its flags (car, foot and bike each way, stairs, cycle lane, path) and its car
/// speed (0 where cars cannot go)
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn access(props: &Properties, nature: &str) -> (u8, u8) {
    let sens = props.sens_de_circulation.as_deref();
    let pedestrian = !matches!(nature, "Type autoroutier" | "Bretelle")
        && props.acces_pieton.as_deref() != Some("Interdit");
    let speed = js_round(props.vitesse_moyenne_vl.unwrap_or(0.0)).clamp(0.0, 255.0) as u8;
    let car = matches!(
        props.acces_vehicule_leger.as_deref(),
        Some("Libre" | "A péage")
    ) && speed > 0;
    let forward = car && sens != Some("Sens inverse");
    let backward = car && sens != Some("Sens direct");
    // Bikes: no motorway nor stairs; one-way streets apply, unless a cycle lane runs that way (contraflow lanes)
    let bike =
        !matches!(nature, "Type autoroutier" | "Bretelle" | "Escalier") && (pedestrian || car);
    let lanes = [
        props.sens_amenagement_cyclable_gauche.as_deref(),
        props.sens_amenagement_cyclable_droit.as_deref(),
    ];
    let one_way = car && matches!(sens, Some("Sens direct" | "Sens inverse"));
    let has_lane = |way: &str| {
        lanes
            .iter()
            .any(|v| *v == Some(way) || *v == Some("Double sens"))
    };
    let bike_forward = bike && (!one_way || forward || has_lane("Sens direct"));
    let bike_backward = bike && (!one_way || backward || has_lane("Sens inverse"));
    let filled = |v: &Option<String>| v.as_deref().is_some_and(|s| !s.is_empty());
    let cycleway = filled(&props.amenagement_cyclable_gauche)
        || filled(&props.amenagement_cyclable_droit)
        || props.itineraire_vert == Some(true);
    let path = matches!(nature, "Sentier" | "Chemin" | "Route empierrée");

    let mut flags = 0;
    for (on, flag) in [
        (forward, CAR_FWD),
        (backward, CAR_BWD),
        (pedestrian, WALK),
        (nature == "Escalier", STAIRS),
        (bike_forward, BIKE_FWD),
        (bike_backward, BIKE_BWD),
        (cycleway, CYCLEWAY),
        (path && !cycleway, PATH),
    ] {
        if on {
            flags |= flag;
        }
    }

    (flags, if car { speed } else { 0 })
}

/// Flags as seen when the edge is walked from B to A
fn reversed_flags(f: u8) -> u8 {
    let swap = |on: bool, flag: u8| if on { flag } else { 0 };
    (f & !(CAR_FWD | CAR_BWD | BIKE_FWD | BIKE_BWD))
        | swap(f & CAR_FWD != 0, CAR_BWD)
        | swap(f & CAR_BWD != 0, CAR_FWD)
        | swap(f & BIKE_FWD != 0, BIKE_BWD)
        | swap(f & BIKE_BWD != 0, BIKE_FWD)
}

/// An edge walked from one of its ends
#[derive(Clone, Copy)]
struct Link {
    i: usize,
    from: usize,
    to: usize,
    flags: u8,
    reversed: bool,
}

/// A node shared by exactly two edges with the same attributes disappears: their chain becomes one edge
fn merge(edges: &[Edge], node_count: usize) -> Vec<Edge> {
    let mut incident: Vec<Vec<usize>> = vec![Vec::new(); node_count];
    for (i, e) in edges.iter().enumerate() {
        incident[e.a].push(i);
        if e.b != e.a {
            incident[e.b].push(i);
        }
    }

    let walk = |i: usize, from: usize| -> Link {
        let e = &edges[i];
        let reversed = e.a != from;
        Link {
            i,
            from,
            to: if reversed { e.a } else { e.b },
            flags: if reversed {
                reversed_flags(e.flags)
            } else {
                e.flags
            },
            reversed,
        }
    };
    let same_kind = |x: &Link, y: &Link| {
        let (a, b) = (&edges[x.i], &edges[y.i]);
        x.flags == y.flags && a.speed == b.speed && a.importance == b.importance && a.name == b.name
    };
    // The other edge at a node of degree 2 (not a loop), if any
    let other_edge = |node: usize, i: usize| -> Option<usize> {
        let list = &incident[node];
        if list.len() != 2 {
            return None;
        }
        let j = if list[0] == i { list[1] } else { list[0] };
        (j != i && edges[j].a != edges[j].b).then_some(j)
    };
    // The link that continues `link` through its end node, when that node can go
    let after = |link: &Link| -> Option<Link> {
        let next = walk(other_edge(link.to, link.i)?, link.to);
        same_kind(link, &next).then_some(next)
    };
    // The link that leads into `link` through its start node, when that node can go
    let before = |link: &Link| -> Option<Link> {
        let j = other_edge(link.from, link.i)?;
        let e = &edges[j];
        let prev = walk(j, if e.a == link.from { e.b } else { e.a });
        same_kind(&prev, link).then_some(prev)
    };

    let mut used = vec![false; edges.len()];
    let mut merged = Vec::new();
    for i in 0..edges.len() {
        if used[i] {
            continue;
        }
        let e = &edges[i];
        if e.a == e.b {
            used[i] = true;
            merged.push(Edge {
                pts: e.pts.clone(),
                ..copy(e)
            });
            continue;
        }

        // Back to the start of the chain (a closed ring stops where it began)
        let mut first = walk(i, e.a);
        while let Some(prev) = before(&first) {
            if used[prev.i] || prev.i == i {
                break;
            }
            first = prev;
        }
        let mut chain = vec![first];
        used[first.i] = true;
        let mut cursor = first;
        while let Some(next) = after(&cursor) {
            if used[next.i] {
                break;
            }
            chain.push(next);
            used[next.i] = true;
            cursor = next;
        }

        merged.push(join(&chain, edges));
    }
    merged
}

/// One edge from a chain of links: its points end to end, its lengths, climb and descent summed
fn join(chain: &[Link], edges: &[Edge]) -> Edge {
    let mut pts: Vec<f64> = Vec::new();
    let (mut length, mut up, mut down) = (0.0, 0.0, 0.0);
    for link in chain {
        let e = &edges[link.i];
        let p: Vec<f64> = if link.reversed {
            e.pts.chunks(2).rev().flatten().copied().collect()
        } else {
            e.pts.clone()
        };
        pts.extend_from_slice(if pts.is_empty() { &p } else { &p[2..] });
        length += e.length;
        up += if link.reversed { e.down } else { e.up };
        down += if link.reversed { e.up } else { e.down };
    }
    let first = chain[0];
    let head = &edges[first.i];
    Edge {
        a: first.from,
        b: chain[chain.len() - 1].to,
        pts,
        length,
        up,
        down,
        name: head.name,
        speed: head.speed,
        flags: first.flags,
        importance: head.importance,
    }
}

/// The scalar attributes of an edge (its points are copied apart)
fn copy(e: &Edge) -> Edge {
    Edge {
        a: e.a,
        b: e.b,
        pts: Vec::new(),
        length: e.length,
        up: e.up,
        down: e.down,
        name: e.name,
        speed: e.speed,
        flags: e.flags,
        importance: e.importance,
    }
}

/// Douglas-Peucker on a flat list of points, keeps the ends
fn simplify(p: &[f64], tolerance: f64) -> Vec<f64> {
    let n = p.len() / 2;
    if n <= 2 {
        return p.to_vec();
    }
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;
    let mut stack = vec![(0, n - 1)];
    while let Some((s, e)) = stack.pop() {
        let (x0, y0, x1, y1) = (p[s * 2], p[s * 2 + 1], p[e * 2], p[e * 2 + 1]);
        let len = (x1 - x0).hypot(y1 - y0);
        let len = if len == 0.0 { 1.0 } else { len };
        let (mut best, mut best_d) = (0, tolerance);
        for k in s + 1..e {
            let d = ((x1 - x0) * (y0 - p[k * 2 + 1]) - (x0 - p[k * 2]) * (y1 - y0)).abs() / len;
            if d > best_d {
                best = k;
                best_d = d;
            }
        }
        if best > 0 {
            keep[best] = true;
            stack.push((s, best));
            stack.push((best, e));
        }
    }
    p.chunks(2)
        .zip(&keep)
        .filter(|(_, k)| **k)
        .flat_map(|(c, _)| c.iter().copied())
        .collect()
}

/// The file: only the nodes still used, renumbered in edge order; interior points as 16-bit deltas
#[allow(clippy::cast_possible_truncation)]
fn encode(
    nodes: &[(f64, f64)],
    edges: &[Edge],
    names: &[String],
    origin: (f64, f64),
    area: &Box,
) -> (Vec<u8>, String) {
    let tolerance = SIMPLIFY_METRES / (f64::midpoint(area[1], area[3]) * D2R).cos();
    let mut index = vec![u32::MAX; nodes.len()];
    let mut kept: Vec<(f64, f64)> = Vec::new();
    let mut node_index = |n: usize| -> u32 {
        if index[n] == u32::MAX {
            index[n] = u32_of(kept.len());
            kept.push(nodes[n]);
        }
        index[n]
    };

    let count = edges.len();
    let (mut edge_a, mut edge_b, mut edge_name, mut point_start) = (
        Vec::with_capacity(count),
        Vec::with_capacity(count),
        Vec::with_capacity(count),
        Vec::with_capacity(count + 1),
    );
    let (mut length, mut climb, mut descent) = (
        Vec::with_capacity(count),
        Vec::with_capacity(count),
        Vec::with_capacity(count),
    );
    let mut points: Vec<i16> = Vec::new();
    for e in edges {
        edge_a.push(node_index(e.a));
        edge_b.push(node_index(e.b));
        edge_name.push(e.name);
        length.push(clamp_u16(e.length));
        climb.push(clamp_u16(e.up * 10.0));
        descent.push(clamp_u16(e.down * 10.0));
        point_start.push(u32_of(points.len() / 2));
        let shape = simplify(&e.pts, tolerance);
        // Interior points, each from the previous one in whole metres (rounded positions: no drift)
        let (mut px, mut py) = (js_round(shape[0]), js_round(shape[1]));
        for k in (2..shape.len().saturating_sub(2)).step_by(2) {
            let (x, y) = (js_round(shape[k]), js_round(shape[k + 1]));
            points.push(clamp_i16(x - px));
            points.push(clamp_i16(y - py));
            (px, py) = (x, y);
        }
    }
    point_start.push(u32_of(points.len() / 2));

    let names_json = serde_json::to_vec(names).unwrap_or_else(|_| b"[]".to_vec());
    let mut out = Vec::new();
    let u32s = |out: &mut Vec<u8>, v: &[u32]| v.iter().for_each(|x| out.extend(x.to_le_bytes()));
    let align = |out: &mut Vec<u8>| out.resize(out.len().div_ceil(4) * 4, 0);
    u32s(
        &mut out,
        &[
            MAGIC,
            u32_of(kept.len()),
            u32_of(count),
            u32_of(points.len() / 2),
            u32_of(names_json.len()),
            0,
        ],
    );
    for v in [origin.0, origin.1, area[0], area[1], area[2], area[3]] {
        out.extend(v.to_le_bytes());
    }
    for (x, y) in &kept {
        out.extend((*x as f32).to_le_bytes());
        out.extend((*y as f32).to_le_bytes());
    }
    u32s(&mut out, &edge_a);
    u32s(&mut out, &edge_b);
    u32s(&mut out, &edge_name);
    u32s(&mut out, &point_start);
    for column in [&length, &climb, &descent] {
        for v in column {
            out.extend(v.to_le_bytes());
        }
    }
    out.extend(edges.iter().map(|e| e.speed));
    out.extend(edges.iter().map(|e| e.flags));
    out.extend(edges.iter().map(|e| e.importance));
    align(&mut out);
    for v in &points {
        out.extend(v.to_le_bytes());
    }
    align(&mut out);
    out.extend(&names_json);

    let summary = format!(
        "{} nodes, {count} edges, {} interior points, {} names",
        kept.len(),
        points.len() / 2,
        names.len()
    );
    (out, summary)
}
