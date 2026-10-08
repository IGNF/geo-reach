import { EDGE_ALIGHT, EDGE_BOARD, EDGE_LINK, EDGE_RIDE, type Line, type Network } from './network';
import type { PathStep } from './travelEngine';

export interface Leg {
  kind: 'walk' | 'drive' | 'wait' | 'ride';
  /** Street name, or line name */
  label: string;
  seconds: number;
  metres: number;
  line?: Line;
  /** Ride: first and last stop */
  from?: string;
  to?: string;
}

/** Path edges grouped into the legs of the trip panel: a street, a wait, a ride on one line */
export const toLegs = (net: Network, steps: PathStep[], driving: boolean): Leg[] => {
  const legs: Leg[] = [];
  for (const { edge, cost } of steps) {
    const kind = net.edgeKind[edge];
    if (kind === EDGE_ALIGHT) {
      const last = legs.at(-1);
      if (last) last.seconds += cost;
      continue;
    }
    const nameId = net.edgeName[edge];
    if (kind === EDGE_RIDE || kind === EDGE_BOARD) {
      const line = net.lines[nameId];
      const legKind = kind === EDGE_RIDE ? 'ride' : 'wait';
      const last = legs.at(-1);
      if (last?.kind === legKind && last.line === line) {
        last.seconds += cost;
        last.to = net.stopNames.get(net.edgeB[edge]) ?? last.to;
      } else
        legs.push({
          kind: legKind,
          label: line?.name ?? '',
          seconds: cost,
          metres: 0,
          line,
          from: net.stopNames.get(net.edgeA[edge]),
          to: net.stopNames.get(net.edgeB[edge]),
        });
      continue;
    }
    const label = kind === EDGE_LINK ? '' : nameId === 0xffffffff ? '' : net.names[nameId];
    const legKind = driving ? 'drive' : 'walk';
    const last = legs.at(-1);
    if (last?.kind === legKind && (last.label === label || !label || !last.label)) {
      last.seconds += cost;
      last.metres += net.edgeLength[edge];
      if (!last.label) last.label = label;
    } else legs.push({ kind: legKind, label, seconds: cost, metres: net.edgeLength[edge] });
  }

  return legs;
};
