import {
  Card,
  CodeSnippet,
  FlowDiagram,
  type FlowDiagramEdge,
  type FlowDiagramNode,
  type FlowDiagramTone,
  Grid,
  Link,
  Page,
  Stack,
  Steps,
  Typography,
} from '@ign-junn/design-system';
import {
  IconArrowLeft,
  IconBinary,
  IconBrandGithub,
  IconBrandRust,
  IconBus,
  IconCpu,
  IconFileCode,
  IconGridDots,
  IconMap,
  IconMapPin,
  IconRoad,
  IconRoute,
  IconSettings,
} from '@ign-junn/design-system/icons';
import { useState } from 'react';
import { howItWorks as h, type StepId } from '../locales/howItWorks';

const REPO = 'https://github.com/IGNF/geo-reach';

/** Place, color and icon of each box of the pipeline */
const BOXES: { id: StepId; parent: 'offline' | 'browser' | 'gpf'; tone: FlowDiagramTone; icon: FlowDiagramNode['icon'] }[] = [
  { id: 'wfs', parent: 'offline', tone: 'primary', icon: IconRoad },
  { id: 'gtfs', parent: 'offline', tone: 'neutral', icon: IconBus },
  { id: 'buildGraph', parent: 'offline', tone: 'accent', icon: IconFileCode },
  { id: 'gtfsPrep', parent: 'offline', tone: 'warning', icon: IconBrandRust },
  { id: 'graphBin', parent: 'offline', tone: 'neutral', icon: IconBinary },
  { id: 'transitBin', parent: 'offline', tone: 'neutral', icon: IconBinary },
  { id: 'engineCrate', parent: 'offline', tone: 'warning', icon: IconBrandRust },
  { id: 'wasm', parent: 'offline', tone: 'warning', icon: IconBinary },
  { id: 'loaders', parent: 'browser', tone: 'accent', icon: IconFileCode },
  { id: 'profile', parent: 'browser', tone: 'accent', icon: IconSettings },
  { id: 'snap', parent: 'browser', tone: 'accent', icon: IconGridDots },
  { id: 'dijkstra', parent: 'browser', tone: 'warning', icon: IconCpu },
  { id: 'layer', parent: 'browser', tone: 'success', icon: IconCpu },
  { id: 'panel', parent: 'browser', tone: 'accent', icon: IconRoute },
  { id: 'map', parent: 'browser', tone: 'neutral', icon: IconMap },
  { id: 'tiles', parent: 'gpf', tone: 'primary', icon: IconMap },
  { id: 'route', parent: 'gpf', tone: 'primary', icon: IconRoute },
  { id: 'geocode', parent: 'gpf', tone: 'primary', icon: IconMapPin },
];

const e = h.diagram.edges;
const EDGES: FlowDiagramEdge[] = [
  { from: 'wfs', to: 'buildGraph' },
  { from: 'buildGraph', to: 'graphBin' },
  { from: 'gtfs', to: 'gtfsPrep' },
  { from: 'graphBin', to: 'gtfsPrep', label: e.zone, dashed: true },
  { from: 'gtfsPrep', to: 'transitBin' },
  { from: 'engineCrate', to: 'wasm', label: e.cargo },
  { from: 'graphBin', to: 'loaders', label: e.loaded },
  { from: 'transitBin', to: 'loaders' },
  { from: 'loaders', to: 'profile' },
  { from: 'profile', to: 'dijkstra', label: e.csr },
  { from: 'snap', to: 'dijkstra', label: e.sources },
  { from: 'wasm', to: 'dijkstra', label: e.instance, dashed: true },
  { from: 'dijkstra', to: 'layer', label: e.times },
  { from: 'dijkstra', to: 'panel', label: e.path },
  { from: 'layer', to: 'map' },
  { from: 'tiles', to: 'map' },
  { from: 'panel', to: 'route', label: e.stop, dashed: true },
  { from: 'panel', to: 'geocode', dashed: true },
];

const NODES: FlowDiagramNode[] = BOXES.map(({ id, parent, tone, icon }) => ({
  id,
  parent,
  tone,
  icon,
  label: h.diagram.boxes[id].label,
  detail: h.diagram.boxes[id].detail,
}));

const GROUPS = (['offline', 'browser', 'gpf'] as const).map((id) => ({ id, label: h.diagram.groups[id] }));

const LEGEND = (['primary', 'warning', 'accent', 'success', 'neutral'] as const).map((tone) => ({
  tone,
  label: h.diagram.legend[tone],
}));

/** Excerpt of crates/engine/src/lib.rs */
const RUST = `while let Some(Reverse((bits, n))) = self.heap.pop() {
    let d = f32::from_bits(bits);
    if d > self.dist[n] { continue; }          // already settled, faster
    for arc in self.offsets[n]..self.offsets[n + 1] {
        let next = d + self.costs[arc];
        let head = self.heads[arc];
        if next < self.dist[head] && next <= max_cost {
            self.dist[head] = next;               // best time so far
            self.pred_node[head] = n;             // to rebuild the path
            self.heap.push(Reverse((next.to_bits(), head)));
        }
    }
}`;

/** Excerpt of web/src/engine/travelEngine.ts */
const TS = `const mem = wasm.memory.buffer;
// The two ends of the street under the cursor, with the time to reach them
new Uint32Array(mem, wasm.src_nodes_ptr(), 2).set([edgeA, edgeB]);
new Float32Array(mem, wasm.src_costs_ptr(), 2).set([toA, toB]);
wasm.run(2, maxSeconds);
// Read in place: a view on the engine memory, no copy
const dist = new Float32Array(mem, wasm.dist_ptr(), nodeCount);`;

const HowItWorks = () => {
  const [selected, setSelected] = useState<StepId>('dijkstra');
  const box = h.diagram.boxes[selected];

  return (
    <Page width="wide">
      <Stack gap="xl">
        <Stack gap="sm">
          <Stack direction="row" gap="md">
            <a className="back-link" href={import.meta.env.BASE_URL}>
              <IconArrowLeft size={16} />
              {h.backToMap}
            </a>
            <Link href={REPO} icon={IconBrandGithub}>
              {h.sourceCode}
            </Link>
          </Stack>
          <Typography variant="display">{h.title}</Typography>
          <Typography variant="lead">{h.lead}</Typography>
        </Stack>

        <Stack gap="sm">
          <Typography variant="h2">{h.diagram.title}</Typography>
          <Typography variant="hint">{h.diagram.hint}</Typography>
          <FlowDiagram
            label={h.diagram.label}
            nodes={NODES}
            groups={GROUPS}
            edges={EDGES}
            legend={LEGEND}
            labels={h.diagram.labels}
            selected={selected}
            onSelect={(id) => setSelected(id as StepId)}
          />
          <Card highlighted>
            <Stack gap="xs">
              <Typography variant="subtitle1">{box.label}</Typography>
              <Typography variant="body1">{box.text}</Typography>
              {'file' in box && box.file && (
                <Link href={`${REPO}/blob/main/${box.file}`} icon={IconFileCode} size="xs">
                  {box.file}
                </Link>
              )}
            </Stack>
          </Card>
        </Stack>

        <Stack gap="sm">
          <Typography variant="h2">{h.move.title}</Typography>
          <Steps items={h.move.steps.map((s, i) => ({ key: String(i), ...s }))} />
        </Stack>

        <Stack gap="sm">
          <Typography variant="h2">{h.why.title}</Typography>
          <Typography variant="body1">{h.why.text}</Typography>
          <Grid cols={{ base: 2, md: 4 }}>
            {h.why.stats.map((s) => (
              <Card key={s.label} fullHeight>
                <Typography variant="stat">{s.value}</Typography>
                <Typography variant="caption">{s.label}</Typography>
              </Card>
            ))}
          </Grid>
          <Grid cols={{ base: 1, lg: 2 }}>
            <Stack gap="xs">
              <Typography variant="hint">{h.why.rust}</Typography>
              <CodeSnippet code={RUST} language="text" fileName="crates/engine/src/lib.rs" copyLabel="Copy" copiedLabel="✓" />
            </Stack>
            <Stack gap="xs">
              <Typography variant="hint">{h.why.js}</Typography>
              <CodeSnippet code={TS} language="tsx" fileName="web/src/engine/travelEngine.ts" copyLabel="Copy" copiedLabel="✓" />
            </Stack>
          </Grid>
        </Stack>

        <Stack gap="sm">
          <Typography variant="h2">{h.limits.title}</Typography>
          <ul className="limits">
            {h.limits.items.map((item) => (
              <li key={item}>
                <Typography variant="body1">{item}</Typography>
              </li>
            ))}
          </ul>
          <Link href={`${REPO}/tree/main/docs`} icon={IconFileCode}>
            {h.more}
          </Link>
        </Stack>
      </Stack>
    </Page>
  );
};

export default HowItWorks;
