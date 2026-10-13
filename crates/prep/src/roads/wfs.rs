//! The BD TOPO road sections of an area from the Géoplateforme WFS, tile by tile (short requests: deep paging over a
//! million objects is slow), each page cached gzipped in .cache/bdtopo-z/ (delete it to download again). Away from
//! the city centres the WFS leaves the paths and service roads out itself (cached apart, `-f` pages).

use crate::http::Http;
use crate::regions::{self, Box};
use crate::{Res, root};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Sections per page
pub const PAGE: usize = 5000;
/// Requests at once: the WFS of the Géoplateforme is shared
const CONCURRENCY: usize = 6;
/// Tile size, degrees
const TILE: (f64, f64) = (0.1, 0.08);
/// BD TOPO value of an unknown Z
pub const NO_Z: f64 = -1000.0;

/// What the WFS leaves out away from the city centres: what the graph would drop anyway
const OUTER_FILTER: &str =
    "nature NOT IN ('Sentier','Chemin','Escalier','Route empierrée') AND importance <> '6'";
const PROPERTIES: &str = "nature,sens_de_circulation,acces_vehicule_leger,acces_pieton,vitesse_moyenne_vl,\
nom_voie_ban_droite,nom_collaboratif_droite,importance,amenagement_cyclable_gauche,amenagement_cyclable_droit,\
sens_amenagement_cyclable_gauche,sens_amenagement_cyclable_droit,itineraire_vert,geometrie";

#[derive(Deserialize, Serialize, Default)]
#[allow(clippy::struct_field_names)]
pub struct Properties {
    pub nature: Option<String>,
    pub sens_de_circulation: Option<String>,
    pub acces_vehicule_leger: Option<String>,
    pub acces_pieton: Option<String>,
    pub vitesse_moyenne_vl: Option<f64>,
    pub nom_voie_ban_droite: Option<String>,
    pub nom_collaboratif_droite: Option<String>,
    pub importance: Option<String>,
    pub amenagement_cyclable_gauche: Option<String>,
    pub amenagement_cyclable_droit: Option<String>,
    pub sens_amenagement_cyclable_gauche: Option<String>,
    pub sens_amenagement_cyclable_droit: Option<String>,
    pub itineraire_vert: Option<bool>,
}

#[derive(Deserialize, Serialize)]
pub struct Geometry {
    /// `[lng, lat, z]`, `z` = `NO_Z` when unknown (the WFS may give `[lng, lat]` only)
    pub coordinates: Vec<Vec<f64>>,
}

/// A road section, as cached
#[derive(Deserialize, Serialize)]
pub struct Section {
    pub id: Option<String>,
    pub geometry: Option<Geometry>,
    pub properties: Properties,
}

#[derive(Deserialize)]
struct Page {
    features: Vec<Section>,
}

/// A tile of the area: its cache name and box, and whether the WFS filters it (away from the city centres)
pub struct Tile {
    id: String,
    area: Box,
    filtered: bool,
}

/// The tiles of an area, from its south-west corner (their names must not change: they key the cache)
pub fn tiles(area: &Box) -> Vec<Tile> {
    let mut tiles = Vec::new();
    let mut lng = area[0];
    while lng < area[2] {
        let mut lat = area[1];
        while lat < area[3] {
            let b = [
                lng,
                lat,
                (lng + TILE.0).min(area[2]),
                (lat + TILE.1).min(area[3]),
            ];
            let filtered = !regions::DENSE_AREAS
                .iter()
                .any(|d| regions::intersects(&b, d));
            tiles.push(Tile {
                id: format!("{lng:.2}_{lat:.2}"),
                area: b,
                filtered,
            });
            lat += TILE.1;
        }
        lng += TILE.0;
    }
    tiles
}

impl Tile {
    pub fn filtered(&self) -> bool {
        self.filtered
    }

    /// Page `start` in the cache: the whole tile when it was downloaded whole before, else its filtered pages
    fn file(&self, start: usize) -> PathBuf {
        let dir = root().join(".cache/bdtopo-z");
        let full = dir.join(format!("{}-0.json.gz", self.id));
        if self.filtered && !full.exists() {
            dir.join(format!("{}-f-{start}.json.gz", self.id))
        } else {
            dir.join(format!("{}-{start}.json.gz", self.id))
        }
    }

    fn url(&self, start: usize, filtered: bool) -> String {
        let [w, s, e, n] = self.area;
        let mut params = vec![
            ("SERVICE", "WFS".to_string()),
            ("VERSION", "2.0.0".into()),
            ("REQUEST", "GetFeature".into()),
            ("TYPENAMES", "BDTOPO_V3:troncon_de_route".into()),
            ("OUTPUTFORMAT", "application/json".into()),
            ("COUNT", PAGE.to_string()),
            ("STARTINDEX", start.to_string()),
            ("SORTBY", "cleabs".into()),
            ("PROPERTYNAME", PROPERTIES.into()),
        ];
        // The WFS takes a BBOX or a CQL filter, not both: the box goes into the filter
        if filtered {
            params.push((
                "CQL_FILTER",
                format!("{OUTER_FILTER} AND BBOX(geometrie,{w},{s},{e},{n},'EPSG:4326')"),
            ));
        } else {
            params.push((
                "BBOX",
                format!("{s},{w},{n},{e},urn:ogc:def:crs:EPSG::4326"),
            ));
        }
        let query: Vec<String> = params
            .iter()
            .map(|(k, v)| format!("{k}={}", encode(v)))
            .collect();
        format!("https://data.geopf.fr/wfs/ows?{}", query.join("&"))
    }

    /// A page, from the cache, else downloaded and cached
    pub fn page(&self, http: &Http, start: usize) -> Res<Vec<Section>> {
        let file = self.file(start);
        if file.exists() {
            return Ok(serde_json::from_reader(BufReader::new(GzDecoder::new(
                File::open(&file)?,
            )))?);
        }

        let filtered = file.to_string_lossy().contains("-f-");
        let page: Page = serde_json::from_slice(&http.get(&self.url(start, filtered))?)?;
        let sections: Vec<Section> = page
            .features
            .into_iter()
            .map(|mut s| {
                if let Some(g) = &mut s.geometry {
                    for c in &mut g.coordinates {
                        c.resize(3, NO_Z);
                    }
                }
                s
            })
            .collect();

        fs::create_dir_all(file.parent().ok_or("cache dir")?)?;
        let mut gz = GzEncoder::new(Vec::new(), Compression::default());
        gz.write_all(&serde_json::to_vec(&sections)?)?;
        fs::write(&file, gz.finish()?)?;
        Ok(sections)
    }
}

/// Percent-encoding of a query value
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Downloads every page missing from the cache, a few tiles at once
pub fn download(http: &Http, tiles: &[Tile]) -> Res<()> {
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let failure: Mutex<Option<String>> = Mutex::new(None);

    std::thread::scope(|scope| {
        for _ in 0..CONCURRENCY {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(tile) = tiles.get(i) else { break };
                    let mut start = 0;
                    loop {
                        match tile.page(http, start) {
                            Ok(page) if page.len() == PAGE => start += PAGE,
                            Ok(_) => break,
                            Err(error) => {
                                *failure
                                    .lock()
                                    .unwrap_or_else(std::sync::PoisonError::into_inner) =
                                    Some(format!("tile {}, page {start}: {error}", tile.id));
                                return;
                            }
                        }
                    }
                    let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if n.is_multiple_of(200) {
                        eprintln!("  {n} tiles of {}", tiles.len());
                    }
                }
            });
        }
    });

    match failure
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
    {
        Some(error) => Err(error.into()),
        None => Ok(()),
    }
}
