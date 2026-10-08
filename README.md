# geo-reach

Real-time accessibility dataviz on Géoplateforme data: move the mouse anywhere on the map and the whole network is
instantly colored by travel time from that point (public transport, walking or driving). A click pins the point:
the detailed trip then follows the cursor. Demo zone: Saint-Mandé and surroundings (about 12 × 10 km).

## Getting started

Requirements: [Bun](https://bun.sh). To change the engine: Rust with the `wasm32-unknown-unknown` target
(`rustup target add wasm32-unknown-unknown`); without Rust, the versioned build (`apps/web/src/engine/engine.wasm`)
is used.

```sh
bun install
bun run dev        # builds the Rust engine to WebAssembly, then starts the app (http://127.0.0.1:5173)
bun run build      # static app in apps/web/dist
```

The prepared data of the zone (`apps/web/public/data/*.bin`) is versioned: no need to rebuild it to run the app.

The interface follows the browser language: French or English (`apps/web/src/locales`).

## Layout

```
apps/web/            React + MapLibre app (Vite), UI built with @ign-junn/design-system
crates/engine/       travel time engine in Rust, compiled to WebAssembly (bounded Dijkstra, ~1 to 6 ms per run)
crates/gtfs-prep/    Rust tool: GTFS timetables → public transport layer (transit.bin)
scripts/             BD TOPO road network preparation (graph.bin)
Cargo.toml           Rust workspace (crates/*)
package.json         JS workspace (apps/*) and repository commands
```

A *crate* is a Rust package (the equivalent of an npm package).

## How it works

The rule is fluidity: no network call while the mouse moves.

1. **Data, once**: the BD TOPO road network of the zone (Géoplateforme WFS: traffic direction, pedestrian and car
   access, average speeds, street names) is packed into a 3 MB binary graph. The Île-de-France Mobilités timetables
   (GTFS) add metro, RER, tram and bus lines with a frequency model at the morning peak (Tuesday 13 October 2026,
   7–9 am): ride = median time between two stations, wait = half the headway.
2. **On every mouse move**: the point is attached to the nearest road (with the walking time to reach it), then the
   WebAssembly engine computes the times to the whole network (multi-source Dijkstra bounded by the chosen scale).
3. **GPU rendering**: a custom MapLibre WebGL layer draws every road section; only the node times are uploaded on
   each frame, and the shader colors the network (wide glow for the heat effect, thin line on top, isochrone fronts
   in black).
4. **Pinned point**: the time and the path to the cursor are read from the existing result (instant). When the
   cursor stops, the Géoplateforme route service is queried for comparison (walking and driving).

Géoplateforme services used: Plan IGN basemap (vector tiles), BD TOPO WFS, reverse geocoding, route service.

## Rebuilding the data

```sh
bun run data                                        # BD TOPO road network → apps/web/public/data/graph.bin
mkdir -p .cache/gtfs
curl -L -o .cache/gtfs/idfm.zip https://www.data.gouv.fr/api/1/datasets/r/413988ed-d340-467b-8be2-7b999fcd207a
cargo run -p gtfs-prep --release -- .cache/gtfs/idfm.zip apps/web/public/data/graph.bin apps/web/public/data/transit.bin
```

The zone is set in `scripts/buildGraph.ts` (`BBOX`), the reference day and time window in `crates/gtfs-prep`.

## Limits

- Frequency model: no exact timetable, an average wait; transfers happen inside the station.
- Driving: BD TOPO average speeds reduced by 30 % in town, no live traffic nor traffic lights.
- The network is not loaded outside the zone.

## Sources and licences

- Road network and basemap: IGN, BD TOPO and Plan IGN, Licence Ouverte Etalab 2.0.
- Timetables: Île-de-France Mobilités,
  [GTFS](https://transport.data.gouv.fr/datasets/reseaux-urbains-et-interurbains-dile-de-france-mobilites-idfm),
  ODbL licence; `transit.bin` is a derived database under the same licence.
