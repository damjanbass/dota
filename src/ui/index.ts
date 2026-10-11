// Public UI API (agent H).
//   const menus = createMenus(ui);
//   const config = await menus.showMainMenu();
//   const hud = createHud({ root: ui, sim, player, events: sim.events, map, camera, menus, onPauseChange, onExit });
//   render: player.render(alpha, dt); renderer.render(scene, camera); hud.update(dt, alpha);
export { createHud, unitDisplayName } from './hud';
export type { CreateHudOptions, Hud } from './hud';
export type { HudPlayer } from './context';
export { createMenus, createSettingsForm, MENU_TITLE, DEFAULT_ALLIES, DEFAULT_ENEMIES, sanitizeSetup, toMatchConfig } from './menus';
export type { Menus, MenuSetup } from './menus';
export { collectEndStats, showEndScreen } from './endScreen';
export type { EndStats } from './endScreen';
export { DEFAULT_SETTINGS, loadSettings, saveSettings, onSettingsChange } from './settings';
export type { GameSettings } from './settings';
export { BUYBACK_CODE } from './death';
