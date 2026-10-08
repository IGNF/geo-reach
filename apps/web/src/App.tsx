import { PageLoader } from '@ign-junn/design-system';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ControlBar from './components/ControlBar';
import MapView, { type LiveInfo, type TargetInfo } from './components/MapView';
import TripPanel from './components/TripPanel';
import { loadRoadNetwork } from './engine/network';
import { t } from './locales';
import { loadTransit } from './engine/transit';
import { TravelEngine } from './engine/travelEngine';
import { GRAPH_URL, type LngLat, MAX_SCALE, type Mode, TRANSIT_URL } from './lib/config';
import { useAddress, useGpfRoute } from './lib/useRoute';
import { readUrlState, urlHash, type ViewState } from './lib/urlState';

const App = () => {
  const [view, setView] = useState<ViewState>(readUrlState);
  const [engine, setEngine] = useState<TravelEngine>();
  const [transitAvailable, setTransitAvailable] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);
  const [live, setLive] = useState<LiveInfo>();
  const [target, setTarget] = useState<TargetInfo>();
  const [settled, setSettled] = useState<LngLat>();
  const { pinned, mode, direction, bus, scale, contours } = view;
  const hash = urlHash(view);
  const contourSeconds = useMemo(() => contours.map((c) => c * 60), [contours]);

  useEffect(() => {
    // The transit layer is optional: the app runs on the roads alone without it
    Promise.all([loadRoadNetwork(GRAPH_URL), loadTransit(TRANSIT_URL).catch(() => undefined)])
      .then(async ([roads, transit]) => {
        const net = transit ? transit(roads) : roads;
        setTransitAvailable(!!transit);
        const m = !transit && mode === 'transit' ? 'pedestrian' : mode;
        setEngine(await TravelEngine.create(net, { mode: m, direction, bus }));
      })
      .catch((error: unknown) => console.error(error));
    // Loaded once; the profile follows the view in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!engine) return;
    const p = engine.profile;
    if (p.mode === mode && p.direction === direction && p.bus === bus) return;
    engine.setProfile({ mode, direction, bus });
    setProfileVersion((v) => v + 1);
  }, [engine, mode, direction, bus]);

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
  const onLocate = () =>
    navigator.geolocation?.getCurrentPosition((p) => onPin([p.coords.longitude, p.coords.latitude]));

  const originAddress = useAddress(pinned ?? live?.point, pinned ? 0 : 300);
  const targetAddress = useAddress(pinned ? settled : undefined, 0);
  const gpfRoute = useGpfRoute(pinned, settled, mode, direction);

  // As in the reference dataviz: how much of the rail network the point reaches
  const statLimit = contours.length ? Math.max(...contours) : scale;
  const statIndex = contours.indexOf(statLimit);
  const share = live && statIndex >= 0 ? live.stationShare[statIndex] : undefined;
  const stat =
    engine?.net.railStations.length && share !== undefined
      ? t.stationShare(Math.round(share * 100), statLimit, direction, !!pinned)
      : undefined;

  if (!engine) return <PageLoader label={t.loading} />;

  return (
    <div className="app">
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
      />
      <div className="panel-slot">
        <TripPanel
          direction={direction}
          onDirectionChange={(d) => update({ direction: d })}
          pinned={!!pinned}
          onUnpin={() => onPin(undefined)}
          live={live}
          target={target}
          originAddress={originAddress}
          targetAddress={targetAddress}
          gpfRoute={gpfRoute}
          scale={scale}
          contours={contours}
        />
      </div>
      <ControlBar
        mode={mode}
        onModeChange={onModeChange}
        transitAvailable={transitAvailable}
        bus={bus}
        onBusChange={(b) => update({ bus: b })}
        contours={contours}
        onContoursChange={(c) => update({ contours: c })}
        scale={scale}
        onScaleChange={(s) => update({ scale: s })}
        onLocate={onLocate}
        onSwap={() => update({ direction: direction === 'departure' ? 'arrival' : 'departure' })}
        shareUrl={`${window.location.origin}${window.location.pathname}${hash}`}
        stat={stat}
      />
    </div>
  );
};

export default App;
