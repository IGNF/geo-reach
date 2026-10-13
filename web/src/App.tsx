import { PageLoader, sizes } from '@ign-junn/design-system';
import type { CSSProperties, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import CutsPanel from '@/components/CutsPanel';
import MapView, { type LiveInfo, type TargetInfo } from '@/components/MapView';
import SettingsPanel from '@/components/SettingsPanel';
import TripPanel from '@/components/TripPanel';
import { closedEdges, type Cut, cutKey, edgesOfCut } from '@/engine/cuts';
import { loadRoadNetwork } from '@/engine/network';
import { DEFAULT_MODEL } from '@/engine/profile';
import { loadTransit } from '@/engine/transit';
import { TravelEngine } from '@/engine/travelEngine';
import { contourMinutes, GRAPH_URL, type LngLat, MAX_SCALE, type Mode, TRANSIT_URL } from '@/lib/config';
import { insight } from '@/lib/insights';
import { useAddress, useGpfRoute } from '@/lib/useRoute';
import { readUrlState, urlHash, type ViewState } from '@/lib/urlState';
import { t } from '@/locales';

const App = (): ReactElement => {
  const [view, setView] = useState<ViewState>(readUrlState);
  const [engine, setEngine] = useState<TravelEngine>();
  const [transitAvailable, setTransitAvailable] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const [live, setLive] = useState<LiveInfo>();
  const [target, setTarget] = useState<TargetInfo>();
  const [settled, setSettled] = useState<LngLat>();
  const [focus, setFocus] = useState<{ point: LngLat }>();
  const [notice, setNotice] = useState<string>();
  const [loadedBytes, setLoadedBytes] = useState({ graph: 0, transit: 0 });
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewWidth, setPreviewWidth] = useState(320);
  const [cutMode, setCutMode] = useState(false);
  const { pinned, mode, direction, bus, hour, scale, contours, model, cuts } = view;
  const hash = urlHash(view);
  const contourSeconds = useMemo(() => (contours ? contourMinutes(scale).map((c) => c * 60) : []), [contours, scale]);

  useEffect(() => {
    // The transit layer is optional: the app runs on the roads alone without it
    Promise.all([
      loadRoadNetwork(GRAPH_URL, (graph) => setLoadedBytes((b) => ({ ...b, graph }))),
      loadTransit(TRANSIT_URL, (transit) => setLoadedBytes((b) => ({ ...b, transit }))).catch(() => undefined),
    ])
      .then(async ([roads, transit]) => {
        const net = transit ? transit(roads) : roads;
        setTransitAvailable(!!transit);
        const m = !transit && mode === 'transit' ? 'pedestrian' : mode;
        // Cuts of a link made on other data are dropped
        const valid = cuts.filter((c) => edgesOfCut(net, c).length);
        if (valid.length !== cuts.length) setView((v) => ({ ...v, cuts: valid }));
        setEngine(await TravelEngine.create(net, { mode: m, direction, bus, hour, model, closed: closedEdges(net, valid) }));
      })
      .catch((error: unknown) => console.error(error));
    // Loaded once; the profile follows the view in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closed = useMemo(() => engine && closedEdges(engine.net, cuts), [engine, cuts]);

  useEffect(() => {
    if (!engine || !closed) return;
    const p = engine.profile;
    const sameCuts = p.closed.length === closed.length && p.closed.every((e, i) => e === closed[i]);
    if (p.mode === mode && p.direction === direction && p.bus === bus && p.hour === hour && p.model === model && sameCuts) return;
    engine.setProfile({ mode, direction, bus, hour, model, closed });
    setProfileVersion((v) => v + 1);
  }, [engine, mode, direction, bus, hour, model, closed]);

  useEffect(() => window.history.replaceState(null, '', hash), [hash]);

  const update = useCallback((patch: Partial<ViewState>) => setView((v) => ({ ...v, ...patch })), []);
  const onPin = useCallback(
    (p: LngLat | undefined) => {
      update({ pinned: p });
      setTarget(undefined);
    },
    [update],
  );
  const onModeChange = (m: Mode) => update({ mode: m, scale: Math.min(scale, MAX_SCALE[m]) });
  const onCutToggle = useCallback(
    (cut: Cut) =>
      setView((v) => {
        const key = cutKey(cut);
        const others = v.cuts.filter((c) => cutKey(c) !== key);

        return { ...v, cuts: others.length < v.cuts.length ? others : [...v.cuts, cut] };
      }),
    [],
  );
  const onLocate = useCallback(() => {
    setNotice(undefined);
    if (!navigator.geolocation) return setNotice(t.locateFailed);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point: LngLat = [coords.longitude, coords.latitude];
        const [minLng, minLat, maxLng, maxLat] = engine?.net.bbox ?? [0, 0, 0, 0];
        const inside = point[0] >= minLng && point[0] <= maxLng && point[1] >= minLat && point[1] <= maxLat;
        if (!inside) return setNotice(t.locateOutside);
        // Only centers the map: the user decides whether to pin a point there
        setFocus({ point });
      },
      () => setNotice(t.locateFailed),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [engine]);

  const originAddress = useAddress(pinned ?? live?.point, pinned ? 0 : 300);
  const targetAddress = useAddress(pinned ? settled : undefined, 0);
  const gpfRoute = useGpfRoute(pinned, settled, mode, direction);

  if (!engine) {
    const mb = (loadedBytes.graph + loadedBytes.transit) / 1e6;

    return <PageLoader label={mb > 0 ? t.loadingProgress(mb.toFixed(0)) : t.loading} />;
  }
  const insightText = live && insight(mode, live, hour);

  return (
    // The map leaves the room of the preview panel, so that its centre stays in sight
    <div
      className="app"
      style={{ '--preview-width': `${previewOpen ? previewWidth : sizes.previewPanelFolded}px` } as CSSProperties}
    >
      <MapView
        engine={engine}
        profileVersion={profileVersion}
        scale={scale * 60}
        contours={contourSeconds}
        pinned={pinned}
        onPin={onPin}
        onLive={setLive}
        onTarget={setTarget}
        onSettle={setSettled}
        focus={focus}
        onLocate={onLocate}
        cuts={cuts}
        cutMode={cutMode}
        onCutModeChange={setCutMode}
        onCutToggle={onCutToggle}
      />
      <div className="left-slot">
        <TripPanel
          mode={mode}
          direction={direction}
          pinned={!!pinned}
          onUnpin={() => onPin(undefined)}
          live={live}
          target={target}
          originAddress={originAddress}
          targetAddress={targetAddress}
          gpfRoute={gpfRoute}
          scale={scale}
          notice={notice}
        />
        <CutsPanel
          net={engine.net}
          cuts={cuts}
          cutMode={cutMode}
          onCutModeChange={setCutMode}
          onToggle={onCutToggle}
          onClear={() => update({ cuts: [] })}
          impact={cuts.length ? live?.cutImpact : undefined}
          scale={scale}
        />
      </div>
      <div className="right-slot">
        <SettingsPanel
          mode={mode}
          onModeChange={onModeChange}
          transitAvailable={transitAvailable}
          bus={bus}
          onBusChange={(b) => update({ bus: b })}
          hour={hour}
          onHourChange={(h) => update({ hour: h })}
          model={model}
          onModelChange={(patch) => update({ model: { ...model, ...patch } })}
          onReset={() => update({ model: DEFAULT_MODEL, cuts: [] })}
          cutMode={cutMode}
          onCutModeChange={setCutMode}
          direction={direction}
          onDirectionChange={(d) => update({ direction: d })}
          contours={contours}
          onContoursChange={(c) => update({ contours: c })}
          scale={scale}
          onScaleChange={(s) => update({ scale: s })}
          shareUrl={`${window.location.origin}${window.location.pathname}${hash}`}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          width={previewWidth}
          onWidthChange={setPreviewWidth}
        />
      </div>
      {insightText && <div className="insight-bar glass">{insightText}</div>}
    </div>
  );
};

export default App;
