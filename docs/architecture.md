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
    GTFS["GTFS feeds<br/>(transport.data.gouv.fr)"] -->|scripts/buildTransit.ts<br/>crates/gtfs-prep| T["regions/&lt;id&gt;.transit.bin.gz<br/>12 regions"]
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
    BT["GPF BD TOPO vector tiles<br/>batiment, zoom 15"] -->|buildingWorker.ts<br/>extruded| BG
  end

  G --> L
  T --> L
  W --> E
```

## Layout

| Path | Language | Role |
|---|---|---|
| `scripts/buildGraph.ts` | TypeScript (Bun) | Downloads the BD TOPO road sections of a region from the GPF WFS and writes its road file |
| `scripts/buildTransit.ts`, `crates/gtfs-prep` | TypeScript (Bun), Rust (native) | Downloads a region's GTFS feed and writes its transit file, aligned on the origin of its road file |
| `crates/engine` | Rust → WebAssembly | Bounded multi-source Dijkstra, ~180 lines, no dependencies |
| `scripts/buildEngine.ts` | TypeScript (Bun) | `cargo build --target wasm32-unknown-unknown`, copies the result to `web/src/engine/engine.wasm` |
| `web/src/engine/` | TypeScript | Loads the binaries, builds the per-mode graph, drives the WASM engine, rebuilds paths |
| `web/src/map/networkLayer.ts` | TypeScript + GLSL | MapLibre custom layer that draws the network colored by time |
| `web/src/map/cutLayer.ts` | TypeScript | Closed sections on the map, and the section under the cursor in cut mode |
| `web/src/map/buildingGlLayer.ts` | TypeScript + GLSL | 3D buildings drawn by the GPU, colored from the network's node times |
| `web/src/engine/buildingMesh.ts`, `buildingWorker.ts` | TypeScript | BD TOPO tiles to building meshes (walls, earcut roofs), in a worker |
| `web/src/map/contourLines.ts` | TypeScript | Isochrone lines: requests to their worker, newest first |
| `web/src/engine/wasm.ts` | TypeScript | Exports of `engine.wasm`, checked at load time |
| `web/src/components/` | React | Map, settings panel (DS preview panel), trip card, closures panel, mode picker |
| `web/src/lib/` | TypeScript | Config, GPF clients, URL state, colors, formatting, binary reader, bounds, startup (download → engine, with its progress) |
| `web/src/locales/` | TypeScript | UI strings (English, French), picked from the browser language |

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

A *profile* (`web/src/engine/profile.ts`) is one combination of mode (`pedestrian`, `bike`, `car`,
`transit`), direction (`departure`, `arrival`), hour of departure (traffic, service frequency) and bus on/off. Switching profile rebuilds the cost arrays and the CSR graph in
JS (a few tens of ms), writes them into the WASM memory, and re-uploads the GPU geometry. Snap indexes are cached per
mode.

- **Departure**: times from the point to every node.
- **Arrival**: the graph is reversed (each arc A→B becomes B→A), so the same Dijkstra gives the time from every
  node to the point.

## State and sharing

The view (`mode/direction/scale/contours/bus/lng,lat/hour/model/cuts`) lives in the URL hash (`lib/urlState.ts`): a copied link
opens the same view. No other persistence.

## More

- [Engine](engine.md): graph model, costs, Dijkstra, snapping, paths.
- [Rendering](rendering.md): the WebGL layer and its shader.
- [Data formats](data-formats.md): the road and transit files of the regions, byte by byte, and how to rebuild them.
