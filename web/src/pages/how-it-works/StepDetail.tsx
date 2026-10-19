import type { ReactElement } from 'react';
import { details as d } from '@/locales/howItWorksDetails';
import type { StepId } from '@/locales/howItWorks';
import { BuildGraph, GtfsPrep, Loaders } from '@/pages/how-it-works/figures/data';
import { EngineCrate, Wasm } from '@/pages/how-it-works/figures/engine';
import { Buildings, Layer } from '@/pages/how-it-works/figures/map';
import { Compare, Cuts, Panel } from '@/pages/how-it-works/figures/scenarios';
import { Dijkstra, Profile, Snap } from '@/pages/how-it-works/figures/search';

const FIGURES: Partial<Record<StepId, () => ReactElement>> = {
  buildGraph: BuildGraph,
  gtfsPrep: GtfsPrep,
  profile: Profile,
  snap: Snap,
  dijkstra: Dijkstra,
  layer: Layer,
  engineCrate: EngineCrate,
  wasm: Wasm,
  loaders: Loaders,
  cuts: Cuts,
  panel: Panel,
  compare: Compare,
  buildings: Buildings,
};

/** The detailed figure of a step of the diagram: a sketch, the formula, the numbers of one example, the sources */
const StepDetail = ({ step }: { step: StepId }): ReactElement | null => {
  const Figure = FIGURES[step];

  return Figure ? (
    <div className="step-detail">
      <p className="detail-example">{d.example}</p>
      <Figure />
    </div>
  ) : null;
};

export default StepDetail;
