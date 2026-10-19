//! The trips of the reference day in the zone, aggregated by line segment (two consecutive stations of a line, in
//! one direction) and by hour of departure.

use super::HOURS;
use super::feed::{self, Archive};
use super::zone::Zone;
use crate::Res;
use std::collections::{HashMap, HashSet};

/// A station of the zone (a GTFS parent station, or a stop without one)
pub struct Station {
    pub name: String,
    pub lng: f64,
    pub lat: f64,
}

pub struct Route {
    pub name: String,
    pub color: u32,
    pub text: u32,
    /// GTFS route type: 0 tram, 1 metro, 2 rail, 3 bus…
    pub kind: u32,
}

/// (route, direction, station)
pub type LineStopKey = (String, String, String);
/// (route, direction, from station, to station)
pub type SegmentKey = (String, String, String, String);

/// Trips of the day by id: (route, direction, shape)
type Trips = HashMap<String, (String, String, String)>;
/// Trips run at a frequency (`frequencies.txt`), by id: their windows (start, end, headway), seconds
type Frequencies = HashMap<String, Vec<(u32, u32, u32)>>;
type Platforms = HashMap<String, Platform>;
type Stations = HashMap<String, Station>;
type Departures = HashMap<LineStopKey, [u32; HOURS]>;
type Segments = HashMap<SegmentKey, Segment>;

#[derive(Default)]
pub struct Segment {
    /// (hour of departure, seconds)
    pub times: Vec<(usize, u32)>,
    /// Shape of a trip that runs the segment, and the platforms it uses (to cut the shape)
    pub shape: String,
    pub from_pos: (f64, f64),
    pub to_pos: (f64, f64),
}

pub struct Schedule {
    pub stations: Stations,
    pub routes: HashMap<String, Route>,
    pub segments: Segments,
    /// Departures per hour of each line at each station
    pub departures: Departures,
    /// Points of the needed shapes, in order: (lng, lat)
    pub shapes: HashMap<String, Vec<(f64, f64)>>,
}

/// Shortest ride between two stations, seconds: feeds round to the minute, and two stops can share it
const MIN_RIDE_SECONDS: u32 = 30;

/// The last stop of the trip read with a time, to pair it with the next one, and the stops read since without one
struct PreviousStop<'a> {
    seq: u32,
    platform: &'a Platform,
    departure: u32,
    /// Stops whose times the feed leaves out (`timepoint=0`): their times are interpolated at the next timed stop
    untimed: Vec<&'a Platform>,
}

/// A platform of the zone, attached to its station
struct Platform {
    station: String,
    lng: f64,
    lat: f64,
}

impl Schedule {
    /// Several feeds of one region (a regional aggregate, or the SNCF trains with the urban networks), read one by one
    /// and merged. Their ids are prefixed with the feed's index: a `stop_id` "1" exists in many feeds. A station seen
    /// by two feeds stays two stations, joined through the streets like any change.
    pub fn read_all(paths: &[String], zone: &Zone, date: u32) -> Self {
        let mut merged = Schedule {
            stations: HashMap::new(),
            routes: HashMap::new(),
            segments: HashMap::new(),
            departures: HashMap::new(),
            shapes: HashMap::new(),
        };
        for (i, path) in paths.iter().enumerate() {
            eprintln!("Feed {}: {path}", i + 1);
            // A broken feed is left out, the others still make the layer
            match Self::read(path, zone, date) {
                Ok(schedule) => merged.absorb(schedule, &format!("{i}:")),
                Err(error) => eprintln!("  left out: {error}"),
            }
        }
        merged
    }

    /// Takes the content of another feed in, its ids prefixed
    fn absorb(&mut self, other: Schedule, prefix: &str) {
        let id = |s: &str| format!("{prefix}{s}");
        // Empty shape ids stay empty: no shape
        let shape_id = |s: &str| if s.is_empty() { String::new() } else { id(s) };

        self.stations
            .extend(other.stations.into_iter().map(|(k, v)| (id(&k), v)));
        self.routes
            .extend(other.routes.into_iter().map(|(k, v)| (id(&k), v)));
        self.shapes
            .extend(other.shapes.into_iter().map(|(k, v)| (id(&k), v)));
        self.departures.extend(
            other
                .departures
                .into_iter()
                .map(|((route, dir, station), v)| ((id(&route), dir, id(&station)), v)),
        );
        self.segments.extend(other.segments.into_iter().map(
            |((route, dir, from, to), mut seg)| {
                seg.shape = shape_id(&seg.shape);
                ((id(&route), dir, id(&from), id(&to)), seg)
            },
        ));
    }

    pub fn read(path: &str, zone: &Zone, date: u32) -> Res<Self> {
        let mut zip = feed::open(path)?;
        eprintln!(
            "Reference day {date} ({}), hour by hour",
            feed::weekday_column(date)
        );
        let (platforms, stations) = read_stops(&mut zip, zone)?;
        let services = services_near(&mut zip, date)?;
        let routes = read_routes(&mut zip)?;
        let trips = read_trips(&mut zip, &services)?;
        let frequencies = read_frequencies(&mut zip, &trips)?;
        eprintln!(
            "{} platforms in the zone, {} services, {} trips on the day, {} run at a frequency",
            platforms.len(),
            services.len(),
            trips.len(),
            frequencies.len()
        );
        let (segments, departures) = read_stop_times(&mut zip, &platforms, &trips, &frequencies)?;
        let shapes = read_shapes(&mut zip, &segments)?;
        Ok(Schedule {
            stations,
            routes,
            segments,
            departures,
            shapes,
        })
    }
}

fn read_stops(zip: &mut Archive, zone: &Zone) -> Res<(Platforms, Stations)> {
    let mut platforms = HashMap::new();
    let mut stations = Stations::new();
    feed::read_csv(zip, "stops.txt", |r| {
        let (lng, lat) = (
            r.get("stop_lon").parse().unwrap_or(0.0),
            r.get("stop_lat").parse().unwrap_or(0.0),
        );
        let station = Station {
            name: r.get("stop_name").into(),
            lng,
            lat,
        };
        if r.get("location_type") == "1" {
            stations.insert(r.get("stop_id").into(), station);
        } else if (r.get("location_type").is_empty() || r.get("location_type") == "0")
            && zone.contains(lng, lat)
        {
            let parent = r.get("parent_station");
            let id = if parent.is_empty() {
                r.get("stop_id")
            } else {
                parent
            };
            platforms.insert(
                r.get("stop_id").into(),
                Platform {
                    station: id.into(),
                    lng,
                    lat,
                },
            );
            stations.entry(id.into()).or_insert(station);
        }
    })?;
    Ok((platforms, stations))
}

/// Weeks searched, both ways, for a feed with no service on the reference day
const WEEKS_AROUND: i64 = 60;

/// Services of the reference day; when the feed has none then (it ended before, or starts after), those of the same
/// day of the week the nearest in time: an outdated feed still gives its network, said in the log
fn services_near(zip: &mut Archive, date: u32) -> Res<HashSet<String>> {
    for week in 0..=WEEKS_AROUND {
        for sign in [1, -1] {
            let day = feed::date(feed::days(date) + sign * 7 * week);
            let services = read_services(zip, day)?;
            if !services.is_empty() {
                if day != date {
                    eprintln!(
                        "  no service on {date}: the feed is read on {day}, the same day of the week"
                    );
                }
                return Ok(services);
            }
            if week == 0 {
                break;
            }
        }
    }
    Ok(HashSet::new())
}

/// Services running on the date: the calendar, then its exceptions. Some feeds (regional aggregates) list every
/// running date in `calendar_dates.txt` and have no `calendar.txt`: the GTFS allows it.
fn read_services(zip: &mut Archive, date: u32) -> Res<HashSet<String>> {
    let day = feed::weekday_column(date);
    let mut services = HashSet::new();
    if zip.index_for_name("calendar.txt").is_none() {
        feed::read_csv(zip, "calendar_dates.txt", |r| {
            if r.get("date").parse::<u32>().ok() == Some(date) && r.get("exception_type") == "1" {
                services.insert(r.get("service_id").to_string());
            }
        })?;
        return Ok(services);
    }
    feed::read_csv(zip, "calendar.txt", |r| {
        let (start, end) = (
            r.get("start_date").parse().unwrap_or(0),
            r.get("end_date").parse().unwrap_or(0),
        );
        if r.get(day) == "1" && start <= date && date <= end {
            services.insert(r.get("service_id").to_string());
        }
    })?;
    // Optional next to `calendar.txt`: no exception
    if zip.index_for_name("calendar_dates.txt").is_none() {
        return Ok(services);
    }
    feed::read_csv(zip, "calendar_dates.txt", |r| {
        if r.get("date").parse::<u32>().ok() == Some(date) {
            match r.get("exception_type") {
                "1" => services.insert(r.get("service_id").into()),
                "2" => services.remove(r.get("service_id")),
                _ => false,
            };
        }
    })?;
    Ok(services)
}

fn read_routes(zip: &mut Archive) -> Res<HashMap<String, Route>> {
    let mut routes = HashMap::new();
    feed::read_csv(zip, "routes.txt", |r| {
        routes.insert(
            r.get("route_id").into(),
            Route {
                name: r.get("route_short_name").into(),
                color: feed::hex(r.get("route_color"), 0x66_6666),
                text: feed::hex(r.get("route_text_color"), 0xff_ffff),
                kind: basic_route_type(r.get("route_type").parse().unwrap_or(3)),
            },
        );
    })?;
    Ok(routes)
}

/// The basic GTFS route type the app knows (0 tram, 1 metro, 2 rail, 3 bus, 5 cable tram, 6 aerial lift, 7
/// funicular) from any route type: ferries and the extended codes of the regional aggregates (100 rail, 200 coach,
/// 300 suburban rail, 400 urban rail, 500 metro, 600 underground, 700 bus, 900 tram, 1300 aerial lift…). Ferries go
/// with the buses: small river crossings, not lines to draw like a tram. A monorail (12) runs like a metro.
fn basic_route_type(kind: u32) -> u32 {
    match kind {
        0..=2 | 5..=7 => kind,
        12 | 400..=699 => 1,
        100..=199 | 300..=399 => 2,
        900..=999 => 0,
        1300..=1399 => 6,
        1400..=1499 => 7,
        _ => 3,
    }
}

/// Trips of the day: route, direction, shape. Without `direction_id` (optional in the GTFS), the headsign tells the
/// two ways of a line apart: merged, their departures would add up and halve the wait.
fn read_trips(zip: &mut Archive, services: &HashSet<String>) -> Res<Trips> {
    let mut trips = HashMap::new();
    feed::read_csv(zip, "trips.txt", |r| {
        if services.contains(r.get("service_id")) {
            let direction = match r.get("direction_id") {
                "" => format!("to {}", r.get("trip_headsign")),
                id => id.into(),
            };
            trips.insert(
                r.get("trip_id").into(),
                (
                    r.get("route_id").into(),
                    direction,
                    r.get("shape_id").into(),
                ),
            );
        }
    })?;
    Ok(trips)
}

/// Windows of the trips of the day run at a frequency (optional file); a window without a positive headway is left out
fn read_frequencies(zip: &mut Archive, trips: &Trips) -> Res<Frequencies> {
    let mut frequencies = Frequencies::new();
    if zip.index_for_name("frequencies.txt").is_none() {
        return Ok(frequencies);
    }
    feed::read_csv(zip, "frequencies.txt", |r| {
        let trip = r.get("trip_id");
        let window = (
            feed::seconds(r.get("start_time")),
            feed::seconds(r.get("end_time")),
            r.get("headway_secs").parse::<u32>().ok(),
        );
        if let (Some(start), Some(end), Some(headway)) = window
            && headway > 0
            && trips.contains_key(trip)
        {
            frequencies
                .entry(trip.into())
                .or_default()
                .push((start, end, headway));
        }
    })?;
    Ok(frequencies)
}

/// Consecutive stops of a trip, both in the zone, at two different stations
fn read_stop_times(
    zip: &mut Archive,
    platforms: &Platforms,
    trips: &Trips,
    frequencies: &Frequencies,
) -> Res<(Segments, Departures)> {
    let mut pairing = Pairing::new(platforms, trips, frequencies);
    let mut rows = 0u64;
    feed::read_csv(zip, "stop_times.txt", |r| {
        rows += 1;
        pairing.row(
            r.get("trip_id"),
            r.get("stop_id"),
            r.get("stop_sequence").parse().unwrap_or(0),
            feed::seconds(r.get("arrival_time")),
            feed::seconds(r.get("departure_time")),
        );
    })?;
    eprintln!(
        "{rows} stop times read, {} line segments in the zone",
        pairing.segments.len()
    );
    Ok((pairing.segments, pairing.departures))
}

/// Hour of the day of a GTFS time: past 24:00, the night of the service day
fn hour_of(seconds: u32) -> usize {
    (seconds / 3600) as usize % HOURS
}

/// Pairs the stop times, streamed row by row, into line segments and departures. The rows of a trip come together,
/// in increasing `stop_sequence` (the numbers may skip: 10, 20, 30…).
struct Pairing<'a> {
    platforms: &'a Platforms,
    trips: &'a Trips,
    frequencies: &'a Frequencies,
    segments: Segments,
    departures: Departures,
    /// The trip being read, and the departure of its first stop (in the zone or not): its frequencies count from it
    trip: String,
    trip_start: Option<u32>,
    previous: Option<PreviousStop<'a>>,
}

impl<'a> Pairing<'a> {
    fn new(platforms: &'a Platforms, trips: &'a Trips, frequencies: &'a Frequencies) -> Self {
        Pairing {
            platforms,
            trips,
            frequencies,
            segments: Segments::new(),
            departures: Departures::new(),
            trip: String::new(),
            trip_start: None,
            previous: None,
        }
    }

    /// One stop time; a time left out is `None` (only one of the two given: it stands for both)
    fn row(
        &mut self,
        trip: &str,
        stop_id: &str,
        seq: u32,
        arrival: Option<u32>,
        departure: Option<u32>,
    ) {
        if trip != self.trip {
            trip.clone_into(&mut self.trip);
            self.trip_start = None;
            self.previous = None;
        }
        let (platforms, trips) = (self.platforms, self.trips);
        let Some(line) = trips.get(trip) else { return };
        let (arrival, departure) = (arrival.or(departure), departure.or(arrival));
        self.trip_start = self.trip_start.or(departure);
        // A stop out of the zone breaks the trip: the next stop in the zone starts it again
        let Some(stop) = platforms.get(stop_id) else {
            self.previous = None;
            return;
        };

        match (self.previous.take().filter(|p| seq > p.seq), arrival) {
            (Some(mut p), None) => {
                p.seq = seq;
                p.untimed.push(stop);
                self.previous = Some(p);
            }
            (Some(p), Some(arrival)) => {
                self.rides(line, &p, stop, arrival);
                self.previous = Some(PreviousStop {
                    seq,
                    platform: stop,
                    departure: departure.unwrap_or(arrival),
                    untimed: Vec::new(),
                });
            }
            // The first stop of the trip in the zone (or a row out of order): nothing to pair it with yet
            (None, _) => {
                self.previous = departure.map(|departure| PreviousStop {
                    seq,
                    platform: stop,
                    departure,
                    untimed: Vec::new(),
                });
            }
        }
    }

    /// The rides from the previous timed stop to this one, through the untimed stops between, which share the time
    /// evenly
    fn rides(
        &mut self,
        line: &'a (String, String, String),
        p: &PreviousStop<'a>,
        stop: &'a Platform,
        arrival: u32,
    ) {
        let legs = u32::try_from(p.untimed.len()).map_or(u32::MAX, |n| n.saturating_add(1));
        let total = arrival.saturating_sub(p.departure);
        let mut from = p.platform;
        for (to, k) in p.untimed.iter().copied().chain([stop]).zip(0u32..) {
            let leave = p.departure + total * k / legs;
            let reach = p.departure + total * (k + 1) / legs;
            if from.station != to.station {
                self.segment(line, from, to, leave, reach - leave);
            }
            from = to;
        }
    }

    /// A ride between two stations leaving at `leave`: its time, and the departures it stands for at the first one
    /// (each run of the trip when it repeats at a frequency)
    fn segment(
        &mut self,
        (route, dir, shape): &'a (String, String, String),
        from: &Platform,
        to: &Platform,
        leave: u32,
        seconds: u32,
    ) {
        let mut hour = hour_of(leave);
        let departures = self
            .departures
            .entry((route.clone(), dir.clone(), from.station.clone()))
            .or_insert([0; HOURS]);
        match (self.frequencies.get(&self.trip), self.trip_start) {
            (Some(windows), Some(start)) => {
                // The stop times are a template: only their gaps count. The runs leave the first stop every headway of
                // each window, the ride time sampled at the hour of the first one.
                let offset = leave.saturating_sub(start);
                hour = windows.first().map_or(hour, |w| hour_of(w.0 + offset));
                for &(first, end, headway) in windows {
                    for run in (first..end).step_by(headway as usize) {
                        departures[hour_of(run + offset)] += 1;
                    }
                }
            }
            _ => departures[hour] += 1,
        }
        let seg = self
            .segments
            .entry((
                route.clone(),
                dir.clone(),
                from.station.clone(),
                to.station.clone(),
            ))
            .or_default();
        seg.times.push((hour, seconds.max(MIN_RIDE_SECONDS)));
        if seg.shape.is_empty() {
            seg.shape.clone_from(shape);
            seg.from_pos = (from.lng, from.lat);
            seg.to_pos = (to.lng, to.lat);
        }
    }
}

/// Points of the shapes the segments need, in order
fn read_shapes(zip: &mut Archive, segments: &Segments) -> Res<HashMap<String, Vec<(f64, f64)>>> {
    let wanted: HashSet<&str> = segments
        .values()
        .map(|s| s.shape.as_str())
        .filter(|s| !s.is_empty())
        .collect();
    let mut points: HashMap<String, Vec<(u32, f64, f64)>> = HashMap::new();
    // Optional in the GTFS (the SNCF feed has none): the rides then go straight from stop to stop
    if zip.index_for_name("shapes.txt").is_none() {
        return Ok(HashMap::new());
    }
    feed::read_csv(zip, "shapes.txt", |r| {
        if wanted.contains(r.get("shape_id")) {
            points.entry(r.get("shape_id").into()).or_default().push((
                r.get("shape_pt_sequence").parse().unwrap_or(0),
                r.get("shape_pt_lon").parse().unwrap_or(0.0),
                r.get("shape_pt_lat").parse().unwrap_or(0.0),
            ));
        }
    })?;
    Ok(points
        .into_iter()
        .map(|(id, mut pts)| {
            pts.sort_by_key(|p| p.0);
            (id, pts.into_iter().map(|p| (p.1, p.2)).collect())
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Three stations A, B, C in the zone, a line L whose trips "t" and "f" run A → B → C; "f" every 10 min from 6:00
    /// to 9:00
    fn network() -> (Platforms, Trips, Frequencies) {
        let platform = |station: &str| Platform {
            station: station.into(),
            lng: 2.4,
            lat: 48.8,
        };
        let platforms = ["A", "B", "C"]
            .into_iter()
            .map(|s| (format!("p{s}"), platform(s)))
            .collect();
        let line = ("L".to_string(), "0".to_string(), String::new());
        let trips = [("t".to_string(), line.clone()), ("f".to_string(), line)]
            .into_iter()
            .collect();
        let frequencies = [("f".to_string(), vec![(6 * 3600, 9 * 3600, 600)])]
            .into_iter()
            .collect();
        (platforms, trips, frequencies)
    }

    fn segment_seconds(pairing: &Pairing, from: &str, to: &str) -> Vec<u32> {
        let key = ("L".into(), "0".into(), from.into(), to.into());
        pairing.segments[&key].times.iter().map(|t| t.1).collect()
    }

    fn departures_at(pairing: &Pairing, station: &str) -> [u32; HOURS] {
        pairing.departures[&("L".into(), "0".into(), station.into())]
    }

    const H8: u32 = 8 * 3600;

    #[test]
    fn pairs_stops_whose_sequence_skips() {
        let (platforms, trips, frequencies) = network();
        let mut pairing = Pairing::new(&platforms, &trips, &frequencies);
        pairing.row("t", "pA", 10, Some(H8), Some(H8));
        pairing.row("t", "pB", 20, Some(H8 + 120), Some(H8 + 150));
        pairing.row("t", "pC", 30, Some(H8 + 300), Some(H8 + 300));
        assert_eq!(segment_seconds(&pairing, "A", "B"), [120]);
        assert_eq!(segment_seconds(&pairing, "B", "C"), [150]);
        assert_eq!(departures_at(&pairing, "B")[8], 1);
    }

    #[test]
    fn shares_the_time_among_untimed_stops() {
        let (platforms, trips, frequencies) = network();
        let mut pairing = Pairing::new(&platforms, &trips, &frequencies);
        pairing.row("t", "pA", 1, Some(H8), Some(H8));
        pairing.row("t", "pB", 2, None, None);
        pairing.row("t", "pC", 3, Some(H8 + 600), None);
        assert_eq!(segment_seconds(&pairing, "A", "B"), [300]);
        assert_eq!(segment_seconds(&pairing, "B", "C"), [300]);
    }

    #[test]
    fn counts_every_run_of_a_frequency() {
        let (platforms, trips, frequencies) = network();
        let mut pairing = Pairing::new(&platforms, &trips, &frequencies);
        // The template run leaves A at 0:00; B is reached 2 min later, so its runs leave at 6:02, 6:12… 8:52
        pairing.row("f", "pA", 1, Some(0), Some(0));
        pairing.row("f", "pB", 2, Some(120), Some(120));
        pairing.row("f", "pC", 3, Some(240), Some(240));
        let at_b = departures_at(&pairing, "B");
        assert_eq!(&at_b[5..10], [0, 6, 6, 6, 0]);
        assert_eq!(departures_at(&pairing, "A")[6], 6);
    }

    #[test]
    fn breaks_a_trip_at_a_stop_out_of_the_zone() {
        let (platforms, trips, frequencies) = network();
        let mut pairing = Pairing::new(&platforms, &trips, &frequencies);
        pairing.row("t", "pA", 1, Some(H8), Some(H8));
        pairing.row("t", "elsewhere", 2, Some(H8 + 60), Some(H8 + 60));
        pairing.row("t", "pC", 3, Some(H8 + 120), Some(H8 + 120));
        assert!(pairing.segments.is_empty());
    }

    #[test]
    fn maps_extended_route_types() {
        assert_eq!(basic_route_type(109), 2);
        assert_eq!(basic_route_type(300), 2);
        assert_eq!(basic_route_type(401), 1);
        assert_eq!(basic_route_type(500), 1);
        assert_eq!(basic_route_type(12), 1);
        assert_eq!(basic_route_type(900), 0);
        assert_eq!(basic_route_type(1300), 6);
        assert_eq!(basic_route_type(700), 3);
        assert_eq!(basic_route_type(4), 3);
    }
}
