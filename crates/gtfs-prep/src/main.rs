//! Builds the public transport layer of a region of geo-reach from a GTFS feed (Île-de-France Mobilités, a regional
//! aggregate, the SNCF trains), for the zone of the region's road network. Frequency model, as in accessibility
//! studies: on a reference weekday, for each hour of the day,
//!
//! - a ride between two consecutive stations of a line takes the median scheduled time;
//! - boarding a line at a station costs half its interval there (capped), plus a fixed transfer penalty; with no
//!   departure in that hour, the line cannot be boarded (infinite wait).
//!
//! Platforms are merged into their station (`parent_station`). Ride geometries come from the GTFS shapes, or go
//! straight from stop to stop when the feed has none. Usually run by `scripts/buildTransit.ts`.
//!
//! Usage: `cargo run -p gtfs-prep --release -- <roads.bin> <transit.bin> <feed.zip>... [--date YYYYMMDD]`; several
//! feeds are merged (scripts/buildTransit.ts lists them per region).
//!
//! Modules: [`zone`] (the area and its projection), [`feed`] (reading the GTFS zip), [`schedule`] (the trips of the
//! day, aggregated by line segment and hour), [`layer`] (the output tables and their binary layout).

mod feed;
mod layer;
mod schedule;
mod zone;

use std::error::Error;

pub type Res<T> = Result<T, Box<dyn Error>>;

/// Hours of the day the frequencies are computed for
pub const HOURS: usize = 24;

/// Default reference day: a Tuesday of the IDFM feed
#[allow(clippy::inconsistent_digit_grouping)] // YYYY_MM_DD
const DEFAULT_DATE: u32 = 2026_10_13;

/// A size for a message: precision does not matter
#[allow(clippy::cast_precision_loss)]
fn megabytes(bytes: usize) -> f64 {
    bytes as f64 / 1e6
}

fn main() -> Res<()> {
    let args: Vec<String> = std::env::args().collect();
    // `--date YYYYMMDD` anywhere; every other argument is a path
    let date_at = args.iter().position(|a| a == "--date");
    let date: u32 = match date_at {
        Some(i) => args.get(i + 1).ok_or("--date needs a YYYYMMDD value")?.parse()?,
        None => DEFAULT_DATE,
    };
    let paths: Vec<String> = args
        .iter()
        .enumerate()
        .skip(1)
        .filter(|&(i, _)| date_at.is_none_or(|d| i != d && i != d + 1))
        .map(|(_, a)| a.clone())
        .collect();
    let [graph_path, out_path, feeds @ ..] = paths.as_slice() else {
        return Err("usage: gtfs-prep <roads.bin> <transit.bin> <feed.zip>... [--date YYYYMMDD]".into());
    };
    if feeds.is_empty() {
        return Err("usage: gtfs-prep <roads.bin> <transit.bin> <feed.zip>... [--date YYYYMMDD]".into());
    }

    let zone = zone::Zone::read(graph_path)?;
    let schedule = schedule::Schedule::read_all(feeds, &zone, date);
    let layer = layer::TransitLayer::build(&schedule, &zone);
    let bytes = layer.to_bytes();
    std::fs::write(out_path, &bytes)?;
    eprintln!(
        "transit layer: {}, {:.1} MB",
        layer.summary(),
        megabytes(bytes.len())
    );
    Ok(())
}
