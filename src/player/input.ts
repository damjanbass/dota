// Keyboard + mouse state with rebindable bindings, pointer lock and a per-tick "pressed" snapshot.
// Binding codes: KeyboardEvent.code ('KeyW', 'Space', 'ShiftLeft'), 'Mouse0' / 'Mouse1' / 'Mouse2',
// 'WheelUp' / 'WheelDown' (press-only), optionally prefixed with 'Ctrl+'.

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'walk'
  | 'fire'
  | 'scope'
  // Reserved for other modules: exposed as pressed/held state only.
  | 'shrapnel'
  | 'assassinate'
  | 'townPortal'
  | 'levelShrapnel'
  | 'levelTakeAim'
  | 'levelAssassinate'
  | 'levelHeadshot'
  | 'shop'
  | 'scoreboard';

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  walk: ['ShiftLeft', 'ShiftRight'],
  fire: ['Mouse0'],
  scope: ['Mouse2', 'KeyE'],
  shrapnel: ['KeyQ'],
  assassinate: ['KeyR'],
  townPortal: ['KeyF'],
  levelShrapnel: ['Ctrl+KeyQ'],
  levelTakeAim: ['Ctrl+KeyE'],
  levelAssassinate: ['Ctrl+KeyR'],
  levelHeadshot: ['Ctrl+KeyG'],
  shop: ['KeyB'],
  scoreboard: ['Tab'],
};

export const ALL_ACTIONS = Object.keys(DEFAULT_BINDINGS) as Action[];

/** Actions that keep working while the pointer is not locked (menus / overlays opened by them). */
const UI_ACTIONS: ReadonlySet<Action> = new Set<Action>(['shop', 'scoreboard']);

export interface InputSettings {
  /** CS-style sensitivity: radians per mouse count = sensitivity · 0.022°. */
  sensitivity: number;
  invertY: boolean;
}

export interface InputOptions {
  /** Element that requests pointer lock on click (usually the canvas). */
  target: HTMLElement;
  /** ?test=1: input works without pointer lock and can be driven programmatically. */
  testMode?: boolean;
  bindings?: Partial<Bindings>;
  settings?: Partial<InputSettings>;
}

export const M_YAW = 0.022 * (Math.PI / 180);

export class Input {
  readonly bindings: Bindings;
  readonly settings: InputSettings;
  readonly testMode: boolean;
  /** Listeners called synchronously on every press edge (before the tick sees it). */
  readonly pressListeners = new Set<(action: Action) => void>();

  private readonly target: HTMLElement;
  private readonly codesDown = new Set<string>();
  private readonly virtualDown = new Set<Action>();
  private readonly latched = new Set<Action>();
  private readonly tickPressed = new Set<Action>();
  private codeToActions = new Map<string, Action[]>();
  private ctrlDown = false;
  private lookX = 0;
  private lookY = 0;
  private lockedState = false;
  private readonly cleanup: Array<() => void> = [];

  constructor(opts: InputOptions) {
    this.target = opts.target;
    this.testMode = opts.testMode ?? false;
    this.bindings = { ...DEFAULT_BINDINGS, ...opts.bindings } as Bindings;
    this.settings = { sensitivity: 2, invertY: false, ...opts.settings };
    this.rebuild();
    this.attach();
  }

  /** Pointer is locked to the game (or test mode, which never needs it). */
  get active(): boolean {
    return this.lockedState || this.testMode;
  }

  get locked(): boolean {
    return this.lockedState;
  }

  rebind(action: Action, codes: string[]): void {
    this.bindings[action] = [...codes];
    this.rebuild();
  }

  isDown(action: Action): boolean {
    if (!this.allowed(action)) return false;
    if (this.virtualDown.has(action)) return true;
    for (const code of this.bindings[action]) {
      if (code.startsWith('Ctrl+')) {
        if (this.ctrlDown && this.codesDown.has(code.slice(5))) return true;
      } else if (this.codesDown.has(code)) return true;
    }
    return false;
  }

  /** Pressed at least once since the previous tick (valid for the whole current tick). */
  pressed(action: Action): boolean {
    return this.tickPressed.has(action);
  }

  /** Called once at the start of each sim tick: snapshots the presses latched since the last tick. */
  beginTick(): void {
    this.tickPressed.clear();
    for (const a of this.latched) this.tickPressed.add(a);
    this.latched.clear();
  }

  /** Accumulated mouse movement in counts since the last call. */
  consumeLook(out: { x: number; y: number }): void {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
  }

  /** Programmatic press edge (test hooks, on-screen buttons). */
  press(action: Action): void {
    if (!this.allowed(action)) return;
    this.latched.add(action);
    for (const l of this.pressListeners) l(action);
  }

  /** Test hook: replaces the set of virtually held actions. */
  setVirtual(actions: Iterable<Action>): void {
    this.virtualDown.clear();
    for (const a of actions) this.virtualDown.add(a);
  }

  requestLock(): void {
    if (this.testMode || this.lockedState) return;
    void this.lockAsync();
  }

  releaseAll(): void {
    this.codesDown.clear();
    this.ctrlDown = false;
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup.length = 0;
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  // --- internals ------------------------------------------------------------

  private allowed(action: Action): boolean {
    return this.active || UI_ACTIONS.has(action);
  }

  private rebuild(): void {
    const map = new Map<string, Action[]>();
    for (const action of ALL_ACTIONS) {
      for (const code of this.bindings[action]) {
        const list = map.get(code) ?? [];
        list.push(action);
        map.set(code, list);
      }
    }
    this.codeToActions = map;
  }

  private async lockAsync(): Promise<void> {
    const el = this.target as HTMLElement & {
      requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      // Raw mouse input (no OS acceleration) like CS m_rawinput; not supported everywhere.
      await el.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await el.requestPointerLock();
      } catch {
        // User cancelled or the browser refused; the next click retries.
      }
    }
  }

  private codeDown(code: string, ctrl: boolean): boolean {
    this.codesDown.add(code);
    const actions = (ctrl ? this.codeToActions.get(`Ctrl+${code}`) : undefined) ?? this.codeToActions.get(code);
    if (!actions) return false;
    for (const a of actions) this.press(a);
    return true;
  }

  private attach(): void {
    const on = <K extends keyof DocumentEventMap>(
      target: Document | Window | HTMLElement,
      type: K,
      fn: (e: DocumentEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(window, 'keydown', (e) => {
      this.ctrlDown = e.ctrlKey;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') return;
      if (e.repeat) {
        if (this.codeToActions.has(e.code) && this.active) e.preventDefault();
        return;
      }
      const handled = this.codeDown(e.code, e.ctrlKey);
      // Keep Tab / Space / Ctrl+R etc. from doing browser things while playing.
      if (handled && (this.active || e.code === 'Tab')) e.preventDefault();
    });
    on(window, 'keyup', (e) => {
      this.ctrlDown = e.ctrlKey;
      this.codesDown.delete(e.code);
    });
    on(document, 'mousedown', (e) => {
      if (!this.active) {
        if (e.target === this.target && e.button === 0) this.requestLock();
        return;
      }
      this.codeDown(`Mouse${e.button}`, e.ctrlKey);
    });
    on(document, 'mouseup', (e) => {
      this.codesDown.delete(`Mouse${e.button}`);
    });
    on(document, 'mousemove', (e) => {
      if (!this.active) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    on(
      document,
      'wheel',
      (e) => {
        if (!this.active || e.deltaY === 0) return;
        const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
        const actions = this.codeToActions.get(code);
        if (actions) for (const a of actions) this.press(a);
      },
      { passive: true },
    );
    on(document, 'contextmenu', (e) => {
      if (this.active || e.target === this.target) e.preventDefault();
    });
    on(document, 'pointerlockchange', () => {
      this.lockedState = document.pointerLockElement === this.target;
      if (!this.lockedState) this.releaseAll();
    });
    on(window, 'blur', () => this.releaseAll());
  }
}
