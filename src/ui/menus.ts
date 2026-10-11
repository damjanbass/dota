// Main menu (match setup + settings + controls), pause menu and end screen.
import type { Difficulty, MatchConfig } from '../core/sim';
import type { Team } from '../core/types';
import { HEROES } from '../data';
import type { EndStats } from './endScreen';
import { showEndScreen } from './endScreen';
import { heroColor, heroInitials } from './icons';
import { SETTINGS_LIMITS, loadSettings, saveSettings } from './settings';
import type { GameSettings } from './settings';
import { ensureStyles, el, esc } from './style';

export const MENU_TITLE = 'DotA Allstars 6.83d — Sniper FPS';

/** Default line-up: Shadow Fiend mid against the player, plus Pudge, Lion, Viper and Lich. */
export const DEFAULT_ENEMIES: readonly string[] = ['shadow_fiend', 'pudge', 'lion', 'viper', 'lich'];
export const DEFAULT_ALLIES: readonly string[] = ['pudge', 'lion', 'viper', 'lich'];
export const ALLY_RANGE = { min: 0, max: 4 } as const;
export const ENEMY_RANGE = { min: 1, max: 5 } as const;

const MATCH_KEY = 'dota-sniper-fps:match';

export interface MenuSetup {
  allies: string[];
  enemies: string[];
  difficulty: Difficulty;
}

/** Heroes the bots can play (everything in HEROES except the player's Sniper). */
export const botHeroIds = (): string[] => Object.values(HEROES).filter((h) => h.id !== 'sniper').map((h) => h.id);

/** Repairs a stored / edited setup: valid hero ids, team sizes in range, known difficulty. Pure. */
export const sanitizeSetup = (raw: unknown, heroIds: readonly string[] = botHeroIds()): MenuSetup => {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fix = (list: unknown, defaults: readonly string[], range: { min: number; max: number }): string[] => {
    const arr = Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string' && heroIds.includes(x)) : [...defaults];
    const out = arr.slice(0, range.max);
    let i = 0;
    while (out.length < range.min) out.push(defaults[i++ % defaults.length] ?? heroIds[0]!);
    return out;
  };
  const difficulty: Difficulty = o.difficulty === 'easy' || o.difficulty === 'hard' || o.difficulty === 'medium' ? o.difficulty : 'medium';
  return { allies: fix(o.allies, DEFAULT_ALLIES, ALLY_RANGE), enemies: fix(o.enemies, DEFAULT_ENEMIES, ENEMY_RANGE), difficulty };
};

/** MatchConfig from a menu setup. */
export const toMatchConfig = (setup: MenuSetup, seed: number): MatchConfig => ({
  seed: seed >>> 0,
  playerHero: 'sniper',
  allies: [...setup.allies],
  enemies: [...setup.enemies],
  difficulty: setup.difficulty,
});

const loadSetup = (): MenuSetup => {
  try {
    const text = window.localStorage.getItem(MATCH_KEY);
    return sanitizeSetup(text ? (JSON.parse(text) as unknown) : null);
  } catch {
    return sanitizeSetup(null);
  }
};

const saveSetup = (s: MenuSetup): void => {
  try {
    window.localStorage.setItem(MATCH_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: nothing to remember.
  }
};

const CONTROLS: Array<[string, string]> = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['LMB', 'Fire'],
  ['RMB / E', 'Scope (Take Aim) — press again to zoom further'],
  ['Q', 'Shrapnel'],
  ['R', 'Assassinate'],
  ['F', 'Town Portal Scroll'],
  ['Ctrl + Q/E/R/G', 'Learn Shrapnel / Take Aim / Assassinate / Headshot'],
  ['Space', 'Jump'],
  ['Shift', 'Walk (silent)'],
  ['B', 'Shop'],
  ['Tab', 'Scoreboard'],
  ['Y', 'Buyback (while dead)'],
  ['Esc', 'Pause / free the mouse'],
];

/** Settings form bound to localStorage settings; changes apply immediately (saveSettings notifies). */
export const createSettingsForm = (): HTMLElement => {
  ensureStyles();
  const s = loadSettings();
  const form = el('div', 'col');
  const slider = (key: 'sensitivity' | 'fov' | 'masterVolume' | 'sfxVolume', label: string, fmt: (v: number) => string): void => {
    const lim = SETTINGS_LIMITS[key];
    const row = el('div', 'menu-row');
    row.innerHTML = `<label>${label}</label><input type="range" min="${lim.min}" max="${lim.max}" step="${lim.step}" value="${s[key]}"><output>${fmt(s[key])}</output>`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('output')!;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = fmt(v);
      saveSettings({ [key]: v } as Partial<GameSettings>);
    });
    form.appendChild(row);
  };
  slider('sensitivity', 'Mouse sensitivity', (v) => v.toFixed(1));
  slider('fov', 'Field of view', (v) => `${Math.round(v)}°`);
  const cast = el('div', 'menu-row');
  cast.innerHTML = `<label>Shrapnel cast</label><div class="menu-seg"><button data-v="1">Quick-cast</button><button data-v="0">Click to confirm</button></div>`;
  const segs = [...cast.querySelectorAll<HTMLButtonElement>('button')];
  const paint = (quick: boolean): void => segs.forEach((b) => b.classList.toggle('on', (b.dataset.v === '1') === quick));
  paint(s.shrapnelQuickCast);
  for (const b of segs) {
    b.addEventListener('click', () => {
      const quick = b.dataset.v === '1';
      paint(quick);
      saveSettings({ shrapnelQuickCast: quick });
    });
  }
  form.appendChild(cast);
  slider('masterVolume', 'Master volume', (v) => `${Math.round(v * 100)}%`);
  slider('sfxVolume', 'SFX volume', (v) => `${Math.round(v * 100)}%`);
  return form;
};

const controlsHtml = (): string => `<div class="menu-keys">${CONTROLS.map(([k, v]) => `<kbd>${esc(k)}</kbd><span>${esc(v)}</span>`).join('')}</div>`;

export interface Menus {
  showMainMenu(): Promise<MatchConfig>;
  /** Pause overlay; resolves with what the player picked. */
  showPause(): Promise<'resume' | 'quit'>;
  /** VICTORY / DEFEAT; resolves when the player returns to the menu. */
  showEnd(winner: Team, stats?: EndStats | null): Promise<void>;
  /** A pause / main menu is on screen. */
  readonly visible: boolean;
  hide(): void;
  dispose(): void;
}

export const createMenus = (root: HTMLElement): Menus => {
  ensureStyles();
  let current: HTMLElement | null = null;
  let cancelCurrent: (() => void) | null = null;

  const mount = (node: HTMLElement): void => {
    cancelCurrent?.();
    current?.remove();
    current = node;
    root.appendChild(node);
  };
  const unmount = (): void => {
    current?.remove();
    current = null;
    cancelCurrent = null;
  };

  const showMainMenu = (): Promise<MatchConfig> => {
    if (document.pointerLockElement) document.exitPointerLock();
    const setup = loadSetup();
    const heroIds = botHeroIds();
    const wrap = el('div', 'menu-root bg');
    wrap.innerHTML = `
      <div class="menu-main">
        <div class="menu-title"><h1>${esc(MENU_TITLE)}</h1><p>Kardel Sharpeye · The Sentinel vs The Scourge</p></div>
        <div class="menu-card wc-panel">
          <h3>Match setup</h3>
          <div class="menu-teams">
            <div class="menu-team sentinel"><h4>The Sentinel <span class="menu-step" data-team="allies"><button data-d="-1">−</button><b></b><button data-d="1">+</button></span></h4><div class="slots"></div></div>
            <div class="menu-team scourge"><h4>The Scourge <span class="menu-step" data-team="enemies"><button data-d="-1">−</button><b></b><button data-d="1">+</button></span></h4><div class="slots"></div></div>
          </div>
          <div class="menu-row"><label>Bot difficulty</label><div class="menu-seg diff"><button data-v="easy">Easy</button><button data-v="medium">Medium</button><button data-v="hard">Hard</button></div></div>
          <p class="menu-note">Allied bots 0–4, enemy bots 1–5. You play Sniper (mid) for the Sentinel.</p>
        </div>
        <div class="menu-card wc-panel">
          <h3>Settings</h3>
          <div class="settings"></div>
          <h3>Controls</h3>
          ${controlsHtml()}
        </div>
        <div class="menu-actions"><button class="wc-btn primary play">Play</button></div>
      </div>`;
    wrap.querySelector('.settings')!.appendChild(createSettingsForm());
    const allySlots = wrap.querySelector<HTMLElement>('.sentinel .slots')!;
    const enemySlots = wrap.querySelector<HTMLElement>('.scourge .slots')!;

    const slotHtml = (team: 'allies' | 'enemies', i: number, id: string): string => {
      const h = HEROES[id]!;
      const options = heroIds.map((hid) => `<option value="${hid}"${hid === id ? ' selected' : ''}>${esc(HEROES[hid]!.name)}</option>`).join('');
      const lane = team === 'enemies' && i === 0 ? 'mid' : '';
      return `<div class="slot"><span class="pt" style="background:linear-gradient(${heroColor(id)},#111)">${heroInitials(h.name)}</span><select data-team="${team}" data-i="${i}">${options}</select><span class="lane">${lane}</span></div>`;
    };

    const render = (): void => {
      const you = `<div class="slot"><span class="pt" style="background:linear-gradient(${heroColor('sniper')},#111)">SN</span><span class="you">Sniper (You)</span><span class="lane">mid</span></div>`;
      allySlots.innerHTML = you + setup.allies.map((id, i) => slotHtml('allies', i, id)).join('');
      enemySlots.innerHTML = setup.enemies.map((id, i) => slotHtml('enemies', i, id)).join('');
      wrap.querySelector('[data-team="allies"] b')!.textContent = String(setup.allies.length);
      wrap.querySelector('[data-team="enemies"] b')!.textContent = String(setup.enemies.length);
      wrap.querySelectorAll<HTMLButtonElement>('.diff button').forEach((b) => b.classList.toggle('on', b.dataset.v === setup.difficulty));
    };
    render();

    wrap.addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      if (sel.tagName !== 'SELECT') return;
      const list = sel.dataset.team === 'allies' ? setup.allies : setup.enemies;
      list[Number(sel.dataset.i)] = sel.value;
      render();
    });
    wrap.querySelectorAll<HTMLElement>('.menu-step').forEach((step) => {
      step.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
        if (!b) return;
        const team = step.dataset.team as 'allies' | 'enemies';
        const list = setup[team];
        const range = team === 'allies' ? ALLY_RANGE : ENEMY_RANGE;
        const defaults = team === 'allies' ? DEFAULT_ALLIES : DEFAULT_ENEMIES;
        if (b.dataset.d === '1' && list.length < range.max) list.push(defaults[list.length % defaults.length]!);
        if (b.dataset.d === '-1' && list.length > range.min) list.pop();
        render();
      });
    });
    wrap.querySelectorAll<HTMLButtonElement>('.diff button').forEach((b) =>
      b.addEventListener('click', () => {
        setup.difficulty = b.dataset.v as Difficulty;
        render();
      }),
    );

    mount(wrap);
    return new Promise<MatchConfig>((resolve) => {
      wrap.querySelector('.play')!.addEventListener('click', () => {
        const clean = sanitizeSetup(setup, heroIds);
        saveSetup(clean);
        unmount();
        // UI-side seed: any value works, the sim derives all randomness from it.
        resolve(toMatchConfig(clean, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0));
      });
    });
  };

  const showPause = (): Promise<'resume' | 'quit'> => {
    const wrap = el('div', 'menu-root dim');
    wrap.innerHTML = `
      <div class="menu-pause wc-panel">
        <h2>PAUSED</h2>
        <div class="col">
          <button class="wc-btn primary" data-a="resume">Resume</button>
          <button class="wc-btn" data-a="settings">Settings</button>
          <div class="settings" hidden></div>
          <button class="wc-btn" data-a="controls">Controls</button>
          <div class="controls" hidden>${controlsHtml()}</div>
          <button class="wc-btn" data-a="quit">Quit to menu</button>
        </div>
      </div>`;
    const settings = wrap.querySelector<HTMLElement>('.settings')!;
    settings.appendChild(createSettingsForm());
    const controls = wrap.querySelector<HTMLElement>('.controls')!;
    // Keep clicks inside the menu from reaching the game canvas.
    wrap.addEventListener('mousedown', (e) => e.stopPropagation());
    mount(wrap);
    return new Promise<'resume' | 'quit'>((resolve) => {
      cancelCurrent = () => resolve('resume');
      wrap.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
        if (!b) return;
        const a = b.dataset.a;
        if (a === 'settings') settings.hidden = !settings.hidden;
        else if (a === 'controls') controls.hidden = !controls.hidden;
        else if (a === 'resume' || a === 'quit') {
          unmount();
          resolve(a);
        }
      });
    });
  };

  return {
    showMainMenu,
    showPause,
    showEnd: async (winner, stats = null) => {
      unmount();
      await showEndScreen(root, winner, stats);
    },
    get visible() {
      return current !== null;
    },
    hide() {
      cancelCurrent?.();
      unmount();
    },
    dispose() {
      cancelCurrent?.();
      unmount();
    },
  };
};
