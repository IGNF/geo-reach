# Data formats

Both files are little endian, every section 4-byte aligned, so the browser reads them as typed array views on the
fetched `ArrayBuffer` (no parsing, no copy). Positions are `f32` Web Mercator metres relative to the zone origin
stored in `graph.bin`.

## graph.bin (road network)

Written by `scripts/buildGraph.ts`, read by `web/src/engine/network.ts` (`loadRoadNetwork`), which rebuilds the full
geometries (`coords`, `coordStart`) once at load.

| Section | Type | Content |
|---|---|---|
| header | `u32 × 6` | magic `GRF3` (`0x33465247`), nodeCount, edgeCount (E), pointCount, namesBytes, padding |
| zone | `f64 × 6` | originX, originY (Mercator metres of the zone centre), minLng, minLat, maxLng, maxLat |
| `nodes` | `f32[nodeCount × 2]` | node positions |
| `edgeA`, `edgeB` | `u32[E]` each | end nodes; the geometry runs from A to B |
| `edgeName` | `u32[E]` | index in `names`, `0xffffffff` without name |
| `edgePointStart` | `u32[E + 1]` | first interior point of each edge in `points` |
| `edgeLength` | `u16[E]` | ground metres |
| `edgeCarSpeed` | `u8[E]` | km/h, 0 where cars cannot go |
| `edgeFlags` | `u8[E]` | bit field, below |
| `edgeImportance` | `u8[E]` | BD TOPO importance, 1 (major) to 6, 0 unknown |
| `points` | `i16[pointCount × 2]` | interior points: Mercator metres from the previous point, node A (rounded) first |
| `names` | UTF-8 JSON | array of street names (after 4-byte alignment) |

To stay light over Île-de-France (1.19 million BD TOPO sections): every section in Paris and the inner suburbs,
beyond no footpaths, stairs, tracks nor service roads (importance 6); consecutive sections with the same attributes
merged into one edge; geometries simplified to 3 m (Douglas-Peucker). Result: about 540,000 nodes and 710,000 edges,
23 MB (11 MB gzipped). The WFS is read tile by tile (0.1° × 0.08°), cached in `.cache/bdtopo/`.

`edgeFlags`:

| Bit | Meaning | BD TOPO source |
|---|---|---|
| 1 | car A→B | `acces_vehicule_leger` free or toll, `sens_de_circulation` |
| 2 | car B→A | same |
| 4 | pedestrian | not motorway or ramp, `acces_pieton` not forbidden |
| 8 | stairs (walk ×2) | `nature = Escalier` |
| 16, 32 | bike A→B, B→A | one-way rules, except contraflow cycle lanes |
| 64 | cycle lane or greenway | `amenagement_cyclable_*`, `itineraire_vert` |
| 128 | unpaved path | `nature` in Sentier, Chemin, Route empierrée |

Nodes are the section ends, merged when their coordinates are equal to 7 decimals. Sections no mode can use are
dropped.

## transit.bin (public transport layer)

Written by `crates/gtfs-prep`, read by `web/src/engine/transit.ts` (`loadTransit`).

| Section | Type | Content |
|---|---|---|
| header | `u32 × 8` | magic `TRN3` (`0x334e5254`), stationCount, lineCount, lineStopCount, rideCount, coordCount, stringsBytes, padding |
| stations | `(f32 x, f32 y, u32 name)[stationCount]` | GTFS parent stations of the zone |
| lines | `(u32 name, u32 color, u32 textColor, u32 routeType)[lineCount]` | colors as `0xRRGGBB`, GTFS route type (0 tram, 1 metro, 2 rail, 3 bus) |
| lineStops | `(u32 line, u32 station, u16 wait[24])[lineStopCount]` | wait per hour of the day, seconds, boarding penalty included, `65535` without departure |
| rides | `(u32 fromLineStop, u32 toLineStop, u16 seconds[24])[rideCount]` | ride time per hour |
| `rideCoordStart` | `u32[rideCount + 1]` | first point of each ride in `coords` |
| `coords` | `f32[coordCount × 2]` | ride geometries: GTFS shapes cut between the two platforms for rail and tram, straight lines for buses |
| strings | UTF-8 JSON | names of stations and lines |

### Frequency model

For a reference day (default Tuesday 2026-10-13, 4th argument of `gtfs-prep`), hour by hour:

- **ride** = median of the scheduled times between two consecutive stations of a line;
- **wait** = 3600 / (departures in the hour) / 2, capped at 12 min, plus 60 s.

Platforms are merged into their parent station; GTFS times past 24:00 wrap to the hour of the day.

The browser grafts this layer on the road graph at load time (`loadTransit` returns a function of the road
network): each station is linked to its 3 nearest walkable road nodes within 400 m.

The app keeps the 24 hourly values of every boarding and ride (`hourCosts`); the profile picks the one of the
chosen hour of departure.

## engine.wasm

Built by `bun run engine` (`scripts/buildEngine.ts`): `cargo build -p engine --target wasm32-unknown-unknown
--release`, copied to `web/src/engine/engine.wasm` and imported by Vite as an asset URL. The file is versioned
so that the app builds without Rust.

## Rebuilding

```sh
bun run data   # graph.bin, WFS read tile by tile, about a minute
mkdir -p .cache/gtfs
curl -L -o .cache/gtfs/idfm.zip https://www.data.gouv.fr/api/1/datasets/r/413988ed-d340-467b-8be2-7b999fcd207a
cargo run -p gtfs-prep --release -- .cache/gtfs/idfm.zip web/public/data/graph.bin web/public/data/transit.bin
```

`transit.bin` depends on `graph.bin` (origin and bbox): rebuild it whenever the zone changes. The zone is `BBOX` in
`scripts/buildGraph.ts`. On the IGN network, set `HTTPS_PROXY=http://proxy.ign.fr:3128` for these tools.

## In the browser

The files are kept in the Cache Storage of the browser (`web/src/lib/dataCache.ts`): only the first visit downloads
them. Bump `DATA_VERSION` there when the files change.
