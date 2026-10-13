import { sizes } from '@ign-junn/design-system';
import type { CSSProperties, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import CutsPanel from '@/components/CutsPanel';
import MapView, { type LiveInfo, type TargetInfo } from '@/components/MapView';
import SettingsPanel from '@/components/SettingsPanel';
import StartupScreen from '@/components/StartupScreen';
import TripPanel from '@/components/TripPanel';
import { closedEdges, type Cut, cutKey } from '@/engine/cuts';
import { DEFAULT_MODEL } from '@/engine/profile';
import type { TravelEngine } from '@/engine/travelEngine';
import { contourMinutes, type LngLat, MAX_SCALE, type Mode } from '@/lib/config';
import { insight } from '@/lib/insights';
import { regionAt, regionById } from '@/lib/regions';
import { STEP_START, startEngine, type StartupProgress } from '@/lib/startup';
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
  const [startup, setStartup] = useState<StartupProgress>({ step: 'download', percent: 0 });
  /** The first map is drawn: the startup screen fades out, then goes */
  const [ready, setReady] = useState(false);
  const [startupGone, setStartupGone] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewWidth, setPreviewWidth] = useState(320);
  const [cutMode, setCutMode] = useState(false);
  const { pinned, mode, direction, bus, hour, scale, contours, model, cuts, perspective } = view;
  const region = regionById(view.region);
  const hash = urlHash(view);
  const contourSeconds = useMemo(() => (contours ? contourMinutes(scale).map((c) => c * 60) : []), [contours, scale]);

  // The network of the region: loaded at the start and at every change of region (a new engine, a new map)
  useEffect(() => {
    const load = { cancelled: false };
    setEngine(undefined);
    setReady(false);
    setStartupGone(false);
    setLive(undefined);
    setTarget(undefined);
    setStartup({ step: 'download', percent: 0 });

    startEngine(region, { mode, direction, bus, hour, model }, cuts, (p) => {
      if (!load.cancelled) setStartup(p);
    })
      .then((started) => {
        if (load.cancelled) return started.engine.dispose();
        setTransitAvailable(started.transit);
        setView((v) => ({
          ...v,
          cuts: started.cuts,
          // No transit layer in this region: on foot instead
          mode: !started.transit && v.mode === 'transit' ? 'pedestrian' : v.mode,
        }));
        setEngine(started.engine);
      })
      .catch((error: unknown) => console.error(error));

    return () => {
      load.cancelled = true;
    };
    // A new region only; the profile follows the view in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region.id]);

  // An engine replaced (new region) lets its workers go
  useEffect(() => () => engine?.dispose(), [engine]);

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

  // The startup screen goes once its fade-out is over
  useEffect(() => {
    if (!ready) return undefined;
    const timer = setTimeout(() => setStartupGone(true), 400);

    return () => clearTimeout(timer);
  }, [ready]);

  const onMapLoad = useCallback(() => setStartup({ step: 'firstRun', percent: STEP_START.firstRun }), []);
  const onFirstFrame = useCallback(() => {
    setStartup((s) => ({ ...s, percent: 100 }));
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<ViewState>) => setView((v) => ({ ...v, ...patch })), []);
  const onPin = useCallback(
    (p: LngLat | undefined) => {
      update({ pinned: p });
      setTarget(undefined);
    },
    [update],
  );
  const onModeChange = (m: Mode) => update({ mode: m, scale: Math.min(scale, MAX_SCALE[m]) });
  /** Another region: its network replaces this one; the pinned point and the cuts belonged to the old one */
  const onRegionChange = useCallback(
    (id: string, focusAt?: LngLat) => {
      setCutMode(false);
      setFocus(focusAt ? { point: focusAt } : undefined);
      update({ region: id, pinned: undefined, cuts: [] });
    },
    [update],
  );
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
        if (inside) {
          // Only centers the map: the user decides whether to pin a point there
          setFocus({ point });

          return;
        }
        // Elsewhere in France: the region of the position is loaded, the map opens on it
        const other = regionAt(point);
        if (!other) return setNotice(t.locateOutside);
        onRegionChange(other.id, point);
      },
      () => setNotice(t.locateFailed),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [engine, onRegionChange]);

  const originAddress = useAddress(pinned ?? live?.point, pinned ? 0 : 300);
  const targetAddress = useAddress(pinned ? settled : undefined, 0);
  const gpfRoute = useGpfRoute(pinned, settled, mode, direction);

  if (!engine) return <StartupScreen progress={startup} done={false} />;

  const insightText = live && insight(mode, live, hour);

  return (
    // The map leaves the room of the preview panel, so that its centre stays in sight
    <div
      className="app"
      style={{ '--preview-width': `${previewOpen ? previewWidth : sizes.previewPanelFolded}px` } as CSSProperties}
    >
      <MapView
        engine={engine}
        start={focus?.point ?? region.start}
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
        onMapLoad={onMapLoad}
        onFirstFrame={onFirstFrame}
        perspective={perspective}
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
          region={region.id}
          onRegionChange={onRegionChange}
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
          perspective={perspective}
          onPerspectiveChange={(p) => update({ perspective: p })}
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
      {!startupGone && <StartupScreen progress={startup} done={ready} />}
    </div>
  );
};

export default App;
