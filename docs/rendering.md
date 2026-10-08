# Rendering

Code: `web/src/map/networkLayer.ts`, a MapLibre [custom layer](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/)
that draws with WebGL 2 straight into the map canvas, between the basemap shapes and its labels.

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
| `u_ramp` texture (256 × 1) | color ramp, `lib/colors.ts` | once |

Each road or ride segment is one instance: `drawArraysInstanced(TRIANGLES, 0, 6, segments)`.

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
- contour fronts (`u_contours`, up to 4 durations) are drawn in black where `t` crosses them.

## Two passes

1. **Glow**: wide (10–46 px depending on the zoom), alpha 0.11, quadratic falloff. Overlapping streets add up and
   fill the blocks: this is the heat map effect.
2. **Lines**: 1.2–5 px, alpha 0.75, crisp edges.

Blending is premultiplied (`ONE, ONE_MINUS_SRC_ALPHA`), depth test off.

## Precision

MapLibre gives `defaultProjectionData.mainMatrix` for Mercator 0..1 coordinates. The layer folds the zone origin
into the translation column of that matrix on the CPU, in 64 bit floats, then sends a 32 bit matrix. The vertices
stay small (relative to the zone centre), so there is no jitter at high zoom.

## Frame scheduling

`MapView` never draws from the mouse handler: it stores the cursor and calls `requestAnimationFrame` once. The frame
runs the engine for the latest position, calls `setTimes` (one `texSubImage2D`) and `triggerRepaint`. However fast
the mouse moves, there is at most one engine run and one upload per frame.
