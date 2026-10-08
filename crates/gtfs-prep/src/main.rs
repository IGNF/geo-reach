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
//! Output layout (little endian, 4-byte aligned), read by web/src/engine/transit.ts:
//!   u32 magic 'TRN2', stationCount, lineCount, lineStopCount, rideCount, coordCount, stringsBytes, pad
//!   stations:  f32 x, y (Mercator metres relative to the graph origin), u32 name (string index)
//!   lines:     u32 name (string index), u32 color 0xRRGGBB, u32 text color, u32 GTFS route type
//!   lineStops: u32 line, u32 station, f32 wait[24] (seconds per hour of the day, penalty included)
//!   rides:     u32 from lineStop, u32 to lineStop, f32 seconds[24]
//!   rideCoordStart: u32[rideCount + 1]
//!   coords:    f32[coordCount * 2]
//!   strings:   JSON array

use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fs::File;
use std::io::{BufReader, Read};

type Res<T> = Result<T, Box<dyn Error>>;

const HOURS: usize = 24;
const MAX_WAIT: f32 = 12.0 * 60.0;
const BOARD_PENALTY: f32 = 60.0;
const R: f64 = 6378137.0;

struct Zone {
    origin: (f64, f64),
    bbox: (f64, f64, f64, f64),
}

impl Zone {
    fn read(path: &str) -> Res<Self> {
        let mut head = [0u8; 72];
        File::open(path)?.read_exact(&mut head)?;
        let f = |o: usize| f64::from_le_bytes(head[o..o + 8].try_into().unwrap());
        Ok(Zone { origin: (f(24), f(32)), bbox: (f(40), f(48), f(56), f(64)) })
    }

    fn contains(&self, lng: f64, lat: f64) -> bool {
        lng >= self.bbox.0 && lat >= self.bbox.1 && lng <= self.bbox.2 && lat <= self.bbox.3
    }

    fn project(&self, lng: f64, lat: f64) -> (f32, f32) {
        let d2r = std::f64::consts::PI / 180.0;
        let x = R * lng * d2r - self.origin.0;
        let y = R * (std::f64::consts::FRAC_PI_4 + lat * d2r / 2.0).tan().ln() - self.origin.1;
        (x as f32, y as f32)
    }
}

/// A row of a feed file, read by column name
struct Row<'a> {
    index: &'a HashMap<String, usize>,
    record: &'a csv::StringRecord,
}

impl Row<'_> {
    fn get(&self, col: &str) -> &str {
        self.index.get(col).and_then(|&i| self.record.get(i)).unwrap_or("")
    }
}

/// Every row of one file of the feed
fn read_csv(zip: &mut zip::ZipArchive<BufReader<File>>, name: &str, mut row: impl FnMut(&Row)) -> Res<()> {
    let file = zip.by_name(name)?;
    let mut reader = csv::ReaderBuilder::new().flexible(true).from_reader(BufReader::with_capacity(1 << 20, file));
    let index: HashMap<String, usize> =
        reader.headers()?.iter().enumerate().map(|(i, h)| (h.trim_start_matches('\u{feff}').to_string(), i)).collect();
    let mut record = csv::StringRecord::new();
    while reader.read_record(&mut record)? {
        row(&Row { index: &index, record: &record });
    }
    Ok(())
}

fn seconds(hms: &str) -> Option<u32> {
    let mut it = hms.split(':').map(|p| p.parse::<u32>().ok());
    Some(it.next()?? * 3600 + it.next()?? * 60 + it.next()??)
}

/// Day of the week of a YYYYMMDD date, 0 = Monday (Zeller)
fn weekday(date: u32) -> usize {
    let (mut y, mut m, d) = ((date / 10000) as i32, ((date / 100) % 100) as i32, (date % 100) as i32);
    if m < 3 {
        m += 12;
        y -= 1;
    }
    let h = (d + 13 * (m + 1) / 5 + y + y / 4 - y / 100 + y / 400) % 7;
    ((h + 5) % 7) as usize
}

fn hex(c: &str, default: u32) -> u32 {
    u32::from_str_radix(c.trim_start_matches('#'), 16).unwrap_or(default)
}

#[derive(Default)]
struct Segment {
    /// (hour of departure, seconds)
    times: Vec<(usize, u32)>,
    /// A trip whose shape draws the segment, and the platforms it uses
    shape: String,
    from_pos: (f64, f64),
    to_pos: (f64, f64),
}

fn main() -> Res<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        return Err("usage: gtfs-prep <feed.zip> <graph.bin> <transit.bin> [YYYYMMDD]".into());
    }
    let zone = Zone::read(&args[2])?;
    let date: u32 = args.get(4).map(|d| d.parse()).transpose()?.unwrap_or(20261013);
    let day = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][weekday(date)];
    eprintln!("Reference day {date} ({day}), hour by hour");
    let mut zip = zip::ZipArchive::new(BufReader::new(File::open(&args[1])?))?;

    // Stops: platforms of the zone, attached to their station
    struct Stop {
        station: String,
        lng: f64,
        lat: f64,
    }
    let mut stops: HashMap<String, Stop> = HashMap::new();
    let mut station_info: HashMap<String, (String, f64, f64)> = HashMap::new();
    read_csv(&mut zip, "stops.txt", |r| {
        let (lng, lat) = (r.get("stop_lon").parse().unwrap_or(0.0), r.get("stop_lat").parse().unwrap_or(0.0));
        if r.get("location_type") == "1" {
            station_info.insert(r.get("stop_id").into(), (r.get("stop_name").into(), lng, lat));
        } else if (r.get("location_type").is_empty() || r.get("location_type") == "0") && zone.contains(lng, lat) {
            let parent = r.get("parent_station");
            let station = if parent.is_empty() { r.get("stop_id") } else { parent };
            stops.insert(r.get("stop_id").into(), Stop { station: station.into(), lng, lat });
            station_info.entry(station.into()).or_insert_with(|| (r.get("stop_name").into(), lng, lat));
        }
    })?;
    eprintln!("{} platforms in the zone", stops.len());

    let mut services: HashSet<String> = HashSet::new();
    read_csv(&mut zip, "calendar.txt", |r| {
        let (start, end) = (r.get("start_date").parse().unwrap_or(0), r.get("end_date").parse().unwrap_or(0));
        if r.get(day) == "1" && start <= date && date <= end {
            services.insert(r.get("service_id").into());
        }
    })?;
    read_csv(&mut zip, "calendar_dates.txt", |r| {
        if r.get("date").parse::<u32>().ok() == Some(date) {
            match r.get("exception_type") {
                "1" => services.insert(r.get("service_id").into()),
                "2" => services.remove(r.get("service_id")),
                _ => false,
            };
        }
    })?;

    struct Route {
        name: String,
        color: u32,
        text: u32,
        kind: u32,
    }
    let mut routes: HashMap<String, Route> = HashMap::new();
    read_csv(&mut zip, "routes.txt", |r| {
        routes.insert(
            r.get("route_id").into(),
            Route {
                name: r.get("route_short_name").into(),
                color: hex(r.get("route_color"), 0x666666),
                text: hex(r.get("route_text_color"), 0xffffff),
                kind: r.get("route_type").parse().unwrap_or(3),
            },
        );
    })?;

    // Trips running on the reference day: route, direction, shape
    let mut trips: HashMap<String, (String, String, String)> = HashMap::new();
    read_csv(&mut zip, "trips.txt", |r| {
        if services.contains(r.get("service_id")) {
            trips.insert(r.get("trip_id").into(), (r.get("route_id").into(), r.get("direction_id").into(), r.get("shape_id").into()));
        }
    })?;
    eprintln!("{} services, {} trips on the day", services.len(), trips.len());

    // Stop times: consecutive pairs of the zone, leaving within the window
    let mut segments: HashMap<(String, String, String, String), Segment> = HashMap::new();
    let mut departures: HashMap<(String, String, String), [u32; HOURS]> = HashMap::new();
    let mut previous: Option<(String, u32, String, u32, (f64, f64))> = None;
    let mut rows = 0u64;
    read_csv(&mut zip, "stop_times.txt", |r| {
        rows += 1;
        let trip = r.get("trip_id");
        let Some(trip_info) = trips.get(trip) else {
            previous = None;
            return;
        };
        let seq: u32 = r.get("stop_sequence").parse().unwrap_or(0);
        let Some(stop) = stops.get(r.get("stop_id")) else {
            previous = None;
            return;
        };
        let (arr, dep) = (seconds(r.get("arrival_time")).unwrap_or(0), seconds(r.get("departure_time")).unwrap_or(0));
        if let Some((ptrip, pseq, pstation, pdep, ppos)) = &previous
            && ptrip == trip
            && *pseq + 1 == seq
            && *pstation != stop.station
        {
            // GTFS times run past 24:00 for the night of the service day
            let hour = (*pdep / 3600) as usize % HOURS;
            let (route, dir, shape) = trip_info;
            departures.entry((route.clone(), dir.clone(), pstation.clone())).or_insert([0; HOURS])[hour] += 1;
            let seg = segments.entry((route.clone(), dir.clone(), pstation.clone(), stop.station.clone())).or_default();
            seg.times.push((hour, arr.saturating_sub(*pdep).max(30)));
            if seg.shape.is_empty() {
                seg.shape = shape.clone();
                seg.from_pos = *ppos;
                seg.to_pos = (stop.lng, stop.lat);
            }
        }
        previous = Some((trip.into(), seq, stop.station.clone(), dep, (stop.lng, stop.lat)));
    })?;
    eprintln!("{rows} stop times read, {} line segments in the zone", segments.len());

    // Shapes of the kept segments
    let wanted: HashSet<&str> = segments.values().map(|s| s.shape.as_str()).filter(|s| !s.is_empty()).collect();
    let mut shapes: HashMap<String, Vec<(u32, f64, f64)>> = HashMap::new();
    read_csv(&mut zip, "shapes.txt", |r| {
        if wanted.contains(r.get("shape_id")) {
            shapes.entry(r.get("shape_id").into()).or_default().push((
                r.get("shape_pt_sequence").parse().unwrap_or(0),
                r.get("shape_pt_lon").parse().unwrap_or(0.0),
                r.get("shape_pt_lat").parse().unwrap_or(0.0),
            ));
        }
    })?;
    for pts in shapes.values_mut() {
        pts.sort_by_key(|p| p.0);
    }

    // Output tables
    let mut strings: Vec<String> = Vec::new();
    let mut string_ids: HashMap<String, u32> = HashMap::new();
    let mut intern = |s: &str| -> u32 {
        *string_ids.entry(s.to_string()).or_insert_with(|| {
            strings.push(s.to_string());
            (strings.len() - 1) as u32
        })
    };
    let mut station_ids: HashMap<String, u32> = HashMap::new();
    let mut stations: Vec<(f32, f32, u32)> = Vec::new();
    let mut line_ids: HashMap<String, u32> = HashMap::new();
    let mut lines: Vec<[u32; 4]> = Vec::new();
    let mut line_stop_ids: HashMap<(String, String, String), u32> = HashMap::new();
    let mut line_stops: Vec<(u32, u32, [f32; HOURS])> = Vec::new();
    let mut rides: Vec<(u32, u32, [f32; HOURS])> = Vec::new();
    let mut ride_coord_start: Vec<u32> = Vec::new();
    let mut coords: Vec<f32> = Vec::new();

    let mut keys: Vec<_> = segments.keys().cloned().collect();
    keys.sort();
    for key in keys {
        let seg = &segments[&key];
        let (route_id, dir, from, to) = &key;
        let Some(route) = routes.get(route_id) else { continue };
        let line = *line_ids.entry(route_id.clone()).or_insert_with(|| {
            lines.push([intern(&route.name), route.color, route.text, route.kind]);
            (lines.len() - 1) as u32
        });
        let mut station = |id: &String| -> u32 {
            *station_ids.entry(id.clone()).or_insert_with(|| {
                let (name, lng, lat) = station_info.get(id).cloned().unwrap_or_default();
                let (x, y) = zone.project(lng, lat);
                stations.push((x, y, intern(&name)));
                (stations.len() - 1) as u32
            })
        };
        let (sa, sb) = (station(from), station(to));
        let mut line_stop = |st: &String, sid: u32| -> u32 {
            *line_stop_ids.entry((route_id.clone(), dir.clone(), st.clone())).or_insert_with(|| {
                let counts = departures.get(&(route_id.clone(), dir.clone(), st.clone())).copied().unwrap_or([0; HOURS]);
                let wait = counts.map(|n| {
                    if n == 0 { f32::INFINITY } else { (3600.0 / n as f32 / 2.0).min(MAX_WAIT) + BOARD_PENALTY }
                });
                line_stops.push((line, sid, wait));
                (line_stops.len() - 1) as u32
            })
        };
        let (la, lb) = (line_stop(from, sa), line_stop(to, sb));
        let median = |mut v: Vec<u32>| {
            v.sort_unstable();
            v[v.len() / 2] as f32
        };
        let all = median(seg.times.iter().map(|t| t.1).collect());
        let mut per_hour = [all; HOURS];
        for (h, slot) in per_hour.iter_mut().enumerate() {
            let in_hour: Vec<u32> = seg.times.iter().filter(|t| t.0 == h).map(|t| t.1).collect();
            if !in_hour.is_empty() {
                *slot = median(in_hour);
            }
        }
        rides.push((la, lb, per_hour));

        // Geometry: the shape between the points nearest to both platforms, else a straight line
        ride_coord_start.push((coords.len() / 2) as u32);
        let mut pts: Vec<(f64, f64)> = vec![seg.from_pos, seg.to_pos];
        if let Some(shape) = shapes.get(&seg.shape) {
            let nearest = |(lng, lat): (f64, f64), from: usize| {
                (from..shape.len())
                    .min_by(|&i, &j| {
                        let d = |k: usize| (shape[k].1 - lng).powi(2) + (shape[k].2 - lat).powi(2);
                        d(i).total_cmp(&d(j))
                    })
                    .unwrap_or(from)
            };
            let i = nearest(seg.from_pos, 0);
            let j = nearest(seg.to_pos, i);
            if j > i + 1 {
                pts = shape[i..=j].iter().map(|p| (p.1, p.2)).collect();
            }
        }
        for (lng, lat) in pts {
            let (x, y) = zone.project(lng, lat);
            coords.extend([x, y]);
        }
    }
    ride_coord_start.push((coords.len() / 2) as u32);

    let strings_json = format!(
        "[{}]",
        strings.iter().map(|s| format!("{:?}", s)).collect::<Vec<_>>().join(",")
    );
    let mut out: Vec<u8> = Vec::new();
    let u32s = |out: &mut Vec<u8>, v: u32| out.extend(v.to_le_bytes());
    let f32s = |out: &mut Vec<u8>, v: f32| out.extend(v.to_le_bytes());
    for v in [
        0x324e5254,
        stations.len() as u32,
        lines.len() as u32,
        line_stops.len() as u32,
        rides.len() as u32,
        (coords.len() / 2) as u32,
        strings_json.len() as u32,
        0,
    ] {
        u32s(&mut out, v);
    }
    for (x, y, n) in &stations {
        f32s(&mut out, *x);
        f32s(&mut out, *y);
        u32s(&mut out, *n);
    }
    for l in &lines {
        for v in l {
            u32s(&mut out, *v);
        }
    }
    for (l, s, w) in &line_stops {
        u32s(&mut out, *l);
        u32s(&mut out, *s);
        w.iter().for_each(|v| f32s(&mut out, *v));
    }
    for (a, b, t) in &rides {
        u32s(&mut out, *a);
        u32s(&mut out, *b);
        t.iter().for_each(|v| f32s(&mut out, *v));
    }
    for v in &ride_coord_start {
        u32s(&mut out, *v);
    }
    for v in &coords {
        f32s(&mut out, *v);
    }
    out.extend(strings_json.as_bytes());
    std::fs::write(&args[3], &out)?;
    eprintln!(
        "transit.bin: {} stations, {} lines, {} line stops, {} rides, {} points, {:.1} MB",
        stations.len(),
        lines.len(),
        line_stops.len(),
        rides.len(),
        coords.len() / 2,
        out.len() as f64 / 1e6
    );
    Ok(())
}
