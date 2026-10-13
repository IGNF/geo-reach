import { ProgressBar, sizes } from '@ign-junn/design-system';
import type { CSSProperties, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AddressSearch from '@/components/AddressSearch';
import CutsPanel from '@/components/CutsPanel';
import MapView, { type LiveInfo, type TargetInfo } from '@/components/MapView';
import SettingsPanel from '@/components/SettingsPanel';
import StartupScreen from '@/components/StartupScreen';
import TripPanel from '@/components/TripPanel';
import { closedEdges, type Cut, cutKey } from '@/engine/cuts';
import { DEFAULT_MODEL } from '@/engine/profile';
import type { TravelEngine } from '@/engine/travelEngine';
import { contourMinutes, type LngLat, MAX_SCALE, type Mode, type Camera } from '@/lib/config';
import { insight } from '@/lib/insights';
import { regionAt, regionById, regionHolds } from '@/lib/regions';
import { cameraFor } from '@/lib/camera';
import { STEP_START, startEngine, type StartupProgress } from '@/lib/startup';
import { useAddress, useGpfRoute } from '@/lib/useRoute';
import { readUrlState, urlHash, type ViewState } from '@/lib/urlState';
import { t } from '@/locales';
import { toMercator } from '@/lib/mercator';

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
  /** Where the map looks: a new region's map opens on it, so that crossing a border does not move the view */
  const camera = useRef<Camera>(cameraFor(view.pinned ?? region.start, perspective));
  /** Another region loading while the current map stays: its name and progress */
  const [switching, setSwitching] = useState<{ name: string; progress: StartupProgress }>();
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const contourSeconds = useMemo(() => (contours ? contourMinutes(scale).map((c) => c * 60) : []), [contours, scale]);

  // The network of the region: at the start behind the startup screen, then, when the view enters another region,
  // in the background while the current map stays; the new engine and its map replace them once ready
  useEffect(() => {
    const load = { cancelled: false };
    const first = !engineRef.current;
    const report = (progress: StartupProgress): void => {
      if (load.cancelled) return;
      if (first) setStartup(progress);
      else setSwitching({ name: region.name, progress });
    };
    report({ step: 'download', percent: 0 });

    startEngine(region, { mode, direction, bus, hour, model }, cuts, report)
      .then((started) => {
        if (load.cancelled) return started.engine.dispose();
        setSwitching(undefined);
        setLive(undefined);
        setTarget(undefined);
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
  /**
   * Another region: its network replaces this one. The cuts belonged to the old network; the pinned point stays when
   * the new region holds it.
   */
  const onRegionChange = useCallback(
    (id: string, lookAt?: LngLat) => {
      const next = regionById(id);
      if (lookAt) camera.current = { ...camera.current, center: lookAt };
      setCutMode(false);
      setView((v) => ({ ...v, region: id, cuts: [], pinned: v.pinned && regionHolds(next, v.pinned) ? v.pinned : undefined }));
    },
    [],
  );

  /** The map stopped: its camera is kept, and a view gone into another region loads that region */
  const onCamera = useCallback(
    (c: Camera) => {
      camera.current = c;
      if (regionHolds(region, c.center)) return;
      const next = regionAt(c.center);
      if (next && next.id !== region.id) onRegionChange(next.id);
    },
    [region, onRegionChange],
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
  /**
   * The map goes to a point (an address searched, the user's position): in this region it flies there and marks it,
   * elsewhere in France the region of the point loads and the map opens on it. Only centers the map: the user
   * decides whether to pin a point there.
   */
  const goTo = useCallback(
    (point: LngLat) => {
      setNotice(undefined);
      if (regionHolds(region, point)) {
        setFocus({ point });

        return;
      }

      const other = regionAt(point);
      if (!other) return setNotice(t.locateOutside);
      onRegionChange(other.id, point);
    },
    [region, onRegionChange],
  );

  const onLocate = useCallback(() => {
    setNotice(undefined);
    if (!navigator.geolocation) return setNotice(t.locateFailed);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => goTo([coords.longitude, coords.latitude]),
      () => setNotice(t.locateFailed),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [goTo]);

  // The same trip in each mode, once the cursor stops on a destination (a worker of its own: the map stays fluid)
  const compareModes = useMemo<Mode[]>(
    () => (transitAvailable ? ['transit', 'pedestrian', 'bike', 'car'] : ['pedestrian', 'bike', 'car']),
    [transitAvailable],
  );
  const [comparison, setComparison] = useState<Partial<Record<Mode, number>>>();
  useEffect(() => {
    setComparison(undefined);
    if (!engine || !pinned || !settled) return;

    const toZone = (p: LngLat): [number, number] => {
      const [x, y] = toMercator(p);

      return [x - engine.net.origin[0], y - engine.net.origin[1]];
    };
    // As in the trip panel: from the map's point to the pinned one (departure), or the reverse (arrival)
    const [from, to] = direction === 'departure' ? [settled, pinned] : [pinned, settled];
    engine.compare(toZone(from), toZone(to), compareModes).then((seconds) => {
      if (seconds) setComparison(seconds);
    });
  }, [engine, pinned, settled, direction, compareModes, profileVersion]);

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
        camera={camera.current}
        onCamera={onCamera}
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
        <AddressSearch onGo={goTo} />
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
          comparison={pinned && settled ? { modes: compareModes, seconds: comparison } : undefined}
          onModeChange={onModeChange}
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
          region={region}
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
      {switching && (
        <div className="region-loading glass" role="status">
          <ProgressBar label={t.region.loading(switching.name)} value={Math.round(switching.progress.percent)} animated size="sm" />
        </div>
      )}
      {!startupGone && <StartupScreen progress={startup} done={ready} />}
    </div>
  );
};

export default App;
