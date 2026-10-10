import { SIM_DT } from './config';

export interface LoopCallbacks {
  /** Fixed-step simulation tick (dt = SIM_DT seconds). */
  update(dt: number): void;
  /**
   * Called once per animation frame.
   * alpha ∈ [0,1) = progress between the last two sim ticks (for interpolation).
   * frameDt = real seconds since last frame (for camera / mouse look / viewmodel).
   */
  render(alpha: number, frameDt: number): void;
}

/** Fixed-timestep loop with render interpolation. Returns a stop function. */
export const startLoop = (cb: LoopCallbacks): (() => void) => {
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  let running = true;

  const frame = (now: number): void => {
    if (!running) return;
    const frameDt = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += frameDt;
    while (acc >= SIM_DT) {
      cb.update(SIM_DT);
      acc -= SIM_DT;
    }
    cb.render(acc / SIM_DT, frameDt);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
};
