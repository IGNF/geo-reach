/** Pieces of the map's own controls and markers: buttons, icons, marker elements, the name of the graphics card */
import type { Control } from 'isard';

/** Icons of the buttons added to the map controls (SVG markup, drawn in the text color) */
export const LOCATE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 2v2M12 20v2M20 12h2M2 12h2"/></svg>';

/** A button of its own in the map controls: "my location", "close a section" */
export class ButtonControl implements Control {
  private container?: HTMLDivElement;
  readonly button: HTMLButtonElement;

  constructor(icon: string, title: string, onClick: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'map-button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = icon;
    button.addEventListener('click', onClick);
    this.button = button;
  }

  onAdd(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'isard-ctrl-group';
    container.append(this.button);
    this.container = container;

    return container;
  }

  onRemove(): void {
    this.container?.remove();
  }
}

export const PERF_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg>';

/** The graphics card the map draws with */
export const gpuName = (canvas: HTMLCanvasElement): string => {
  const gl = canvas.getContext('webgl2');
  if (!gl) return '?';
  const info = gl.getExtension('WEBGL_debug_renderer_info');

  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
};

/** An element for a marker, styled by its class */
export const markerElement = (className: string): HTMLDivElement => {
  const el = document.createElement('div');
  el.className = className;

  return el;
};
