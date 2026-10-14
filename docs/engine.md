# Travel time engine

Code: `crates/engine/src/lib.rs` (Rust, WebAssembly) and `web/src/features/routing/` (networks, profiles, snapping, the engine workers).

## Graph model

The network is one graph made of road nodes plus, when the region has a transit file, transit nodes appended after
them.

```mermaid
flowchart LR
  R1((road node)) -- "LINK (walk ≤ 250 m)" --- S((station))
  S -- "BOARD (wait)" --> LS1((line stop<br/>line 1, dir 0))
  LS1 -- "ALIGHT (30 s)" --> S
  LS1 -- "RIDE (median time)" --> LS2((next line stop<br/>same line))
  LS2 -- ALIGHT --> S2((next station))
```

| Edge kind (`network.ts`) | From → to | Cost |
|---|---|---|
| `EDGE_ROAD` | road node ↔ road node | Length / speed, depends on the mode and on BD TOPO flags |
| `EDGE_LINK` | station ↔ 3 nearest walkable road nodes | Walking time (min 20 m) |
| `EDGE_BOARD` | station → line stop | Wait: half the headway up to a 10 min headway, then a third of each extra minute (see below) + 60 s boarding penalty |
| `EDGE_RIDE` | line stop → next line stop | Median scheduled ride time |
| `EDGE_ALIGHT` | line stop → station | 30 s |

A *line stop* is one (line, direction, station). Splitting the station from the line stops is what makes
transfers cost a new wait: staying on the same line follows `RIDE` arcs only, changing line goes through
`ALIGHT` → station → `BOARD`.

## Costs per mode (`profile.ts`)

| Mode | Roads | Transit edges |
|---|---|---|
| `pedestrian` | 4 km/h on the flat (same as the GPF route service), Tobler's function on slopes, ×2 on stairs; motorways and ramps excluded | ignored |
| `bike` | 15 km/h on the flat, ×1.1 on cycle lanes and greenways, ×0.65 on unpaved paths, slowed down uphill; one-way streets respected except contraflow cycle lanes | ignored |
| `car` | BD TOPO average speed × traffic factor of the hour + 3 s per section, one-way streets respected | ignored |
| `transit` | as pedestrian | all, bus edges only if the bus toggle is on; wait and ride time of the chosen hour |

**Slopes** (`ModelOptions.relief`, on by default): each road edge knows its climb and descent from A to B
(`edgeClimb`, `edgeDescent`), so the two directions get different costs. Only totals are stored: the climbing and
descending parts are assumed to share the length in proportion to their heights, at one grade
`(climb + descent) / length`, capped at 25 % (beyond, it is a bump of the terrain on a short edge). Time factors on
those parts:

| | Uphill, grade g | Downhill, grade g |
|---|---|---|
| walk | `exp(3.5 × (abs(g + 0.05) − 0.05))` (Tobler): ×1.19 at 5 %, ×1.42 at 10 % | same with −g: ×0.84 at 5 % (fastest), ×1 at 10 %, slower beyond |
| bike | `1 / max(1 − 6.67 g, 1/3)` (Parkin and Rotheram): ×1.5 at 5 %, ×3 from 10 % | `1 / min(1 + 3.98 g, 1.4)`: ×0.83 at 5 %, at most 40 % faster |

The bike factors come from the GPS tracks of everyday cyclists in Leeds (Parkin and Rotheram 2010,
[doi:10.1016/j.tranpol.2010.03.001](https://doi.org/10.1016/j.tranpol.2010.03.001)): 21.6 km/h on the flat, 1.44 km/h
less per percent uphill, 0.86 km/h more per percent downhill, kept here as shares of the chosen flat speed. Walking
follows Tobler's hiking function (Tobler 1993, NCGIA technical report 93-1), scaled to 1 on the flat.

**Transit waits** (`averageWait`): the files store half the headway `H/2` of each hour (capped at 12 min, see
[data-formats.md](data-formats.md)). Random arrivals wait `H/2` (Osuna and Newell 1972,
[doi:10.1287/trsc.6.1.52](https://doi.org/10.1287/trsc.6.1.52)); on less frequent lines more and more passengers
follow the timetable (Ingvardson et al. 2018, [doi:10.1016/j.trc.2018.03.006](https://doi.org/10.1016/j.trc.2018.03.006):
the switch happens between 5 and 11 min), and each extra minute of headway adds about a third of a minute of wait
(Singh et al. 2021, [doi:10.1016/j.trc.2021.103267](https://doi.org/10.1016/j.trc.2021.103267)). Hence
`W = H/2` up to `H = 10 min`, then `W = 5 min + (H − 10 min) / 3`: 8.3 min instead of 10 for a bus every 20 min. The
worst case setting keeps the whole headway `H`.

Cars ignore slopes. The trip panel sums the climb and descent of the path, each edge in its direction of travel.

The **hour of departure** (`ProfileOptions.hour`, 0–23) drives two things:

- car: `TRAFFIC` in `profile.ts` keeps a share of the free-flow speed per hour, one curve for major roads (BD TOPO
  importance 1–3) and one for local streets (e.g. 42 % / 60 % at 8 am). A typical congestion curve, not live traffic;
- transit: each boarding and ride reads its value for that hour from `hourCosts`; a line with no departure that hour
  has an infinite wait, so it is not used.

Each edge gets two costs, `fwd` (A→B) and `bwd` (B→A), `Infinity` when forbidden. The engine only sees arcs, so
`buildProfile` turns them into a compressed sparse row graph (CSR):

```
offsets[n] .. offsets[n+1]   arcs leaving node n
heads[arc]                   arrival node
costs[arc]                   seconds
arcEdge[arc]                 source edge, to rebuild the path and its geometry
```

For an **arrival**, every arc is reversed while building the CSR: one Dijkstra from the point then gives, for each
node, the time to reach the point.

**Closed sections** (`cuts.ts`, a what-if set from the map): a metro, RER, train or tram line between two neighbouring
stations (its rides both ways), or one BD TOPO road section (every mode). Their edges get `Infinity` both ways, so they
leave the CSR and the snap index; the engine itself is unchanged. Rebuilding the profile takes about 120 ms for the
whole region. In the URL a cut is `r<line>.<station>.<station>` (indexes of the region's transit file) or `s<edge>` (index in its road file):
a link stays valid as long as the data files do. An express ride that skips the closed stations is not cut.

While sections are closed, `TravelEngine` keeps a **baseline**: the same profile with everything open, in a second
worker (rebuilt only when the mode, hour, direction or model change). Each run is sent to both workers with the same
start points; `cutImpact` then compares the two results on the rail stations reached within the limit with everything
open. In cut mode the origin of the map stays fixed (the pinned point, else the last cursor position), so that the
figure does not follow the clicks.

## Dijkstra in WebAssembly

`crates/engine` exposes raw C functions, without `wasm-bindgen`:

| Export | Role |
|---|---|
| `reserve(nodes, arcs, sources)` | Allocates every buffer (once per profile) |
| `offsets_ptr()`, `heads_ptr()`, … | Pointer of each buffer in the WASM memory; JS writes the graph there |
| `run(sources, max_cost)` | Bounded multi-source Dijkstra, returns the number of settled nodes |
| `dist_ptr()`, `pred_node_ptr()`, `pred_edge_ptr()` | Results, read by JS as typed array views |

Implementation details that matter for speed:

- **Bounded**: a node is never pushed beyond `max_cost` (the scale, e.g. 30 min). The search stops by itself.
- **Lazy reset**: `touched` lists the nodes reached last time; only those are reset to `Infinity` before the next
  run, instead of the whole array (~100 k road nodes, ~30 k more with transit).
- **No decrease-key**: a node improved again is pushed again and its stale entry skipped when popped, which is faster
  in practice than a heap with decrease-key (Chen et al. 2007, UTCS TR-07-54).
- **Heap key** `(f32 bits, node)`: non-negative floats order like their bit patterns, so a `u32` comparison is
  enough.
- **No allocation** in `run`: the heap and `touched` keep their capacity.
- After `reserve`, JS recreates its views on `memory.buffer`, because growing the memory detaches old views.

Measured with `bun scripts/benchEngine.ts [region]` (engine alone, 300 cursor positions in a 30 km square around
the IGN head office, Île-de-France, 2026-10-14): median 0.2 ms walking 30 min, 1.5–2 ms by bike or car 30 min,
10–13 ms in transit 60 min (p95 33–41 ms).

**Node order** (tested, not kept): renumbering the nodes along a Hilbert curve, or breadth-first, so that neighbours sit
next to each other in memory, is a classic speed-up of Dijkstra on road graphs. Here it gains 1 to 5 %, within the
noise of the measure: the files already list the nodes tile by tile of the WFS download, which is spatially local.
`--order hilbert|hilbert-all|bfs` of the bench reproduces the test in memory.

## From the cursor to the graph (`snap.ts`)

The cursor can be anywhere (a park, a roof). `SnapIndex` is a uniform grid (80 m cells) of the road segments the
mode can use. `nearest(x, y)` scans rings of cells around the cursor and projects the point on each segment. It
returns the edge, the fraction `f` along it, the distance and the projected point. Beyond 600 m, the cursor is off
the network.

`TravelEngine.run` then seeds Dijkstra with **two sources**, the two ends of the snapped edge:

```
cost(A) = access walk + f × cost of the edge towards A
cost(B) = access walk + (1 − f) × cost of the edge towards B
```

The access walk (cursor → street) is always at walking speed, including in car mode.

## Pinned point: time and path to the cursor

With a pinned origin, `timeAt` snaps the cursor and takes the best of its two edge ends (`dist[A] + f × …`,
`dist[B] + (1 − f) × …`), plus the walk to the cursor. No new Dijkstra.

`path` walks back `predNode` / `predEdge` from that node, and `legs.ts` groups the edges into the trip panel legs:
consecutive streets of the same name, one wait per boarding, one ride per line (from the first to the last stop).

## Statistics

- `stationShare`: share of the metro, RER, train and tram stations (`railStations`) reached within each contour.
- `reachedKm`: kilometres of road whose two ends are reached within each contour.
- `reachedTransit`, `nearestStation`: stations and lines one can board, first rail station reached.
- `cyclewayKm`: kilometres of cycle lanes and greenways reached.
- `cutImpact`: with closed sections, the rail stations within reach with everything open, and the delay of each
  (Infinity: now beyond the limit); the panel counts those losing more than 5 min.

## Coordinates

Everything is stored in Web Mercator metres **relative to the centre of the zone** (`origin` in the region's road file). With
absolute Mercator values (~260 000 m, ~6 250 000 m) a 32 bit float has a step of about 0.5 m; relative to the centre,
it stays under a millimetre. Ground distances use the scale factor `cos(latitude)` of the zone centre.

## Calibration

`bun scripts/calibrate.ts [--gpf] [--transit]` draws random trips on the real graph and prints the effective speed per
mode and hour; `--gpf` compares night driving with the Géoplateforme route service (free flow; about 15 % apart),
`--transit` lists transit times from the IGN head office to the landmarks.
