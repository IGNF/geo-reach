import { Box, ProgressBar, sizes } from '@ign-junn/design-system';
import type { CSSProperties, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddressSearch } from '@/features/search';
import { closedEdges, type Cut, cutKey, CutsPanel } from '@/features/cuts';
import { cameraFor, type LiveInfo, MapView, type TargetInfo } from '@/features/map';
import { SettingsPanel } from '@/features/settings';
import { PerfPanel } from '@/features/perf';
import { regionAt, regionById, regionHolds, startEngine, type StartupProgress, StartupScreen, STEP_START } from '@/features/regions';
import { insight, TripPanel, useAddress, useGpfRoute } from '@/features/trip';
import { DEFAULT_MODEL, type TravelEngine } from '@/features/routing';
import { type LngLat, MAX_SCALE, type Mode, type Camera } from '@/shared/config';
import { readUrlState, urlHash, type ViewState } from '@/app/urlState';
import { t } from '@/locales';
import { toMercator } from '@/shared/mercator';

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
  /** The first region or a map could not start: the startup screen says so, with a button to reload */
  const [startupFailed, setStartupFailed] = useState<'network' | 'map'>();
  const [startup, setStartup] = useState<StartupProgress>({ step: 'download', percent: 0 });
  /** The first map is drawn: the startup screen fades out, then goes */
  const [ready, setReady] = useState(false);
  const [startupGone, setStartupGone] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [previewWidth, setPreviewWidth] = useState(320);
  const [cutMode, setCutMode] = useState(false);
  const { pinned, mode, direction, bus, hour, scale, model, cuts, perspective } = view;
  const region = regionById(view.region);
  const hash = urlHash(view);
  /** Where the map looks: a new region's map opens on it, so that crossing a border does not move the view */
  // The camera of the link (a reload opens where the map was), else the pinned point or the region's start
  const camera = useRef<Camera>(view.camera ?? cameraFor(view.pinned ?? region.start, perspective));
  /** Another region loading while the current map stays: its name and progress */
  const [switching, setSwitching] = useState<{ name: string; progress: StartupProgress }>();
  const engineRef = useRef(engine);
  engineRef.current = engine;

  // The network of the region: at the start behind the startup screen, then, when the view enters another region,
  // in the background while the current map stays; the new engine and its map replace them once ready
  useEffect(() => {
    const load = { cancelled: false };
    // Leaving the region before it is loaded stops its download and decoding
    const controller = new AbortController();
    const first = !engineRef.current;
    const report = (progress: StartupProgress): void => {
      if (load.cancelled) return;
      if (first) setStartup(progress);
      else setSwitching({ name: region.name, progress });
    };
    report({ step: 'download', percent: 0 });

    startEngine(region, { mode, direction, bus, hour, model }, cuts, report, controller.signal)
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
      .catch((error: unknown) => {
        if (load.cancelled) return;
        console.error(error);
        // At the start, the startup screen says it; later, the current map stays
        if (first) return setStartupFailed('network');
        setSwitching(undefined);
        setNotice(t.region.failed(region.name));
      });

    return () => {
      load.cancelled = true;
      controller.abort();
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
  // No map without WebGL 2 or the files of its engine, whatever the region: the startup screen comes back to say it
  const onMapError = useCallback(() => setStartupFailed('map'), []);

  const update = useCallback((patch: Partial<ViewState>) => setView((v) => ({ ...v, ...patch })), []);
  const onPin = useCallback(
    (p: LngLat | undefined) => {
      update({ pinned: p });
      setTarget(undefined);
    },
    [update],
  );
  const onModeChange = useCallback((m: Mode) => update({ mode: m, scale: Math.min(scale, MAX_SCALE[m]) }), [update, scale]);
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
      setView((v) => ({ ...v, camera: c }));
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
    // An answer for a trip no longer shown (point unpinned, other settings) is dropped
    let stale = false;
    engine.compare(toZone(from), toZone(to), compareModes).then((seconds) => {
      if (seconds && !stale) setComparison(seconds);
    });

    return () => {
      stale = true;
    };
  }, [engine, pinned, settled, direction, compareModes, profileVersion]);

  const originAddress = useAddress(pinned ?? live?.point, pinned ? 0 : 300);
  const targetAddress = useAddress(pinned ? settled : undefined, 0);
  const gpfRoute = useGpfRoute(pinned, settled, mode, direction);

  // The panels that do not show the cursor's figures stay as they are while it moves (a render per move otherwise)
  const net = engine?.net;
  const cutImpact = cuts.length ? live?.cutImpact : undefined;
  const addressSearch = useMemo(() => <AddressSearch onGo={goTo} />, [goTo]);
  const cutsPanel = useMemo(
    () =>
      net && (
        <CutsPanel
          net={net}
          cuts={cuts}
          cutMode={cutMode}
          onCutModeChange={setCutMode}
          onToggle={onCutToggle}
          onClear={() => update({ cuts: [] })}
          impact={cutImpact}
          scale={scale}
        />
      ),
    [net, cuts, cutMode, cutImpact, onCutToggle, update, scale],
  );
  const settingsPanel = useMemo(
    () => (
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
        scale={scale}
        onScaleChange={(s) => update({ scale: s })}
        shareUrl={`${window.location.origin}${window.location.pathname}${hash}`}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        width={previewWidth}
        onWidthChange={setPreviewWidth}
      />
    ),
    [region, mode, onModeChange, transitAvailable, bus, hour, model, update, cutMode, perspective, direction, scale, hash, previewOpen, previewWidth],
  );

  if (!engine) return <StartupScreen progress={startup} region={region.name} done={false} failed={startupFailed} />;

  const insightText = live && insight(mode, live, hour);

  return (
    // The map leaves the room of the preview panel, so that its centre stays in sight
    <Box
      className="app"
      style={{ '--preview-width': `${previewOpen ? previewWidth : sizes.previewPanelFolded}px` } as CSSProperties}
    >
      <MapView
        engine={engine}
        camera={camera.current}
        onCamera={onCamera}
        profileVersion={profileVersion}
        scale={scale * 60}
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
        onMapError={onMapError}
        perspective={perspective}
      />
      <Box className="left-slot">
        {addressSearch}
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
        {cutsPanel}
      </Box>
      <Box className="right-slot">
        {settingsPanel}
      </Box>
      {insightText && <Box className="insight-bar glass">{insightText}</Box>}
      <PerfPanel />
      {switching && (
        <Box className="region-loading glass" role="status">
          <ProgressBar label={t.region.loading(switching.name)} value={Math.round(switching.progress.percent)} animated size="sm" />
        </Box>
      )}
      {(!startupGone || startupFailed) && (
        <StartupScreen progress={startup} region={region.name} done={ready && !startupFailed} failed={startupFailed} />
      )}
    </Box>
  );
};

export default App;
