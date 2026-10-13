//! The transit layer written to the region's transit file (TRN3): stations, lines, line stops (a line at a station, with its hourly
//! wait), rides (between two line stops, with their hourly duration and geometry).
//!
//! Layout (little endian, 4-byte aligned), read by web/src/features/routing/transit.ts:
//!   u32 magic 'TRN3', stationCount, lineCount, lineStopCount, rideCount, coordCount, stringsBytes, pad
//!   stations:  f32 x, y (Mercator metres relative to the graph origin), u32 name (string index)
//!   lines:     u32 name (string index), u32 color 0xRRGGBB, u32 text color, u32 GTFS route type
//!   lineStops: u32 line, u32 station, u16 wait[24] (seconds per hour of the day, penalty included, 65535: none)
//!   rides:     u32 from lineStop, u32 to lineStop, u16 seconds[24]
//! Bus rides are straight lines between their stops (their shapes weigh a lot for little); rail keeps its shapes.
//!   rideCoordStart: u32[rideCount + 1]
//!   coords:    f32[coordCount * 2]
//!   strings:   JSON array

use crate::HOURS;
use crate::schedule::{Route, Schedule, Segment};
use crate::zone::Zone;
use std::collections::HashMap;
use std::fmt::Write;

const MAGIC: u32 = 0x334e_5254;

/// A JSON string: quotes, backslashes and control characters escaped (some feeds hold stray control characters, a
/// Windows apostrophe read as U+0092; Rust's debug escaping writes `\u{92}`, which is not JSON)
fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if u32::from(c) < 0x20 || (0x7f..0xa0).contains(&u32::from(c)) => {
                // Writing to a String cannot fail
                let _ = write!(out, "\\u{:04x}", u32::from(c));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// An index or a count of the file: the transit file stores them as u32, so beyond 4 billion items the build fails
/// rather than writing truncated values
fn u32_of(n: usize) -> u32 {
    u32::try_from(n).expect("transit file: more than u32::MAX items")
}
/// No departure in the hour
const NO_SERVICE: u16 = u16::MAX;
const GTFS_BUS: u32 = 3;
/// Longest wait counted: beyond, the line is too rare to wait for at random
const MAX_WAIT: f32 = 12.0 * 60.0;
/// Getting to the platform and boarding
const BOARD_PENALTY: f32 = 60.0;

#[derive(Default)]
pub struct TransitLayer {
    strings: Vec<String>,
    string_ids: HashMap<String, u32>,
    station_ids: HashMap<String, u32>,
    /// x, y, name
    stations: Vec<(f32, f32, u32)>,
    line_ids: HashMap<String, u32>,
    /// name, color, text color, route type
    lines: Vec<[u32; 4]>,
    line_stop_ids: HashMap<(String, String, String), u32>,
    /// line, station, hourly wait
    line_stops: Vec<(u32, u32, [f32; HOURS])>,
    /// from line stop, to line stop, hourly duration
    rides: Vec<(u32, u32, [f32; HOURS])>,
    ride_coord_start: Vec<u32>,
    coords: Vec<f32>,
}

/// Half the interval between departures, capped, plus boarding; infinite without departure in the hour
fn waits(departures: [u32; HOURS]) -> [f32; HOURS] {
    departures.map(|n| {
        if n == 0 {
            f32::INFINITY
        } else {
            // Departures in an hour: a few hundred at most, exact in f32
            #[allow(clippy::cast_precision_loss)]
            let departures = n as f32;
            (3600.0 / departures / 2.0).min(MAX_WAIT) + BOARD_PENALTY
        }
    })
}

/// Seconds: a ride lasts far less than 2^24 s, exact in f32
#[allow(clippy::cast_precision_loss)]
fn median(mut v: Vec<u32>) -> f32 {
    v.sort_unstable();
    v[v.len() / 2] as f32
}

/// Ride time per hour: the median of the hour, else the median of the day
fn hourly_durations(seg: &Segment) -> [f32; HOURS] {
    let all = median(seg.times.iter().map(|t| t.1).collect());
    let mut per_hour = [all; HOURS];
    for (h, slot) in per_hour.iter_mut().enumerate() {
        let in_hour: Vec<u32> = seg.times.iter().filter(|t| t.0 == h).map(|t| t.1).collect();
        if !in_hour.is_empty() {
            *slot = median(in_hour);
        }
    }
    per_hour
}

/// The shape between the points nearest to both platforms, else a straight line
fn ride_geometry(
    seg: &Segment,
    shapes: &HashMap<String, Vec<(f64, f64)>>,
    bus: bool,
) -> Vec<(f64, f64)> {
    let Some(shape) = shapes.get(&seg.shape).filter(|_| !bus) else {
        return vec![seg.from_pos, seg.to_pos];
    };
    let nearest = |(lng, lat): (f64, f64), from: usize| {
        (from..shape.len())
            .min_by(|&i, &j| {
                let d = |k: usize| (shape[k].0 - lng).powi(2) + (shape[k].1 - lat).powi(2);
                d(i).total_cmp(&d(j))
            })
            .unwrap_or(from)
    };
    let i = nearest(seg.from_pos, 0);
    let j = nearest(seg.to_pos, i);
    if j > i + 1 {
        shape[i..=j].to_vec()
    } else {
        vec![seg.from_pos, seg.to_pos]
    }
}

impl TransitLayer {
    pub fn build(schedule: &Schedule, zone: &Zone) -> Self {
        let mut layer = TransitLayer::default();
        // Sorted keys: the same feed always gives the same file
        let mut keys: Vec<_> = schedule.segments.keys().collect();
        keys.sort();
        for key in keys {
            let (route_id, dir, from, to) = key;
            let Some(route) = schedule.routes.get(route_id) else {
                continue;
            };
            let seg = &schedule.segments[key];
            let line = layer.line(route_id, route);
            let (sa, sb) = (
                layer.station(from, schedule, zone),
                layer.station(to, schedule, zone),
            );
            let la = layer.line_stop(route_id, dir, from, line, sa, schedule);
            let lb = layer.line_stop(route_id, dir, to, line, sb, schedule);
            layer.rides.push((la, lb, hourly_durations(seg)));
            layer.ride_coord_start.push(u32_of(layer.coords.len() / 2));
            for (lng, lat) in ride_geometry(seg, &schedule.shapes, route.kind == GTFS_BUS) {
                let (x, y) = zone.project(lng, lat);
                layer.coords.extend([x, y]);
            }
        }
        layer.ride_coord_start.push(u32_of(layer.coords.len() / 2));
        layer
    }

    fn intern(&mut self, s: &str) -> u32 {
        if let Some(&id) = self.string_ids.get(s) {
            return id;
        }
        self.strings.push(s.to_string());
        let id = u32_of(self.strings.len() - 1);
        self.string_ids.insert(s.to_string(), id);
        id
    }

    fn line(&mut self, route_id: &str, route: &Route) -> u32 {
        if let Some(&id) = self.line_ids.get(route_id) {
            return id;
        }
        let name = self.intern(&route.name);
        self.lines.push([name, route.color, route.text, route.kind]);
        let id = u32_of(self.lines.len() - 1);
        self.line_ids.insert(route_id.to_string(), id);
        id
    }

    fn station(&mut self, id: &str, schedule: &Schedule, zone: &Zone) -> u32 {
        if let Some(&s) = self.station_ids.get(id) {
            return s;
        }
        let (name, (x, y)) = match schedule.stations.get(id) {
            Some(st) => (st.name.as_str(), zone.project(st.lng, st.lat)),
            None => ("", zone.project(0.0, 0.0)),
        };
        let name_id = self.intern(name);
        self.stations.push((x, y, name_id));
        let s = u32_of(self.stations.len() - 1);
        self.station_ids.insert(id.to_string(), s);
        s
    }

    fn line_stop(
        &mut self,
        route_id: &str,
        dir: &str,
        station_id: &str,
        line: u32,
        station: u32,
        schedule: &Schedule,
    ) -> u32 {
        let key = (
            route_id.to_string(),
            dir.to_string(),
            station_id.to_string(),
        );
        if let Some(&id) = self.line_stop_ids.get(&key) {
            return id;
        }
        let departures = schedule.departures.get(&key).copied().unwrap_or([0; HOURS]);
        self.line_stops.push((line, station, waits(departures)));
        let id = u32_of(self.line_stops.len() - 1);
        self.line_stop_ids.insert(key, id);
        id
    }

    pub fn summary(&self) -> String {
        format!(
            "{} stations, {} lines, {} line stops, {} rides, {} points",
            self.stations.len(),
            self.lines.len(),
            self.line_stops.len(),
            self.rides.len(),
            self.coords.len() / 2
        )
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let strings = format!(
            "[{}]",
            self.strings
                .iter()
                .map(|s| json_string(s))
                .collect::<Vec<_>>()
                .join(",")
        );
        let mut out = Vec::new();
        let u32s = |out: &mut Vec<u8>, v: u32| out.extend(v.to_le_bytes());
        let f32s = |out: &mut Vec<u8>, v: f32| out.extend(v.to_le_bytes());
        let header = [
            MAGIC,
            u32_of(self.stations.len()),
            u32_of(self.lines.len()),
            u32_of(self.line_stops.len()),
            u32_of(self.rides.len()),
            u32_of(self.coords.len() / 2),
            u32_of(strings.len()),
            0,
        ];
        for v in header {
            u32s(&mut out, v);
        }
        for &(x, y, n) in &self.stations {
            f32s(&mut out, x);
            f32s(&mut out, y);
            u32s(&mut out, n);
        }
        for &v in self.lines.iter().flatten() {
            u32s(&mut out, v);
        }
        let u16s = |out: &mut Vec<u8>, v: f32| {
            let s = if v.is_finite() {
                // Clamped to the u16 range first, so the cast is exact
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let seconds = v.round().clamp(0.0, f32::from(NO_SERVICE - 1)) as u16;
                seconds
            } else {
                NO_SERVICE
            };
            out.extend(s.to_le_bytes());
        };
        for (l, s, w) in &self.line_stops {
            u32s(&mut out, *l);
            u32s(&mut out, *s);
            for &v in w {
                u16s(&mut out, v);
            }
        }
        for (a, b, t) in &self.rides {
            u32s(&mut out, *a);
            u32s(&mut out, *b);
            for &v in t {
                u16s(&mut out, v);
            }
        }
        for &v in &self.ride_coord_start {
            u32s(&mut out, v);
        }
        for &v in &self.coords {
            f32s(&mut out, v);
        }
        out.extend(strings.as_bytes());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_json_strings() {
        assert_eq!(json_string("Gare d\u{92}Aix"), "\"Gare d\\u0092Aix\"");
        assert_eq!(json_string("a \"b\" \\ c"), "\"a \\\"b\\\" \\\\ c\"");
        assert_eq!(json_string("Côte d’Azur"), "\"Côte d’Azur\"");
    }

    #[test]
    fn waits_half_the_interval_and_none_without_service() {
        let mut departures = [0; HOURS];
        departures[8] = 12;
        let w = waits(departures);
        assert_eq!(w[8], 150.0 + BOARD_PENALTY);
        assert!(w[3].is_infinite());
    }

    #[test]
    fn hourly_duration_falls_back_on_the_day() {
        let seg = Segment {
            times: vec![(8, 100), (8, 120), (9, 200)],
            ..Default::default()
        };
        let d = hourly_durations(&seg);
        assert_eq!((d[8], d[9], d[12]), (120.0, 200.0, 120.0));
    }
}
