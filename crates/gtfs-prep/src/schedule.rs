//! The trips of the reference day in the zone, aggregated by line segment (two consecutive stations of a line, in
//! one direction) and by hour of departure.

use crate::feed::{self, Archive};
use crate::zone::Zone;
use crate::{HOURS, Res};
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

/// The stop read just before, to pair it with the next one of the same trip
struct PreviousStop {
    trip: String,
    seq: u32,
    station: String,
    departure: u32,
    pos: (f64, f64),
}

/// A platform of the zone, attached to its station
struct Platform {
    station: String,
    lng: f64,
    lat: f64,
}

impl Schedule {
    pub fn read(path: &str, zone: &Zone, date: u32) -> Res<Self> {
        let mut zip = feed::open(path)?;
        eprintln!(
            "Reference day {date} ({}), hour by hour",
            feed::weekday_column(date)
        );
        let (platforms, stations) = read_stops(&mut zip, zone)?;
        let services = read_services(&mut zip, date)?;
        let routes = read_routes(&mut zip)?;
        let trips = read_trips(&mut zip, &services)?;
        eprintln!(
            "{} platforms in the zone, {} services, {} trips on the day",
            platforms.len(),
            services.len(),
            trips.len()
        );
        let (segments, departures) = read_stop_times(&mut zip, &platforms, &trips)?;
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

/// Services running on the date: the calendar, then its exceptions
fn read_services(zip: &mut Archive, date: u32) -> Res<HashSet<String>> {
    let day = feed::weekday_column(date);
    let mut services = HashSet::new();
    feed::read_csv(zip, "calendar.txt", |r| {
        let (start, end) = (
            r.get("start_date").parse().unwrap_or(0),
            r.get("end_date").parse().unwrap_or(0),
        );
        if r.get(day) == "1" && start <= date && date <= end {
            services.insert(r.get("service_id").to_string());
        }
    })?;
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
                color: feed::hex(r.get("route_color"), 0x666666),
                text: feed::hex(r.get("route_text_color"), 0xffffff),
                kind: r.get("route_type").parse().unwrap_or(3),
            },
        );
    })?;
    Ok(routes)
}

/// Trips of the day: route, direction, shape
fn read_trips(zip: &mut Archive, services: &HashSet<String>) -> Res<Trips> {
    let mut trips = HashMap::new();
    feed::read_csv(zip, "trips.txt", |r| {
        if services.contains(r.get("service_id")) {
            trips.insert(
                r.get("trip_id").into(),
                (
                    r.get("route_id").into(),
                    r.get("direction_id").into(),
                    r.get("shape_id").into(),
                ),
            );
        }
    })?;
    Ok(trips)
}

/// Consecutive stops of a trip, both in the zone, at two different stations
fn read_stop_times(
    zip: &mut Archive,
    platforms: &Platforms,
    trips: &Trips,
) -> Res<(Segments, Departures)> {
    let mut segments = Segments::new();
    let mut departures = Departures::new();
    let mut previous: Option<PreviousStop> = None;
    let mut rows = 0u64;
    feed::read_csv(zip, "stop_times.txt", |r| {
        rows += 1;
        let trip = r.get("trip_id");
        let (Some((route, dir, shape)), Some(stop)) =
            (trips.get(trip), platforms.get(r.get("stop_id")))
        else {
            previous = None;
            return;
        };
        let seq: u32 = r.get("stop_sequence").parse().unwrap_or(0);
        let arr = feed::seconds(r.get("arrival_time")).unwrap_or(0);
        let dep = feed::seconds(r.get("departure_time")).unwrap_or(0);
        if let Some(p) = &previous
            && p.trip == trip
            && p.seq + 1 == seq
            && p.station != stop.station
        {
            // GTFS times run past 24:00 for the night of the service day
            let hour = (p.departure / 3600) as usize % HOURS;
            departures
                .entry((route.clone(), dir.clone(), p.station.clone()))
                .or_insert([0; HOURS])[hour] += 1;
            let seg = segments
                .entry((
                    route.clone(),
                    dir.clone(),
                    p.station.clone(),
                    stop.station.clone(),
                ))
                .or_default();
            seg.times
                .push((hour, arr.saturating_sub(p.departure).max(30)));
            if seg.shape.is_empty() {
                seg.shape = shape.clone();
                seg.from_pos = p.pos;
                seg.to_pos = (stop.lng, stop.lat);
            }
        }
        previous = Some(PreviousStop {
            trip: trip.into(),
            seq,
            station: stop.station.clone(),
            departure: dep,
            pos: (stop.lng, stop.lat),
        });
    })?;
    eprintln!(
        "{rows} stop times read, {} line segments in the zone",
        segments.len()
    );
    Ok((segments, departures))
}

/// Points of the shapes the segments need, in order
fn read_shapes(zip: &mut Archive, segments: &Segments) -> Res<HashMap<String, Vec<(f64, f64)>>> {
    let wanted: HashSet<&str> = segments
        .values()
        .map(|s| s.shape.as_str())
        .filter(|s| !s.is_empty())
        .collect();
    let mut points: HashMap<String, Vec<(u32, f64, f64)>> = HashMap::new();
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
