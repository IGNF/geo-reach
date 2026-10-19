# Data

The networks the app computes on, prepared once from open data and served as they are: the browser downloads the
file of the region in view, keeps it in its cache, and reads it as typed arrays with no parsing. Byte layouts:
[docs/data-formats.md](../docs/data-formats.md).

## Files

One pair of files per region, the same for every region:

| File | What | Built by |
|---|---|---|
| `regions/<id>.bin.gz` | Road network (GRF4: nodes, edges, geometries, climb and descent, street names), gzipped | `bun run data -- <id>` |
| `regions/<id>.transit.bin.gz` | Public transport (TRN3: stations, lines, hourly waits and ride times), gzipped | `bun run transit -- <id>` |

The region ids, boxes and opening points are in [web/src/features/regions/regions.ts](../web/src/features/regions/regions.ts); each network
covers its region's box plus a 0.25° margin (about 20 km) for the trips that cross its edge. The files are inflated
by the browser (`web/src/shared/dataCache.ts`): every file stays under the 100 MB a file of GitHub. This folder sits at
the root of the repository, apart from the app: the dev server serves it under `/data/` and the build copies it into
`web/dist/data/` (plugin `region-data` of `web/vite.config.ts`).

## Regions

| Region | Roads (edges) | Roads | Public transport | Transport |
|---|---|---|---|---|
| Île-de-France | 913 k | 15.6 MB | IDFM: every network | 2.1 MB |
| Auvergne-Rhône-Alpes | 2.03 M | 40.6 MB | regional aggregate | 1.3 MB |
| Bourgogne-Franche-Comté | 1.27 M | 24.4 MB | SNCF, Divia (Dijon), Ginko (Besançon), Mobigo coaches | 0.2 MB |
| Bretagne | 1.11 M | 20.6 MB | regional aggregate | 0.8 MB |
| Centre-Val de Loire | 1.58 M | 28.4 MB | regional aggregate | 0.5 MB |
| Corse | 63 k | 1.4 MB | Chemins de fer de la Corse, Via Strada, Via Bastia, A Berlina, A Citadina | 0.1 MB |
| Grand Est | 1.30 M | 23.2 MB | regional aggregate | 1.4 MB |
| Hauts-de-France | 1.35 M | 23.0 MB | SNCF, Ilévia (Lille), Transvilles, DK’BUS, Ametis | 0.4 MB |
| Normandie | 1.04 M | 19.7 MB | regional aggregate (Twisto, Astuce, LiA, Nomad…) | 0.6 MB |
| Nouvelle-Aquitaine | 2.73 M | 52.5 MB | regional aggregate | 1.3 MB |
| Occitanie | 1.97 M | 38.8 MB | SNCF, Tisséo (Toulouse), TaM (Montpellier), Tango, Sankéo, liO coaches | 0.7 MB |
| Pays de la Loire | 1.61 M | 29.8 MB | regional aggregate | 1.3 MB |
| Provence-Alpes-Côte d’Azur | 1.05 M | 20.2 MB | SNCF, Aix-Marseille-Provence (RTM…), Lignes d’Azur (Nice), Mistral, Orizo | 1.0 MB |

Sizes of the files as stored (gzipped); Nouvelle-Aquitaine is stored with Git LFS. Where several feeds are listed, `crates/prep` merges them into one layer; a feed
that has no service on the reference day (an outdated one, like the Corsican railways) is read on the nearest same
day of the week.

## Sources and licences

| Data | Source | Licence |
|---|---|---|
| Road network, heights | IGN BD TOPO, `troncon_de_route`, Géoplateforme WFS | Licence Ouverte Etalab 2.0 |
| Rail tracks (drawing of the rides without GTFS shapes) | IGN BD TOPO, `troncon_de_voie_ferree`, Géoplateforme WFS | Licence Ouverte Etalab 2.0 |
| Timetables | Île-de-France Mobilités, aggregates of the urban and interurban networks, SNCF feed, on [transport.data.gouv.fr](https://transport.data.gouv.fr) (feeds listed in [crates/prep/src/transit/feeds.rs](../crates/prep/src/transit/feeds.rs)) | per feed, mostly Licence Ouverte or ODbL |

The `.transit` files are databases derived from these timetables, under the licence of their feed.

## Rebuilding

```sh
bun run data -- normandie     # a region's roads, about a minute (WFS pages cached in .cache/bdtopo-z/)
bun run transit -- normandie  # its public transport (feed cached in .cache/gtfs/), needs cargo
bun run transit -- all        # every region's public transport
```

On the IGN network, set `HTTPS_PROXY=http://proxy.ign.fr:3128`. A region's transport layer depends on its road
network (its origin and box): rebuild it after the roads.
