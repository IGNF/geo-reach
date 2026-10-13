//! Prepares the data of geo-reach, region by region, into web/public/data/regions/:
//!
//! - `prep roads <region>|all`: the BD TOPO road sections from the Géoplateforme WFS, tile by tile, into the road
//!   network of the region (`<id>.bin.gz`, GRF4);
//! - `prep transit <region>|all [--date YYYYMMDD]`: the GTFS timetables of the region, merged and summed up hour by
//!   hour, into its public transport layer (`<id>.transit.bin.gz`, TRN3), aligned on its road network.
//!
//! The regions are web/src/features/regions/regions.json, shared with the app. Downloads are cached in .cache/ (WFS
//! pages, GTFS feeds): a second run reads them back. On the IGN network, set `HTTPS_PROXY`.

mod http;
mod regions;
mod roads;
mod transit;

use std::error::Error;
use std::path::PathBuf;

pub type Res<T> = Result<T, Box<dyn Error>>;

/// The repository, where the data and the caches live
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A size for a message: precision does not matter
#[allow(clippy::cast_precision_loss)]
fn megabytes(bytes: usize) -> f64 {
    bytes as f64 / 1e6
}

const USAGE: &str =
    "usage: prep roads <region>|all  |  prep transit <region>|all [--date YYYYMMDD]";

fn main() -> Res<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [command, which, rest @ ..] = args.as_slice() else {
        return Err(USAGE.into());
    };

    let all = regions::all()?;
    let chosen: Vec<&regions::Region> = if which == "all" {
        all.iter().collect()
    } else {
        vec![
            all.iter()
                .find(|r| r.id == *which)
                .ok_or_else(|| format!("unknown region: {which}"))?,
        ]
    };

    let http = http::Http::new();
    match command.as_str() {
        "roads" => {
            for region in chosen {
                roads::build(&http, region)?;
            }
        }
        "transit" => {
            let date = match rest {
                [flag, value] if flag == "--date" => value.parse()?,
                [] => transit::DEFAULT_DATE,
                _ => return Err(USAGE.into()),
            };
            for region in chosen {
                transit::build(&http, region, date)?;
            }
        }
        _ => return Err(USAGE.into()),
    }
    Ok(())
}
