# geo-reach

### How far can you go in 15 minutes, from anywhere in France?

Move the mouse: travel times on foot, by bike, by car or by public transport are recomputed **at every move**, and
the map lights up from green (close) to red, then violet (far).

**[▶ Open the demo](https://ignf.github.io/geo-reach/)** · [How it works](https://ignf.github.io/geo-reach/how-it-works.html)
· desktop browser recommended

[![geo-reach: travel times by public transport from the cursor, around the Seine in central Paris](docs/screenshot.jpg)](https://ignf.github.io/geo-reach/)

| 13 | 18 M | 14,000 | 0 |
|:---:|:---:|:---:|:---:|
| regions of metropolitan France | road sections | public transport lines | server: everything runs in your browser |

**Data from the IGN Géoplateforme** (BD TOPO, Plan IGN, geocoding) and transport.data.gouv.fr (timetables). **Computed
in the browser** by a Rust engine compiled to WebAssembly: the whole region in a few milliseconds.

## What you can do

- **Hover** anywhere: the map is recolored from the cursor. **Click** to pin a point, then hover a destination for
  the route and the trip step by step.
- **Choose** the mode, the hour, departure or arrival, the maximum time; buildings in 3D follow the cursor too.
- **Simulate a closure** (a metro section, a street) and see the stations that lose more than 5 min.
- **Compare the modes** on one trip, **search** an address, **share** the view by its link.

## Limits

A proof of concept, for comparing places and modes, not for planning to the minute:

- transit: average waits on a typical weekday, not the exact timetable;
- car: a typical congestion curve, no live traffic;
- walking and cycling slowed down on slopes, from the BD TOPO heights;
- footpaths and service roads only in the main city centres.

The literature behind each model, with figures and formulas: [How it works](https://ignf.github.io/geo-reach/how-it-works.html)
and [docs/engine.md](docs/engine.md).

## Why not call the Géoplateforme route service?

One map takes it 1 to 3 s (12 to 15 isochrone requests, about 5 accepted per second); following the mouse needs 30 to
60 maps per second, and it has no public transport. So the **data** comes from the Géoplateforme and the
**computation** runs in the browser; the route service stays the reference, shown beside our time in the trip panel.
A one-to-many service (travel time matrix) or a downloadable routing graph would let the Géoplateforme serve it
directly.

## Data and licences

| Data | Source | Licence |
|---|---|---|
| Roads and buildings (BD TOPO), basemap (Plan IGN), hillshade (RGE ALTI), addresses | IGN, Géoplateforme | Licence Ouverte Etalab 2.0 |
| Public transport timetables | [transport.data.gouv.fr](https://transport.data.gouv.fr) (Île-de-France Mobilités, regional aggregates, SNCF) | per feed, mostly ODbL or Licence Ouverte |

Region by region: [data/README.md](data/README.md). Published by IGN, a proof of concept, not an
official service; no account, no cookie: [legal notice](https://ignf.github.io/geo-reach/legal.html).

## For developers

Requirements: [Bun](https://bun.sh); [git-lfs](https://git-lfs.com) for the largest region file. The data and the
compiled engine are in the repository: no Rust needed to run the app.

```sh
bun install
bun run dev        # http://127.0.0.1:5173
bun run build      # static site in web/dist
bun run typecheck && bun run lint
```

```
web/             React app on the isard map engine (Vite, @ign-junn/design-system); src/features/ one folder per feature
crates/engine/   travel time engine, Rust → WebAssembly
crates/prep/     Rust tool: BD TOPO roads and GTFS timetables → the network files of a region
scripts/         engine build, benchmarks, calibration
docs/            technical documentation
```

**Change the engine** (Rust, `rustup target add wasm32-unknown-unknown`): `bun run engine`, `cargo test --workspace`,
`cargo clippy --workspace --all-targets`; time it with `bun scripts/benchEngine.ts [region]`.

**Rebuild the data**: `bun run data -- <region>|all` (roads) and `bun run transit -- <region>|all` (timetables); the
downloads are cached in `.cache/`. The outlines of the regions (which one a searched place is in) come from
`bun scripts/regionShapes.ts`.

**Deployment**: every push to `main` publishes the site on GitHub Pages.

Details: [architecture](docs/architecture.md), [engine](docs/engine.md), [rendering](docs/rendering.md),
[data formats](docs/data-formats.md).
