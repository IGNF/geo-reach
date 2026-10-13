# Architecture

geo-reach is a static web app: no backend, no server-side computation. Everything that reacts to the mouse runs in
the browser, from data prepared once at build time. The only network calls after the first load are the basemap
tiles and two optional Géoplateforme queries made when the cursor stops (route comparison, reverse geocoding).

## The big picture

```mermaid
flowchart LR
  subgraph prep["Offline, once (developer machine)"]
    WFS["GPF WFS<br/>BD TOPO troncon_de_route"] -->|scripts/buildGraph.ts| G["regions/&lt;id&gt;.bin.gz<br/>13 regions, 1 to 52 MB"]
    Z["BD TOPO heights (Z)<br/>RGE ALTI"] -->|climb, descent| G
    GTFS["GTFS feeds<br/>(transport.data.gouv.fr)"] -->|scripts/buildTransit.ts<br/>crates/gtfs-prep| T["regions/&lt;id&gt;.transit.bin.gz<br/>13 regions, 14,000 lines"]
    G -. zone origin + bbox .-> T
    RS[crates/engine] -->|scripts/buildEngine.ts<br/>cargo → wasm32| W[engine.wasm]
  end

  subgraph browser["Browser (web)"]
    L[network.ts + transit.ts<br/>decode and merge] --> P[profile.ts<br/>costs + CSR graph]
    C[cuts.ts<br/>closed sections] -->|closed edges| P
    P --> E[travelEngine.ts<br/>snap + WASM Dijkstra]
    E -->|with closures: run all open too| B[baseline worker]
    B -->|delayed stations| UI
    E -->|node times| R[networkLayer.ts<br/>WebGL custom layer]
    R -->|same node times| BG[buildingGlLayer.ts<br/>3D buildings]
    E -->|path| UI[TripPanel / labels]
    UI -.cursor stops.-> GPF["GPF itineraire<br/>+ reverse geocoding"]
    BT["GPF BD TOPO vector tiles<br/>batiment, zoom 15"] -->|building.worker.ts<br/>extruded| BG
  end

  G --> L
  T --> L
  W --> E
```

## Layout

The app follows a feature-based layout: each feature holds its components, its logic and its workers, and the rest
of the app reaches it only through its public API (`features/<name>/index.ts`, enforced by the linter). Within a
feature, files import each other relatively; across features, through `@/features/<name>`; generic code lives in
`shared/`. Dependencies run one way: `app` → features → `routing` and `shared`, with no cycle.

```
web/src/
  app/                  entry point, root component (App.tsx), global styles, view state in the URL
  features/
    routing/            networks (read, grafted), per-mode profiles, snapping, the WASM engine and its workers
    map/                MapLibre map, network layer (WebGL), isochrone lines and their worker, camera
    buildings/          3D buildings: tiles extruded in a worker, WebGL layer colored by the node times
    cuts/               closed sections: model, map layer, panel
    trip/               trip panel, legs, mode comparison, Géoplateforme route and addresses
    settings/           settings panel, mode picker, model of the travel times
    search/             address search
    regions/            the 13 regions, startup (download, decode, engine) and its screen
  shared/               config, formatting, colors, projection, bounds, WebGL helpers, binary reader, data cache,
                        Géoplateforme client, ui/ (Brand, LineBadge)
  pages/                how-it-works/, legal/: the other pages of the site
  locales/              UI strings (English, French), picked from the browser language
```

Workers are named `*.worker.ts`. The UI is built with `@ign-junn/design-system` (`Box`, `Stack`, `Grid`,
`Typography`…); plain HTML only where it has no equivalent (MapLibre controls, colors computed from the data).

| Path | Language | Role |
|---|---|---|
| `scripts/buildGraph.ts` | TypeScript (Bun) | Downloads the BD TOPO road sections of a region from the GPF WFS and writes its road file |
| `scripts/buildTransit.ts`, `crates/gtfs-prep` | TypeScript (Bun), Rust (native) | Downloads a region's GTFS feeds and writes its transit file, aligned on the origin of its road file |
| `crates/engine` | Rust → WebAssembly | Bounded multi-source Dijkstra, ~180 lines, no dependencies |
| `scripts/buildEngine.ts` | TypeScript (Bun) | `cargo build --target wasm32-unknown-unknown`, copies the result to `web/src/features/routing/engine.wasm` |

Two workspaces sit side by side: Bun for JavaScript (`package.json`, `web`) and Cargo for Rust (`Cargo.toml`,
`crates/*`). A *crate* is a Rust package.

## Why it is fast

The design goal is "no network call on mouse move". Each piece removes one cost from the hot path:

| Cost | Removed by |
|---|---|
| Routing server round trip (300–500 ms per GPF isochrone) | Local graph + WASM Dijkstra (~1–6 ms) |
| JSON parsing of the network | Binary files read as typed array views (zero copy) |
| Allocation per run | Buffers allocated once in WASM memory, reset lazily (only the nodes touched last time) |
| Copying results out of WASM | JS reads `dist` / `pred_*` as views on the WASM memory |
| Re-uploading geometry to the GPU | Geometry uploaded once per profile; each move uploads only the node times (one float per node) |
| Running more than once per frame | Mouse events only store the cursor; `requestAnimationFrame` runs the engine once for the latest position |
| React re-renders at 60 Hz | Map label and route are updated imperatively; React panels are throttled |

## Hot path: one mouse move

```mermaid
sequenceDiagram
  participant M as MapLibre mousemove
  participant V as MapView (rAF)
  participant T as TravelEngine (TS)
  participant W as engine.wasm
  participant G as NetworkLayer (GPU)

  M->>V: store cursor, schedule frame
  V->>T: run(x, y, maxSeconds)
  T->>T: SnapIndex.nearest → edge, fraction, distance
  T->>W: write 2 sources (edge ends + access walk), run()
  W-->>T: dist / pred buffers (views, no copy)
  T-->>V: Result
  V->>G: setTimes(dist) → texSubImage2D
  G->>G: shader: time per segment end, color ramp
```

When a point is pinned (click), the engine runs once from that point and the result is copied (`TravelEngine.pin`).
Mouse moves then only call `timeAt` (snap + two additions) and `path` (walk back the predecessors): no Dijkstra at
all. After `SETTLE_MS` without movement, `useGpfRoute` asks the Géoplateforme route service for the same trip
(walking and driving only: the GPF has no transit nor bike profile), with an `AbortController` so that only the latest request survives.

## Modes and directions

A *profile* (`web/src/features/routing/profile.ts`) is one combination of mode (`pedestrian`, `bike`, `car`,
`transit`), direction (`departure`, `arrival`), hour of departure (traffic, service frequency) and bus on/off. Switching profile rebuilds the cost arrays and the CSR graph in
JS (a few tens of ms), writes them into the WASM memory, and re-uploads the GPU geometry. Snap indexes are cached per
mode.

- **Departure**: times from the point to every node.
- **Arrival**: the graph is reversed (each arc A→B becomes B→A), so the same Dijkstra gives the time from every
  node to the point.

## State and sharing

The view (`mode/direction/scale/contours/bus/lng,lat/hour/model/cuts`) lives in the URL hash (`app/urlState.ts`): a copied link
opens the same view. No other persistence.

## More

- [Engine](engine.md): graph model, costs, Dijkstra, snapping, paths.
- [Rendering](rendering.md): the WebGL layer and its shader.
- [Data formats](data-formats.md): the road and transit files of the regions, byte by byte, and how to rebuild them.
