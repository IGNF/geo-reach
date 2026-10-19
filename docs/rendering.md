# Rendering

The map is drawn by [isard](https://graffkevin.github.io/isard/), a WebGL 2 map engine (Rust core in WebAssembly)
made for this kind of layer: a graph of millions of edges colored by a value per node, recolored at every mouse
move. geo-reach writes no WebGL of its own: `web/src/features/map/MapView.tsx` creates the map and its layers, hands
them the network once, then the node times at every move.

## Layers, bottom to top

| Layer | isard call | Content |
|---|---|---|
| Basemap | `basemap: 'ign-plan-grey-vector'` | Plan IGN vector tiles of the Géoplateforme, grey style, drawn by the engine's workers; its labels stay above the layers added later |
| Veil | `addFills` | The world in white at 50 %: the network of the chosen mode stands out |
| Hillshade | `addRaster` | IGN hillshade (RGE ALTI, WMTS of the Géoplateforme) at 55 %, over the veil so that it is not washed out |
| Buildings | `addExtrusions` | BD TOPO buildings, colored by the network's times (3D view, `features/buildings`) |
| Network | `addNetwork` | Every road and ride of the profile, colored by the time to reach it |
| Rail lines, stations | `addLines`, `addCircles` | Metro, RER, train and tram rides in their line colors, the stations they serve (transit mode only) |
| Basemap labels | | Streets, places, points of interest and their icons |
| Zone mask | `addFills` | The world with the region as a hole, darkened |
| Closed sections | `addLines`, `addCircles`, `addSymbols` | Red dashes, a cross halfway, and the section under the cursor in cut mode (`features/cuts/cutLayer.ts`) |
| Trip | `addLines` | The path to the pinned point: a white casing and an indigo line, a color no travel time has |

The last four are moved over the basemap's labels with `layer.moveBefore(undefined)`.

## The network layer

`features/map/network.ts` turns the network of the region into what `addNetwork` takes:

| Data | Content | Sent |
|---|---|---|
| `nodes` | longitude and latitude of every node (from the zone's Mercator metres) | once per region |
| `edges` | node A, node B of every edge | once per region |
| `lines` | the points of every edge, from A to B (boardings and alightings have none) | once per region |
| `edgeWidths` | a width factor per edge: 1.8 for metro, RER, train and tram rides | once per region |
| `costs` | per edge, the seconds from A along it, then from B (`Infinity`: not travelled in this profile) | on profile change (`setCosts`) |
| values | the time of every node, seconds (`setValues`) | every run |

The engine cuts every edge into pieces along its line, one GPU instance each, and keeps them on the graphics card. A
new profile (mode, direction, hour, bus, cuts) sends only new costs; a run sends only the node times, one float per
node in one texture upload. A GeoJSON layer with a data-driven color would need a new `setData` (serialisation,
tiling, upload) for every mouse move: hundreds of milliseconds on millions of pieces.

**Only the pieces in view are drawn.** The engine sorts them by square of a grid over the network and draws, each
frame, the squares under the view's footprint on the ground. The rendering figures panel shows both counts (pieces
held, pieces drawn).

**The time at a point of an edge** is worked out per pixel, from the costs:

```
t = min(time[A] + cost from A to this point, time[B] + cost from B to this point)
```

so a long edge reached from both sides shows where the two fronts meet, not a flat color. An unreached node is sent
as `1e30`, not `Infinity`: some drivers (Chrome on Linux, ANGLE over OpenGL) read an infinite float back from a texture
as 0. With no street within reach of the cursor (a mountain top, the sea), every node is sent unreached and the
network stays drawn in grey.

## Style

| Setting | Value | Effect |
|---|---|---|
| `width` | 1.2 px at zoom 12.1 to 5 px at 15.5 | crisp lines, at `opacity` 0.75 |
| `halo` | 8 px at zoom 9.5, 16 at 11, 46 at 12, 10 at 16 | a wide, faint pass under the lines (`haloOpacity` 0.11): overlapping streets add up and fill the blocks, the heat map effect; it narrows as the streets spread apart on screen |
| `ramp` | `RAMP_STOPS` (`shared/colors.ts`) | the color of `t / max`, from green to purple |
| `max` | the max time of the settings | beyond it, a thin grey line (`unreachedColor`): the network stays visible past the reach |
| `fade` | 0.1 | colors fade out over the last tenth before `max` |

The map stops zooming out at 55 km across (`WIDEST_VIEW_METRES`, `features/map/camera.ts`): the minimum zoom is
computed from the width of the map and its latitude, and again when the window is resized (`resize` event). Further
out, the halo of hundreds of thousands of streets would merge into one solid patch of color, and every frame would
draw the whole region for nothing.

## 3D views

- **3D buildings** (the default view), `features/buildings/buildings.ts`, drawn under the network. A worker
  (`building.worker.ts`) downloads the BD TOPO vector tiles of the Géoplateforme (zoom 15, layer `batiment`) and reads
  their polygons (`buildingMesh.ts`), with the BD TOPO `hauteur` of each building and its middle; the engine extrudes
  them (`ExtrusionLayer.setTile`). Each building is then joined once to its nearest street (`TravelEngine.anchor`: the
  two ends of the street and the seconds from each, walk included), sent with `setAnchors`. The layer is linked to the
  network (`linkNetwork`): the graphics card reads the times of those two nodes in the network's values, so the
  buildings follow the cursor at every move with no work on the page. Anchors are computed again when the profile
  changes (about 5 ms a tile); at most 24 tiles around the centre of the view, 48 kept. A tile the Géoplateforme
  answers with an error is asked again three times by the worker (after 0.4, 1.2 and 3 s, past the HTTP cache), then
  4 s later by the page, even if the map does not move.
- The cursor keeps pointing at the ground: the map that follows the mouse and the cuts work the same in 3D.

## Precision

The engine works in 64-bit floats on the CPU and sends the graphics card positions in 32-bit floats relative to the
camera: no jitter at high zoom. geo-reach keeps its own coordinates in Web Mercator metres relative to the zone's
origin (`net.origin`) and converts them to longitudes and latitudes for the map only.

## Frame scheduling

isard calls the `hover` listeners in the frame it draws, before drawing. `MapView` starts the engine run for the
cursor right there, unless a run is under way (the latest position then waits, and starts as soon as that run comes
back). A result calls `setValues` (one texture upload). However fast the mouse moves, there is one run at a time and
at most one upload per frame. The predecessors (to trace a trip) are copied out of the engine only when a point is
pinned.

**Short runs on the main thread, long ones in the worker.** Through the worker, the times of a move came back about 8
ms later (for a 1 ms run: copies, layout for the texture, messages), after the frame of that move had started drawing:
they showed one frame later, 25 to 28 ms after the move. The page holds a second instance of the engine
(`routing/engineCore.ts`, the same code as the worker's): when the last run took less than 4 ms, the next one is made
synchronously in the hover listener, before the frame, which then draws its times. Longer runs (a car over 60 min,
15–20 ms) stay in the worker, so that the map never freezes; the first run after a change of mode, hour or max time
always goes there, to measure it. With closed sections (two runs side by side) the worker is used too. The rendering
figures panel tells where the last run was made.

| Île-de-France, cursor to screen (p50 / p95), measured on the former MapLibre map | Before | After |
|---|---|---|
| Transit, 30 min (run 1 ms, on the main thread) | 27 / 45 ms | 9 / 13 ms |
| Car, 60 min (run 17 ms, in the worker) | | 49 / 63 ms |

The cost: the graph of the profile is held twice (worker and page), a few tens of megabytes.

The engine worker also lays the times out (unreached nodes at `1e30`, for the reason given above), so the page sends
the buffer it receives as it is: nothing on the main thread walks every node of the region at each move.

## Measuring a stutter

The pulse button of the map controls opens the rendering figures (`features/perf/PerfPanel.tsx`, measures in
`shared/perf.ts`, recorded only while it is open). Over the last 3 s:

| Row | What it tells |
|---|---|
| Map frame | ms between two frames: 16.7 at 60 Hz; tall bars in the top chart are hitches |
| Color update | ms between two results shown: the network recolored; bottom chart |
| Engine run, round trip | the run in the worker, and from the cursor sent to its times back (queue, transfer) |
| Main thread / update | what the page does with a result: times sent, panels, trip |
| Map frame (CPU) | CPU time of a whole frame of the map (`render` event): basemap, network, buildings, labels; the GPU time itself is not measured |
| Building tile (CPU), Building tile | a tile of buildings handed to the map; its buildings joined to their streets, on the main thread |
| Cursor → screen | from a mouse move to the frame showing its times |
| Long task | the main thread busy over 50 ms in one go (Chromium only) |

A line under the table names the likely cause (main thread, engine, basemap tiles, graphics card), and the panel shows
the graphics card the browser uses: on a laptop with two, the integrated one is often picked. "Copy" puts the figures
in the clipboard as JSON.

What it found (2026-10-15, Île-de-France, transit, zoom 15.6 in 3D, on the former MapLibre map): every result
re-rendered the whole React tree (the settings panel too), and two passes over every node ran on the main thread
(Infinity clamped for the texture, a copy for the isochrone lines). In development mode this made 55 ms long tasks and
colors updated every 70 ms; the panels that do not show the cursor's figures are now memoized and the clamp is done by
the worker: main thread work per result went from 5–8 ms to 0.2 ms, colors update every 30–45 ms, frames at 16–18 ms.
The black isochrone lines are gone since: traced by a worker, then tiled again and their labels placed at every
update, they cost frames, and read oddly over mountains where the streets follow the valleys.

Changing region froze the map for about 7 s in all (Auvergne-Rhône-Alpes, 5 million segments): decoding, transit
grafted on the roads, snap index, segments, all on the main thread. The network worker (`routing/network.worker.ts`)
now downloads, decodes, grafts and builds the first profile and its snap index. A change of mode sends new costs to
the network layer, its geometry kept on the graphics card.

## From MapLibre to isard

Until October 2026 the map was MapLibre GL JS, with two WebGL layers of our own hosted as custom layers (the network
renderer and the buildings) and a worker that cut the network into segments at each new profile. The branch `isard`
(2026-10-16) moved it onto isard; measured on an Intel integrated GPU, same scenario:

| | MapLibre | isard |
|---|---|---|
| Ready (startup screen gone) | 8.5–9.9 s | 6.7–8.4 s |
| Frame p95 while the cursor sweeps the map | 30–37 ms | 18–35 ms |
| Downloaded | 1.25 MB of JavaScript + a 508 KB worker | 285 KB of JavaScript + 654 KB of WebAssembly |
| Page memory | ~375 MB (the segments in a worker, not counted) | ~555 MB (159 MB of WebAssembly) |

Since isard 0.5, a map without 3D Tiles loads the engine without them: 235 KB of WebAssembly gzipped instead of 399 KB.
