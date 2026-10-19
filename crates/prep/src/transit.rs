//! The public transport layer of a region, from its GTFS feeds. Frequency model, as in accessibility studies: on a
//! reference weekday, for each hour of the day,
//!
//! - a ride between two consecutive stations of a line takes the median scheduled time;
//! - boarding a line at a station costs half its interval there (capped), plus a fixed transfer penalty; with no
//!   departure in that hour, the line cannot be boarded (infinite wait).
//!
//! Platforms are merged into their station (`parent_station`). Ride geometries come from the GTFS shapes; without
//! them, rail, metro and tram rides follow the BD TOPO tracks, buses go straight from stop to stop. A region's feeds
//! are merged.
//!
//! Modules: [`feeds`] (the feeds of each region), [`zone`] (the area and its projection), [`feed`] (reading a GTFS
//! zip), [`schedule`] (the trips of the day, aggregated by line segment and hour), [`tracks`] (the BD TOPO railway),
//! [`layer`] (the output tables and their binary layout).

mod feed;
mod feeds;
mod layer;
mod schedule;
mod tracks;
mod zone;

use crate::http::Http;
use crate::regions::Region;
use crate::{Res, megabytes, root, write_atomic};
use flate2::Compression;
use flate2::write::GzEncoder;
use sha1::{Digest, Sha1};
use std::fmt::Write as _;
use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;

/// Hours of the day the frequencies are computed for
pub const HOURS: usize = 24;

/// Default reference day: a Tuesday
#[allow(clippy::inconsistent_digit_grouping)] // YYYY_MM_DD
pub const DEFAULT_DATE: u32 = 2026_10_13;

/// A feed's zip in the cache, downloaded once (one file per URL: the SNCF feed serves several regions); none when
/// it cannot be had, the region goes on without it. Kept only when it opens as a zip: an error page served with a 200
/// would otherwise stay in the cache, and the feed be left out at every run.
fn download(http: &Http, feed: &feeds::Feed) -> Option<PathBuf> {
    let hash = Sha1::digest(feed.url.as_bytes());
    let name = hash.iter().take(6).fold(String::new(), |mut name, b| {
        let _ = write!(name, "{b:02x}");
        name
    });
    let zip = root().join(".cache/gtfs").join(format!("{name}.zip"));
    if zip.exists() {
        return Some(zip);
    }

    let body = http.get(feed.url).and_then(|body| {
        zip::ZipArchive::new(Cursor::new(&body))?;
        Ok(body)
    });
    match body {
        Ok(body) => {
            fs::create_dir_all(zip.parent()?).ok()?;
            write_atomic(&zip, &body).ok()?;
            eprintln!(
                "  downloaded {}, {:.0} MB",
                feed.name,
                megabytes(body.len())
            );
            Some(zip)
        }
        Err(error) => {
            eprintln!("  skipped {}: {error}", feed.name);
            None
        }
    }
}

/// Builds `<id>.transit.bin.gz` from the region's feeds, aligned on its road network (built before)
pub fn build(http: &Http, region: &Region, date: u32) -> Res<()> {
    let feeds = feeds::of(&region.id);
    if feeds.is_empty() {
        eprintln!("=== {}: no public transport feed", region.id);
        return Ok(());
    }
    let names: Vec<&str> = feeds.iter().map(|f| f.name).collect();
    eprintln!("=== {}: {}", region.id, names.join(", "));

    let zips: Vec<String> = feeds
        .iter()
        .filter_map(|f| download(http, f))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    if zips.is_empty() {
        return Err(format!("{}: no feed could be downloaded", region.id).into());
    }

    let dir = root().join("data/regions");
    let zone = zone::Zone::read(&dir.join(format!("{}.bin.gz", region.id)))?;
    let schedule = schedule::Schedule::read_all(&zips, &zone, date);
    let mut tracks = if layer::rails_without_shapes(&schedule) {
        Some(tracks::Tracks::load(http, zone.bbox())?)
    } else {
        None
    };
    let layer = layer::TransitLayer::build(&schedule, &zone, tracks.as_mut());
    if let Some(tracks) = &tracks {
        eprintln!("{}", tracks.summary());
    }
    let bytes = layer.to_bytes();

    let mut gz = GzEncoder::new(Vec::new(), Compression::best());
    gz.write_all(&bytes)?;
    fs::write(
        dir.join(format!("{}.transit.bin.gz", region.id)),
        gz.finish()?,
    )?;
    eprintln!(
        "transit layer: {}, {:.1} MB",
        layer.summary(),
        megabytes(bytes.len())
    );
    Ok(())
}
