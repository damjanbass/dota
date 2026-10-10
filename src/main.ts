import { loadMapOrMock } from './core/map';
import type { SceneRunner } from './core/scene';

// Scene router: ?scene=<name>. Each area owns its dev scene; Lead owns this table.
const scenes: Record<string, () => Promise<{ run: SceneRunner }>> = {
  preview: () => import('./game/mapPreview'),
  world: () => import('./world/dev'),
  fps: () => import('./player/dev'),
};

const boot = async (): Promise<void> => {
  const name = new URLSearchParams(location.search).get('scene') ?? 'preview';
  const loader = scenes[name];
  if (!loader) throw new Error(`Unknown scene "${name}". Available: ${Object.keys(scenes).join(', ')}`);
  window.__sceneName = name;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const [map, mod] = await Promise.all([loadMapOrMock(), loader()]);
  await mod.run({ canvas, ui, map });
};

boot().catch((err: unknown) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;color:#f55;padding:16px">${String(err)}</pre>`);
});
