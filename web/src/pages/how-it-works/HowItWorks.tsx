import { Badge, Box, Card, CodeSnippet, FlowDiagram, Grid, Link, Page, Stack, Steps, Typography } from '@ign-junn/design-system';
import {
  IconArrowLeft,
  IconBrandGithub,
  IconFileCode,
} from '@ign-junn/design-system/icons';
import { useState, type ReactElement } from 'react';
import { EDGES, GROUPS, isStepId, NODES } from '@/pages/how-it-works/diagram';
import Sandbox from '@/pages/how-it-works/Sandbox';
import StepDetail from '@/pages/how-it-works/StepDetail';
import { howItWorks as h, type StepId } from '@/locales/howItWorks';
import { REPO } from '@/shared/config';

/** Legend above the diagram, as badges of the same tones (the diagram's own legend sits under it) */
const LEGEND = [
  { tone: 'primary', badge: 'primary', label: h.diagram.legend.primary },
  { tone: 'warning', badge: 'warning', label: h.diagram.legend.warning },
  { tone: 'accent', badge: 'accent', label: h.diagram.legend.accent },
  { tone: 'success', badge: 'success', label: h.diagram.legend.success },
  { tone: 'neutral', badge: 'muted', label: h.diagram.legend.neutral },
] as const;

/** Excerpt of crates/engine/src/dijkstra.rs */
const RUST = `while let Some(Reverse((bits, n))) = self.heap.pop() {
    let d = f32::from_bits(bits);
    if d > self.dist[n] { continue; }      // already settled, faster
    for arc in self.offsets[n]..self.offsets[n + 1] {
        // Keeps d + cost if it beats the best time so far and stays
        // within the maximum time, then queues the node
        self.relax(self.heads[arc], d + self.costs[arc], max_cost,
                   Some((n, self.arc_edge[arc])));
    }
}`;

/** Excerpt of web/src/features/routing/engine.worker.ts */
const TS = `const mem = wasm.memory.buffer;
// The two ends of the street under the cursor, with the time to reach them
new Uint32Array(mem, wasm.src_nodes_ptr(), 2).set(msg.sources);
new Float32Array(mem, wasm.src_costs_ptr(), 2).set(msg.costs);
wasm.run(msg.sources.length, msg.maxCost);
// One copy out of the engine memory, then handed over to the page (transfer, no copy)
dist.set(new Float32Array(wasm.memory.buffer, wasm.dist_ptr(), nodes));
self.postMessage({ id: msg.id, dist, predNode, predEdge }, [dist.buffer, predNode.buffer, predEdge.buffer]);`;

const HowItWorks = (): ReactElement => {
  const [selected, setSelected] = useState<StepId>('dijkstra');
  const box = h.diagram.boxes[selected];

  return (
    <Page width="full">
      <Stack gap="xl">
        <Box className="narrow">
        <Stack gap="sm">
          <Stack direction="row" gap="md">
            <a className="back-link" href={import.meta.env.BASE_URL}>
              <IconArrowLeft size={16} />
              {h.backToMap}
            </a>
            <Link href={REPO} icon={IconBrandGithub}>
              {h.sourceCode}
            </Link>
            <a className="back-link" href={`${import.meta.env.BASE_URL}legal.html`}>
              {h.legalNotice}
            </a>
          </Stack>
          <Typography variant="display">{h.title}</Typography>
          <Typography variant="lead">{h.lead}</Typography>
        </Stack>
        </Box>

        <Stack gap="sm">
          <Typography variant="h2">{h.diagram.title}</Typography>
          <Typography variant="strong">{h.diagram.hint}</Typography>
          <Stack direction="row" gap="xs" wrap="wrap">
            {LEGEND.map((l) => (
              <Badge key={l.tone} tone={l.badge}>
                {l.label}
              </Badge>
            ))}
          </Stack>
          <Box className="diagram-layout">
            <Box className="diagram-main">
              <FlowDiagram
                label={h.diagram.label}
                nodes={NODES}
                groups={GROUPS}
                edges={EDGES}
                direction="down"
                labels={h.diagram.labels}
                selected={selected}
                onSelect={(id) => {
                  if (isStepId(id)) setSelected(id);
                }}
                beads={3}
              />
            </Box>
            <Box className="diagram-detail">
              <Card highlighted>
                <Stack gap="xs">
                  <Typography variant="subtitle1">{box.label}</Typography>
                  <Typography variant="body1">{box.text}</Typography>
                  <StepDetail step={selected} />
                  {'file' in box && box.file && (
                    <Link href={`${REPO}/blob/main/${box.file}`} icon={IconFileCode} size="xs">
                      {box.file}
                    </Link>
                  )}
                </Stack>
              </Card>
            </Box>
          </Box>
        </Stack>

        <Stack gap="sm">
          <Typography variant="h2">{h.sandbox.title}</Typography>
          <Box className="narrow">
            <Typography variant="body1">{h.sandbox.text}</Typography>
          </Box>
          <Sandbox />
        </Stack>

        <Box className="narrow">
        <Stack gap="sm">
          <Typography variant="h2">{h.move.title}</Typography>
          <Steps items={h.move.steps.map((s, i) => ({ key: String(i), ...s }))} />
        </Stack>
        </Box>

        <Box className="narrow">
        <Stack gap="sm">
          <Typography variant="h2">{h.gpf.title}</Typography>
          <Typography variant="body1">{h.gpf.text}</Typography>
          <Grid cols={{ base: 2, md: 4 }}>
            {h.gpf.stats.map((s) => (
              <Card key={s.label} fullHeight>
                <Typography variant="stat">{s.value}</Typography>
                <Typography variant="caption">{s.label}</Typography>
              </Card>
            ))}
          </Grid>
          <Typography variant="subtitle1">{h.gpf.keptTitle}</Typography>
          <Box component="ul" className="limits">
            {h.gpf.kept.map((item) => (
              <Box component="li" key={item}>
                <Typography variant="body1">{item}</Typography>
              </Box>
            ))}
          </Box>
          <Typography variant="hint">{h.gpf.next}</Typography>
        </Stack>
        </Box>

        <Box className="narrow">
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
              <CodeSnippet code={RUST} language="text" fileName="crates/engine/src/dijkstra.rs" copyLabel="Copy" copiedLabel="✓" />
            </Stack>
            <Stack gap="xs">
              <Typography variant="hint">{h.why.js}</Typography>
              <CodeSnippet code={TS} language="tsx" fileName="web/src/features/routing/engine.worker.ts" copyLabel="Copy" copiedLabel="✓" />
            </Stack>
          </Grid>
        </Stack>
        </Box>

        <Box className="narrow">
        <Stack gap="sm">
          <Typography variant="h2">{h.limits.title}</Typography>
          <Box component="ul" className="limits">
            {h.limits.items.map((item) => (
              <Box component="li" key={item}>
                <Typography variant="body1">{item}</Typography>
              </Box>
            ))}
          </Box>
          <Link href={`${REPO}/tree/main/docs`} icon={IconFileCode}>
            {h.more}
          </Link>
        </Stack>
        </Box>
      </Stack>
    </Page>
  );
};

export default HowItWorks;
