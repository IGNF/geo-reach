//! The zone of the road graph: its origin and bounding box, read from the header of graph.bin.

use crate::Res;
use std::fs::File;
use std::io::Read;

const R: f64 = 6378137.0;

pub struct Zone {
    /// Web Mercator metres of the zone centre: every output position is relative to it
    origin: (f64, f64),
    /// min lng, min lat, max lng, max lat
    bbox: (f64, f64, f64, f64),
}

impl Zone {
    /// Reads the origin and the bounding box from the header of graph.bin (see scripts/buildGraph.ts)
    pub fn read(path: &str) -> Res<Self> {
        let mut head = [0u8; 72];
        File::open(path)?.read_exact(&mut head)?;
        let f = |o: usize| f64::from_le_bytes(head[o..o + 8].try_into().unwrap());
        Ok(Zone {
            origin: (f(24), f(32)),
            bbox: (f(40), f(48), f(56), f(64)),
        })
    }

    pub fn contains(&self, lng: f64, lat: f64) -> bool {
        lng >= self.bbox.0 && lat >= self.bbox.1 && lng <= self.bbox.2 && lat <= self.bbox.3
    }

    /// Web Mercator metres relative to the zone origin
    pub fn project(&self, lng: f64, lat: f64) -> (f32, f32) {
        let d2r = std::f64::consts::PI / 180.0;
        let x = R * lng * d2r - self.origin.0;
        let y = R * (std::f64::consts::FRAC_PI_4 + lat * d2r / 2.0).tan().ln() - self.origin.1;
        (x as f32, y as f32)
    }
}
