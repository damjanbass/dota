// Global tuning constants. All distances are WC3 units (1 unit ≈ 1 inch, CS 1.6 scale).

/** Fixed simulation rate. Rendering interpolates between sim ticks. */
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

/**
 * Multiplies every attack / spell / aggro / vision range equally so firefights feel like an FPS
 * while DotA's relative balance (e.g. Sniper + Take Aim outranging towers) is preserved.
 * Map distances and move speeds are never scaled.
 */
export const RANGE_SCALE = 2.0;

export const scaledRange = (dotaRange: number): number => dotaRange * RANGE_SCALE;

/** WC3 terrain tile edge length. */
export const TILE_SIZE = 128;

/** WC3 pathing cell edge length (4 cells per tile). */
export const PATHING_CELL = 32;

/** Player camera height above feet (CS 1.6 standing eye height). */
export const EYE_HEIGHT = 64;

/** Player collision radius (CS 1.6 hull half-width). */
export const PLAYER_RADIUS = 16;

/** Render far plane — the whole DotA map must fit. */
export const VIEW_DISTANCE = 20000;
