//! Builds the public transport layer of geo-reach from a GTFS feed (Île-de-France Mobilités), for the zone of
//! graph.bin. Frequency model, as in accessibility studies: on a reference weekday, for each hour of the day,
//!
//! - a ride between two consecutive stations of a line takes the median scheduled time;
//! - boarding a line at a station costs half its interval there (capped), plus a fixed transfer penalty; with no
//!   departure in that hour, the line cannot be boarded (infinite wait).
//!
//! Platforms are merged into their station (parent_station). Ride geometries come from the GTFS shapes.
//!
//! Usage: `cargo run -p gtfs-prep --release -- <feed.zip> <graph.bin> <transit.bin> [YYYYMMDD]`
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
const DEFAULT_DATE: u32 = 20261013;

fn main() -> Res<()> {
    let args: Vec<String> = std::env::args().collect();
    let [_, feed_path, graph_path, out_path, rest @ ..] = args.as_slice() else {
        return Err("usage: gtfs-prep <feed.zip> <graph.bin> <transit.bin> [YYYYMMDD]".into());
    };
    let date: u32 = rest
        .first()
        .map(|d| d.parse())
        .transpose()?
        .unwrap_or(DEFAULT_DATE);

    let zone = zone::Zone::read(graph_path)?;
    let schedule = schedule::Schedule::read(feed_path, &zone, date)?;
    let layer = layer::TransitLayer::build(&schedule, &zone);
    let bytes = layer.to_bytes();
    std::fs::write(out_path, &bytes)?;
    eprintln!(
        "transit.bin: {}, {:.1} MB",
        layer.summary(),
        bytes.len() as f64 / 1e6
    );
    Ok(())
}
