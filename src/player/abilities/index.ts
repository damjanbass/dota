// Sniper kit public API (agent F).
//
//   registerSniperAbilities(sim);                      // once, after creating the sim (idempotent)
//   const kit = createSniperKit({ sim, player, scene, camera, ui, events, map, heightAt: world.heightAt });
//   startLoop({
//     update: (dt) => { player.update(dt); kit.update(dt); /* sync controller → sim.setUnitPosition */ sim.step(dt); },
//     render: (alpha, frameDt) => { player.render(alpha, frameDt); kit.render(frameDt); renderer.render(scene, camera); player.renderOverlay(renderer); },
//   });
export { createSniperKit } from './kit';
export type { KitSnapshot, KitTestHooks, SniperKit, SniperKitDeps } from './kit';
export { registerSniperAbilities } from './register';
export { getSniperSystems } from './systems';
export type { SniperSystems } from './systems';
export { DEFAULT_KIT_OPTIONS, KitLogic } from './kitLogic';
export type { KitEvent, KitOptions, KitPlayer, ShrapnelAim } from './kitLogic';
export { applyTakeAim } from './takeAim';
export { AssassinateAim } from './assassinate';
export { castBlockReason } from './castCheck';
export { portalAnchors, resolvePortal } from './townPortal';
export type { PortalAnchor, PortalChannel } from './townPortal';
export type { ShrapnelField, VisionApi } from './shrapnel';
export * from './ids';
