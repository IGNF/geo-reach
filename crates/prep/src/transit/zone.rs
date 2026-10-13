//! The zone of the road network: its origin and bounding box, read from the header of the region's road file (GRF4).

use crate::Res;
use flate2::read::GzDecoder;
use std::fs::File;
use std::io::Read;
use std::path::Path;

const R: f64 = 6_378_137.0;

pub struct Zone {
    /// Web Mercator metres of the zone centre: every output position is relative to it
    origin: (f64, f64),
    /// min lng, min lat, max lng, max lat
    bbox: (f64, f64, f64, f64),
}

impl Zone {
    /// Reads the origin and the bounding box from the header of a region's road file (gzipped, GRF4)
    pub fn read(path: &Path) -> Res<Self> {
        let mut head = [0u8; 72];
        GzDecoder::new(File::open(path)?).read_exact(&mut head)?;
        let f = |o: usize| f64::from_le_bytes(head[o..o + 8].try_into().unwrap_or_default());
        Ok(Zone {
            origin: (f(24), f(32)),
            bbox: (f(40), f(48), f(56), f(64)),
        })
    }

    /// min lng, min lat, max lng, max lat
    pub fn bbox(&self) -> [f64; 4] {
        [self.bbox.0, self.bbox.1, self.bbox.2, self.bbox.3]
    }

    pub fn contains(&self, lng: f64, lat: f64) -> bool {
        lng >= self.bbox.0 && lat >= self.bbox.1 && lng <= self.bbox.2 && lat <= self.bbox.3
    }

    /// Web Mercator metres relative to the zone origin: tens of kilometres at most, so f32 keeps centimetres
    #[allow(clippy::cast_possible_truncation)]
    pub fn project(&self, lng: f64, lat: f64) -> (f32, f32) {
        let d2r = std::f64::consts::PI / 180.0;
        let x = R * lng * d2r - self.origin.0;
        let y = R * (std::f64::consts::FRAC_PI_4 + lat * d2r / 2.0).tan().ln() - self.origin.1;
        (x as f32, y as f32)
    }
}
