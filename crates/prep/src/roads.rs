//! The road network of a region: its box plus a margin, for the trips that cross its edge, from the BD TOPO sections
//! of the Géoplateforme ([`wfs`]) to the routing graph ([`graph`]), written gzipped in `<id>.bin.gz`.
//!
//! The pages are downloaded a few at once, then read in the order of the tiles: the same cache always gives the
//! same file.

mod graph;
mod wfs;

use crate::http::Http;
use crate::regions::Region;
use crate::{Res, megabytes, root};
use flate2::Compression;
use flate2::write::GzEncoder;
use std::collections::HashSet;
use std::fs;
use std::io::Write;

/// Beyond the region, degrees (about 20 km): the trips crossing its edge
const MARGIN: f64 = 0.25;

pub fn build(http: &Http, region: &Region) -> Res<()> {
    let [w, s, e, n] = region.bbox;
    let area = [w - MARGIN, s - MARGIN, e + MARGIN, n + MARGIN];
    let tiles = wfs::tiles(&area);
    let filtered = tiles.iter().filter(|t| t.filtered()).count();
    eprintln!(
        "=== {}: {} tiles, {filtered} filtered by the WFS",
        region.name,
        tiles.len()
    );

    wfs::download(http, &tiles)?;

    // A section crossing tiles comes in each: kept once
    let mut seen: HashSet<String> = HashSet::new();
    let mut graph = graph::Graph::new(&area);
    for tile in &tiles {
        let mut start = 0;
        loop {
            let page = tile.page(http, start)?;
            for section in &page {
                if let Some(id) = &section.id
                    && !seen.insert(id.clone())
                {
                    continue;
                }
                graph.add(section);
            }
            if page.len() < wfs::PAGE {
                break;
            }
            start += wfs::PAGE;
        }
    }
    eprintln!(
        "Sections: {} kept, {} dropped (outside the city centres)",
        graph.kept, graph.dropped
    );

    let (bytes, summary) = graph.finish(&area);
    let mut gz = GzEncoder::new(Vec::new(), Compression::best());
    gz.write_all(&bytes)?;
    let dir = root().join("data/regions");
    fs::create_dir_all(&dir)?;
    let stored = gz.finish()?;
    fs::write(dir.join(format!("{}.bin.gz", region.id)), &stored)?;
    eprintln!(
        "{}: {summary}, {:.1} MB ({:.1} MB gzipped)",
        region.id,
        megabytes(bytes.len()),
        megabytes(stored.len())
    );
    Ok(())
}
