import type { FlowDiagramEdge, FlowDiagramGroup, FlowDiagramNode, FlowDiagramTone } from '@ign-junn/design-system';
import {
  IconBinary,
  IconBrandRust,
  IconBuilding,
  IconBus,
  IconCpu,
  IconFileCode,
  IconGridDots,
  IconMap,
  IconMapPin,
  IconMountain,
  IconRoad,
  IconRoute,
  IconScale,
  IconScissors,
  IconSettings,
} from '@ign-junn/design-system/icons';
import { howItWorks as h, type StepId } from '@/locales/howItWorks';

/** The pipeline diagram of the "How it works" page: its boxes, groups and links */

/**
 * Place, color and icon of each box of the pipeline. The Géoplateforme services used online sit in the browser group,
 * next to the boxes they feed (their color says where they come from): every link then stays short and runs the same
 * way, from the data to the screen.
 */
const BOXES: { id: StepId; parent: 'offline' | 'browser'; tone: FlowDiagramTone; icon: FlowDiagramNode['icon'] }[] = [
  { id: 'wfs', parent: 'offline', tone: 'primary', icon: IconRoad },
  { id: 'gtfs', parent: 'offline', tone: 'neutral', icon: IconBus },
  { id: 'relief', parent: 'offline', tone: 'primary', icon: IconMountain },
  { id: 'buildGraph', parent: 'offline', tone: 'warning', icon: IconBrandRust },
  { id: 'gtfsPrep', parent: 'offline', tone: 'warning', icon: IconBrandRust },
  { id: 'graphBin', parent: 'offline', tone: 'neutral', icon: IconBinary },
  { id: 'transitBin', parent: 'offline', tone: 'neutral', icon: IconBinary },
  { id: 'engineCrate', parent: 'offline', tone: 'warning', icon: IconBrandRust },
  { id: 'wasm', parent: 'offline', tone: 'warning', icon: IconBinary },
  { id: 'loaders', parent: 'browser', tone: 'accent', icon: IconFileCode },
  { id: 'profile', parent: 'browser', tone: 'accent', icon: IconSettings },
  { id: 'cuts', parent: 'browser', tone: 'accent', icon: IconScissors },
  { id: 'snap', parent: 'browser', tone: 'accent', icon: IconGridDots },
  { id: 'dijkstra', parent: 'browser', tone: 'warning', icon: IconCpu },
  { id: 'layer', parent: 'browser', tone: 'success', icon: IconCpu },
  { id: 'buildings', parent: 'browser', tone: 'success', icon: IconBuilding },
  { id: 'panel', parent: 'browser', tone: 'accent', icon: IconRoute },
  { id: 'compare', parent: 'browser', tone: 'accent', icon: IconScale },
  { id: 'tiles', parent: 'browser', tone: 'primary', icon: IconMap },
  { id: 'buildingTiles', parent: 'browser', tone: 'primary', icon: IconBuilding },
  { id: 'route', parent: 'browser', tone: 'primary', icon: IconRoute },
  { id: 'geocode', parent: 'browser', tone: 'primary', icon: IconMapPin },
];

export const isStepId = (id: string): id is StepId => BOXES.some((b) => b.id === id);

const e = h.diagram.edges;
export const EDGES: FlowDiagramEdge[] = [
  { from: 'wfs', to: 'buildGraph' },
  { from: 'relief', to: 'buildGraph', label: e.slopes },
  { from: 'buildGraph', to: 'graphBin' },
  { from: 'gtfs', to: 'gtfsPrep' },
  { from: 'wfs', to: 'gtfsPrep', label: e.tracks, dashed: true },
  { from: 'graphBin', to: 'gtfsPrep', label: e.zone, dashed: true },
  { from: 'gtfsPrep', to: 'transitBin' },
  { from: 'engineCrate', to: 'wasm', label: e.cargo },
  { from: 'graphBin', to: 'loaders', label: e.loaded },
  { from: 'transitBin', to: 'loaders' },
  { from: 'loaders', to: 'profile' },
  { from: 'loaders', to: 'compare', label: e.networkCopy },
  { from: 'compare', to: 'panel', label: e.fourModes },
  { from: 'cuts', to: 'profile', label: e.closed },
  { from: 'profile', to: 'dijkstra', label: e.csr },
  { from: 'snap', to: 'dijkstra', label: e.sources },
  { from: 'wasm', to: 'dijkstra', label: e.instance, dashed: true },
  { from: 'dijkstra', to: 'layer', label: e.times },
  { from: 'dijkstra', to: 'panel', label: e.path },
  { from: 'layer', to: 'buildings', label: e.sameTimes },
  { from: 'buildingTiles', to: 'buildings', label: e.extruded },
  { from: 'tiles', to: 'layer', label: e.basemap },
  // The Géoplateforme services feed the page: every link runs the same way, from the data to the screen
  { from: 'route', to: 'panel', label: e.stop, dashed: true },
  { from: 'geocode', to: 'panel', label: e.address, dashed: true },
];

export const NODES: FlowDiagramNode[] = BOXES.map(({ id, parent, tone, icon }) => ({
  id,
  parent,
  tone,
  icon,
  label: h.diagram.boxes[id].label,
  detail: h.diagram.boxes[id].detail,
}));

export const GROUPS: FlowDiagramGroup[] = (['offline', 'browser'] as const).map((id) => ({ id, label: h.diagram.groups[id] }));

