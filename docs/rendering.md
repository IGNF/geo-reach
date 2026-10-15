# Rendering

Code: `web/src/features/map/networkRenderer.ts`, which draws with WebGL 2 straight into the map canvas, whatever
library hosts it: `networkLayer.ts` wraps it as a MapLibre
[custom layer](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/), between the basemap
shapes and its labels. The renderer only needs a WebGL 2 context, a matrix and a zoom: another map library could host
it.

Every upload (geometry, node times) happens while the host draws, never in between: map libraries cache the WebGL
state (bound buffers and textures), and a change made outside their frame would go unnoticed. The pixel unpacking
settings are set for the upload and given back for the same reason. Unreached nodes are stored as `1e30`, not
`Infinity`: some drivers (Chrome on Linux, ANGLE over OpenGL) read an infinite float back from a texture as 0.

## Why a custom layer

A GeoJSON layer with a data-driven color would need a new `setData` (serialisation, tiling in a worker, upload) for
every mouse move: hundreds of milliseconds on ~500 k segments. Here the geometry is uploaded **once per profile**,
and a move only uploads one float per node.

## Buffers

| GPU data | Content | Uploaded |
|---|---|---|
| Corner buffer | 6 vertices of a unit quad (2 triangles) | once |
| `a_seg` (instanced) | segment start and end, Mercator 0..1 relative to the origin | on profile change |
| `a_nodes` (instanced) | node A, node B of the edge, style (1 = rail line, drawn wider) | on profile change |
| `a_cost` (instanced) | cost to reach the segment start / end from A and from B | on profile change |
| `u_times` texture (`R32F`, 2048 × n) | time of every node, seconds | every run |
| `u_ramp` texture (256 × 1) | color ramp, `shared/colors.ts` | once |

Each road or ride segment is one instance: `drawArraysInstanced(TRIANGLES, 0, 6, segments)`.

The segments are built by a worker (`segments.worker.ts`, from `networkSegments.ts`) at each new profile: several
million for a large region, a second of work the map would otherwise freeze for. The network drawn so far stays
until they arrive.

**Only the segments in view are drawn.** They are sorted by square of the region (256 along its longer side, about
2 km for the largest), and each frame works out the footprint of the view on the ground (the four corners of the
screen cast on it from the inverse of the matrix; on a tilted map a corner above the horizon stops at the far plane).
The squares under it, plus one of margin, are drawn row by row: WebGL 2 has no base instance, so the instanced
attributes are pointed at the first segment of each run. In Lyon at zoom 15.6 in 3D: 22,000 segments drawn of 5.2
million, where an integrated graphics card was drawing frames of 100 ms or more. The panel of rendering figures shows
both counts.

With no street within reach of the cursor (a mountain top, the sea), the network stays drawn, in grey, unreached.

## Shader logic

Vertex shader, per segment end:

```
t = min(time[A] + cost from A to this end, time[B] + cost from B to this end)
```

so a long edge reached from both sides shows the meeting point of the two fronts, not a flat color. The quad is
extruded in screen space (`u_width` pixels) along the segment normal.

Fragment shader:

- `t > scale`: the soft pass is discarded, the line pass draws a thin grey line (the network still visible beyond
  the reach).
- otherwise the color comes from the ramp at `t / scale`; alpha fades towards the sides of the quad.

## Two passes

1. **Glow**: wide (10–46 px depending on the zoom), alpha 0.11, quadratic falloff. Overlapping streets add up and
   fill the blocks: this is the heat map effect.
2. **Lines**: 1.2–5 px, alpha 0.75, crisp edges.

Blending is premultiplied (`ONE, ONE_MINUS_SRC_ALPHA`), depth test off.

The map stops zooming out at 55 km across (`WIDEST_VIEW_METRES`, `features/map/camera.ts`): the minimum zoom is
computed from the width of the map and its latitude, and again when the window is resized. Further out, the glow
of hundreds of thousands of streets would merge into one solid patch of color, and every frame
would draw the whole region for nothing.

## 3D views

- **3D buildings** (the default view): a second custom layer (`features/buildings/buildingGlLayer.ts`), drawn under the network
  with a depth test. A worker (`features/buildings/building.worker.ts`) downloads the BD TOPO vector tiles of the Géoplateforme
  (zoom 15, layer `batiment`) and extrudes them (`features/buildings/buildingMesh.ts`): one wall quad per edge, shaded by the
  direction it faces, and a flat roof triangulated with earcut, at the BD TOPO `hauteur`. Each building is then
  joined once to its nearest street (`TravelEngine.anchor`: the two ends of the street and the seconds from each,
  walk included), in an RGBA32F texture per tile; the vertex shader reads the times of those two nodes in the
  network's time texture, so the buildings follow the cursor at every move with no work on the page. Anchors are
  computed again when the profile changes (about 5 ms a tile); at most 24 tiles around the centre of the view, 48
  kept on the graphics card (about 1.5 MB a tile).
- The cursor keeps pointing at the ground: the map that follows the mouse and the cuts work the same in 3D. The
  custom layer has no depth test: the streets are drawn in their order, which reads well at a 45° tilt.

## Precision

MapLibre gives `defaultProjectionData.mainMatrix` for Mercator 0..1 coordinates. The layer folds the zone origin
into the translation column of that matrix on the CPU, in 64 bit floats, then sends a 32 bit matrix. The vertices
stay small (relative to the zone centre), so there is no jitter at high zoom.

## Frame scheduling

`MapView` never draws from the mouse handler: it stores the cursor and starts the engine run for it right away, unless
a run is under way (the latest position then waits, and starts as soon as that run comes back). A result calls
`setTimes` (one `texSubImage2D`) and `triggerRepaint`. However fast the mouse moves, there is one run at a time and at
most one upload per frame. The predecessors (to trace a trip) are copied out of the engine only when a point is
pinned.

**Short runs on the main thread, long ones in the worker.** Through the worker, the times of a move came back about 8
ms later (for a 1 ms run: copies, layout for the texture, messages), after the frame of that move had started drawing:
they showed one frame later, 25 to 28 ms after the move. The page holds a second instance of the engine
(`routing/engineCore.ts`, the same code as the worker's): when the last run took less than 4 ms, the next one is made
synchronously in the mouse handler, before the frame, which then draws its times. Longer runs (a car over 60 min,
15–20 ms) stay in the worker, so that the map never freezes; the first run after a change of mode, hour or max time
always goes there, to measure it. With closed sections (two runs side by side) the worker is used too. The rendering
figures panel tells where the last run was made.

| Île-de-France, cursor to screen (p50 / p95) | Before | After |
|---|---|---|
| Transit, 30 min (run 1 ms, on the main thread) | 27 / 45 ms | 9 / 13 ms |
| Car, 60 min (run 17 ms, in the worker) | | 49 / 63 ms |

The cost: the graph of the profile is held twice (worker and page), a few tens of megabytes.

The engine worker also lays the times out for the texture (rows of 2048, unreached nodes at `1e30`, for the reason
given at the top of this page), so the page uploads the buffer it receives as it is: nothing on the main thread walks
every node of the region at each move.

## Measuring a stutter

The pulse button of the map controls opens the rendering figures (`features/perf/PerfPanel.tsx`, measures in
`shared/perf.ts`, recorded only while it is open). Over the last 3 s:

| Row | What it tells |
|---|---|
| Map frame | ms between two frames: 16.7 at 60 Hz; tall bars in the top chart are hitches |
| Color update | ms between two results shown: the network recolored; bottom chart |
| Engine run, round trip | the run in the worker, and from the cursor sent to its times back (queue, transfer) |
| Main thread / update | what the page does with a result: upload prepared, panels, trip |
| Network, buildings layer | CPU time of the custom layers per frame (the GPU time itself is not measured) |
| Building tile | a tile of buildings joined to its streets, on the main thread |
| Cursor → screen | from a mouse move to the frame showing its times |
| Long task | the main thread busy over 50 ms in one go (Chromium only) |

A line under the table names the likely cause (main thread, engine, basemap tiles, graphics card), and the panel shows
the graphics card the browser uses: on a laptop with two, the integrated one is often picked. "Copy" puts the figures
in the clipboard as JSON.

What it found (2026-10-15, Île-de-France, transit, zoom 15.6 in 3D): every result re-rendered the whole React tree
(the settings panel too), and two passes over every node ran on the main thread (Infinity clamped for the texture,
a copy for the isochrone lines). In development mode this made 55 ms long tasks and colors updated every 70 ms; the
panels that do not show the cursor's figures are now memoized and the clamp is done by the worker: main thread work
per result went from 5–8 ms to 0.2 ms, colors update every 30–45 ms, frames at 16–18 ms. The black isochrone lines
are gone since: traced by a worker, then tiled again and their labels placed by MapLibre at every update, they cost
frames, and read oddly over mountains where the streets follow the valleys.

Changing region froze the map for about 7 s in all (Auvergne-Rhône-Alpes, 5 million segments): decoding, transit
grafted on the roads, snap index, segments, all on the main thread. The network worker (`routing/network.worker.ts`)
now downloads, decodes, grafts and builds the first profile and its snap index, and the segments worker builds the
segments: about 1 s of main thread work is left, in pieces of 0.1 to 0.4 s (the upload of the segments to the
graphics card the largest). A change of mode leaves about 0.5 s (profile, snap index of the new mode, upload).
