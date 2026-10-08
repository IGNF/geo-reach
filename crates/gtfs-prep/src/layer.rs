//! The transit layer written to transit.bin: stations, lines, line stops (a line at a station, with its hourly
//! wait), rides (between two line stops, with their hourly duration and geometry).
//!
//! Layout (little endian, 4-byte aligned), read by web/src/engine/transit.ts:
//!   u32 magic 'TRN2', stationCount, lineCount, lineStopCount, rideCount, coordCount, stringsBytes, pad
//!   stations:  f32 x, y (Mercator metres relative to the graph origin), u32 name (string index)
//!   lines:     u32 name (string index), u32 color 0xRRGGBB, u32 text color, u32 GTFS route type
//!   lineStops: u32 line, u32 station, f32 wait[24] (seconds per hour of the day, penalty included)
//!   rides:     u32 from lineStop, u32 to lineStop, f32 seconds[24]
//!   rideCoordStart: u32[rideCount + 1]
//!   coords:    f32[coordCount * 2]
//!   strings:   JSON array

use crate::HOURS;
use crate::schedule::{Route, Schedule, Segment};
use crate::zone::Zone;
use std::collections::HashMap;

const MAGIC: u32 = 0x324e5254;
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
            (3600.0 / n as f32 / 2.0).min(MAX_WAIT) + BOARD_PENALTY
        }
    })
}

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
fn ride_geometry(seg: &Segment, shapes: &HashMap<String, Vec<(f64, f64)>>) -> Vec<(f64, f64)> {
    let Some(shape) = shapes.get(&seg.shape) else {
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
            layer.ride_coord_start.push((layer.coords.len() / 2) as u32);
            for (lng, lat) in ride_geometry(seg, &schedule.shapes) {
                let (x, y) = zone.project(lng, lat);
                layer.coords.extend([x, y]);
            }
        }
        layer.ride_coord_start.push((layer.coords.len() / 2) as u32);
        layer
    }

    fn intern(&mut self, s: &str) -> u32 {
        if let Some(&id) = self.string_ids.get(s) {
            return id;
        }
        self.strings.push(s.to_string());
        let id = (self.strings.len() - 1) as u32;
        self.string_ids.insert(s.to_string(), id);
        id
    }

    fn line(&mut self, route_id: &str, route: &Route) -> u32 {
        if let Some(&id) = self.line_ids.get(route_id) {
            return id;
        }
        let name = self.intern(&route.name);
        self.lines.push([name, route.color, route.text, route.kind]);
        let id = (self.lines.len() - 1) as u32;
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
        let s = (self.stations.len() - 1) as u32;
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
        let id = (self.line_stops.len() - 1) as u32;
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
                .map(|s| format!("{s:?}"))
                .collect::<Vec<_>>()
                .join(",")
        );
        let mut out = Vec::new();
        let u32s = |out: &mut Vec<u8>, v: u32| out.extend(v.to_le_bytes());
        let f32s = |out: &mut Vec<u8>, v: f32| out.extend(v.to_le_bytes());
        let header = [
            MAGIC,
            self.stations.len() as u32,
            self.lines.len() as u32,
            self.line_stops.len() as u32,
            self.rides.len() as u32,
            (self.coords.len() / 2) as u32,
            strings.len() as u32,
            0,
        ];
        header.iter().for_each(|&v| u32s(&mut out, v));
        for &(x, y, n) in &self.stations {
            f32s(&mut out, x);
            f32s(&mut out, y);
            u32s(&mut out, n);
        }
        self.lines.iter().flatten().for_each(|&v| u32s(&mut out, v));
        for (l, s, w) in &self.line_stops {
            u32s(&mut out, *l);
            u32s(&mut out, *s);
            w.iter().for_each(|&v| f32s(&mut out, v));
        }
        for (a, b, t) in &self.rides {
            u32s(&mut out, *a);
            u32s(&mut out, *b);
            t.iter().for_each(|&v| f32s(&mut out, v));
        }
        self.ride_coord_start
            .iter()
            .for_each(|&v| u32s(&mut out, v));
        self.coords.iter().for_each(|&v| f32s(&mut out, v));
        out.extend(strings.as_bytes());
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
