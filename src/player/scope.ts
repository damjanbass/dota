// AWP-style scope: none → zoom 1 → zoom 2 → none, FOV + sensitivity scaling, drop-on-fire with auto resume,
// plus the DOM overlay (scope vignette + hairlines, CS crosshair when unscoped).
import { DEG, clamp } from './math';

export type ZoomLevel = 0 | 1 | 2;

/** Field of view as CS 1.6 defines it: horizontal degrees at a 4:3 aspect (default_fov 90). */
export const CS_FOV = { none: 90, zoom1: 40, zoom2: 10 } as const;

/** Converts a CS (4:3 horizontal) FOV to the vertical FOV three.js wants, in degrees. Wider screens get Hor+. */
export const csFovToVertical = (csFovDeg: number): number =>
  (2 * Math.atan(Math.tan((csFovDeg * DEG) / 2) * (3 / 4))) / DEG;

export interface ScopeParams {
  /** CS FOVs for zoom levels 0, 1, 2. */
  fovs: [number, number, number];
  /** zoom_sensitivity_ratio (CS 1.6 default 1.2). Sensitivity scales by (fov / 90) × ratio while zoomed. */
  zoomSensitivityRatio: number;
  /** CS AWP secondary-attack delay between zoom changes, seconds. */
  toggleDelay: number;
  /** AWP: firing while scoped drops the scope, it comes back when the bolt is closed. */
  unscopeOnFire: boolean;
}

export const SCOPE_DEFAULTS: Readonly<ScopeParams> = {
  fovs: [CS_FOV.none, CS_FOV.zoom1, CS_FOV.zoom2],
  zoomSensitivityRatio: 1.2,
  toggleDelay: 0.3,
  unscopeOnFire: true,
};

/** Pure scope state machine; ticked by the sim. */
export class ScopeState {
  readonly params: ScopeParams;
  zoomLevel: ZoomLevel = 0;
  /** Zoom to restore after the post-shot bolt cycle (0 = nothing pending). */
  resumeLevel: ZoomLevel = 0;
  private delay = 0;
  private queued = false;

  constructor(params: Partial<ScopeParams> = {}) {
    this.params = { ...SCOPE_DEFAULTS, ...params };
  }

  get isScoped(): boolean {
    return this.zoomLevel > 0;
  }

  /** Vertical FOV in degrees for the camera. */
  get fov(): number {
    return csFovToVertical(this.params.fovs[this.zoomLevel]);
  }

  /** Multiplier on mouse sensitivity. */
  get sensitivityScale(): number {
    if (this.zoomLevel === 0) return 1;
    return (this.params.fovs[this.zoomLevel] / this.params.fovs[0]) * this.params.zoomSensitivityRatio;
  }

  /** Scope key pressed. Applied now or buffered until the toggle delay ends. */
  requestToggle(): void {
    if (this.resumeLevel > 0) {
      // Pressing scope during the bolt cycle cancels the automatic re-zoom (CS quick-switch habit).
      this.resumeLevel = 0;
      return;
    }
    if (this.delay > 0) {
      this.queued = true;
      return;
    }
    this.cycle();
  }

  /** Call when the rifle fires. */
  onFire(): void {
    if (!this.params.unscopeOnFire || this.zoomLevel === 0) return;
    this.resumeLevel = this.zoomLevel;
    this.zoomLevel = 0;
    this.queued = false;
  }

  /** Sim tick. `weaponReady` = bolt closed, which is when a dropped zoom comes back. */
  tick(dt: number, weaponReady: boolean): void {
    if (this.delay > 0) this.delay = Math.max(0, this.delay - dt);
    if (this.resumeLevel > 0 && weaponReady) {
      this.zoomLevel = this.resumeLevel;
      this.resumeLevel = 0;
    }
    if (this.queued && this.delay <= 0) {
      this.queued = false;
      this.cycle();
    }
  }

  reset(): void {
    this.zoomLevel = 0;
    this.resumeLevel = 0;
    this.queued = false;
    this.delay = 0;
  }

  private cycle(): void {
    this.zoomLevel = ((this.zoomLevel + 1) % 3) as ZoomLevel;
    this.delay = this.params.toggleDelay;
  }
}

// ---------------------------------------------------------------------------
// DOM overlay
// ---------------------------------------------------------------------------

const STYLE_ID = 'player-overlay-style';
const CSS = `
.pl-scope { position: absolute; inset: 0; display: none; pointer-events: none; }
.pl-scope.on { display: block; }
.pl-scope-mask { position: absolute; inset: 0;
  background: radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0, rgba(0,0,0,0) calc(46vh - 6px),
    rgba(0,0,0,0.55) calc(46vh - 1px), #000 46vh); }
.pl-scope-lens { position: absolute; left: 50%; top: 50%; width: 92vh; height: 92vh; transform: translate(-50%, -50%);
  border-radius: 50%; box-shadow: inset 0 0 6vh rgba(0,0,0,0.55); }
.pl-scope-h, .pl-scope-v { position: absolute; background: #000; }
.pl-scope-h { left: 0; right: 0; top: 50%; height: 1px; }
.pl-scope-v { top: 0; bottom: 0; left: 50%; width: 1px; }
.pl-cross { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
.pl-cross.off { display: none; }
.pl-cross i { position: absolute; background: rgb(50,250,50); box-shadow: 0 0 1px rgba(0,0,0,0.9); }
`;

/** Crosshair (unscoped) and scope overlay inside the UI root. */
export class ScopeOverlay {
  readonly root: HTMLDivElement;
  private readonly scope: HTMLDivElement;
  private readonly cross: HTMLDivElement;
  private readonly lines: HTMLElement[];
  private gap = 6;
  private shownScoped: boolean | null = null;
  private shownGap = -1;

  constructor(parent: HTMLElement) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'pl-overlay';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    this.scope = document.createElement('div');
    this.scope.className = 'pl-scope';
    this.scope.innerHTML = '<div class="pl-scope-lens"></div><div class="pl-scope-mask"></div><div class="pl-scope-h"></div><div class="pl-scope-v"></div>';
    this.cross = document.createElement('div');
    this.cross.className = 'pl-cross';
    this.lines = [0, 1, 2, 3].map(() => {
      const el = document.createElement('i');
      this.cross.appendChild(el);
      return el;
    });
    this.root.append(this.scope, this.cross);
    parent.appendChild(this.root);
  }

  /**
   * @param spreadPx current weapon inaccuracy projected to screen pixels (the CS dynamic crosshair gap).
   * @param frameDt seconds since last frame, for gap smoothing.
   */
  update(scoped: boolean, spreadPx: number, frameDt: number): void {
    if (scoped !== this.shownScoped) {
      this.shownScoped = scoped;
      this.scope.classList.toggle('on', scoped);
      this.cross.classList.toggle('off', scoped);
    }
    if (scoped) return;
    const target = clamp(spreadPx, 3, 140);
    this.gap += (target - this.gap) * Math.min(1, frameDt * 14);
    const gap = Math.round(this.gap);
    if (gap === this.shownGap) return;
    this.shownGap = gap;
    const len = 7;
    const w = 2;
    const [top, bottom, left, right] = this.lines as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    top.style.cssText = `left:${-w / 2}px;top:${-gap - len}px;width:${w}px;height:${len}px`;
    bottom.style.cssText = `left:${-w / 2}px;top:${gap}px;width:${w}px;height:${len}px`;
    left.style.cssText = `left:${-gap - len}px;top:${-w / 2}px;width:${len}px;height:${w}px`;
    right.style.cssText = `left:${gap}px;top:${-w / 2}px;width:${len}px;height:${w}px`;
  }

  dispose(): void {
    this.root.remove();
  }
}
