import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { zoneMatrix } from '@/shared/gl';
import { perf } from '@/shared/perf';
import type { Network, Profile } from '@/features/routing';
import { NetworkRenderer, type NetworkStyle } from './networkRenderer';

export type { NetworkStyle } from './networkRenderer';

/** The network renderer as a MapLibre custom layer, between the streets and the labels of the basemap */
export class NetworkLayer implements CustomLayerInterface {
  readonly id = 'network';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  readonly renderer: NetworkRenderer;
  private map?: MlMap;

  constructor(net: Network) {
    this.renderer = new NetworkRenderer(net);
    this.renderer.onChange = () => this.map?.triggerRepaint();
  }

  onAdd(map: MlMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.renderer.attach(gl);
  }

  setProfile(profile: Profile): void {
    this.renderer.setProfile(profile);
  }

  setTimes(times: Float32Array | undefined): void {
    this.renderer.setTimes(times);
  }

  setStyle(style: NetworkStyle): void {
    this.renderer.setStyle(style);
  }

  get timesTexture(): WebGLTexture | undefined {
    return this.renderer.timesTexture;
  }

  get maxTime(): number {
    return this.renderer.maxTime;
  }

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    const { map } = this;
    if (map) perf.time('network', () => this.renderer.draw(gl, zoneMatrix(args, this.renderer.origin), map.getZoom()));
  }
}
