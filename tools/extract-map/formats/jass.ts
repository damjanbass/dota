// Fact extraction from war3map.j. DotA 6.83d is an "optimized" map: war3mapUnits.doo and war3map.w3r
// are stripped, identifiers are obfuscated and rawcodes are written as integers. Everything the
// extractor needs (preplaced units, rects, creep routes, camps, runes, Roshan) is therefore read from
// the script with a handful of structural patterns. Nothing here depends on obfuscated names; every
// recipe matches the *shape* of standard WE-generated / Blizzard.j-style code.

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PreplacedUnit {
  varName: string;
  player: number;
  typeId: string;
  x: number;
  y: number;
  facingDeg: number;
}

/** A preplaced unit that the script removes and re-creates at the same spot (possibly as another type). */
export interface Rebuild {
  typeId: string;
  facingDeg: number;
  owner: string;
}

export interface AttackOrder {
  /** Owner expression the order applies to, e.g. 'BO[0]'. */
  owner: string;
  /** Location variable the units attack-move to. */
  loc: string;
}

/** A trigger that orders units entering some rects / coming within range of some units to attack-move. */
export interface OrderTrigger {
  rects: string[];
  units: string[];
  orders: AttackOrder[];
}

export interface WaveSpawn {
  /** Count argument: a variable for the regular timed waves, a literal for one-off event spawns. */
  count: string;
  owner: string;
  typeId: string;
  rect: string;
}

export interface CampSpawn {
  rect: string;
  checkRect?: string;
  spawner: string;
  /** Unit type lists, one per random option of the spawner. */
  options: string[][];
}

export interface ScriptFacts {
  rects: Map<string, Rect>;
  playerVars: Map<string, number>;
  preplaced: PreplacedUnit[];
  rebuilds: Map<string, Rebuild>;
  locToRect: Map<string, string>;
  locToUnit: Map<string, string>;
  orderTriggers: OrderTrigger[];
  waveSpawns: WaveSpawn[];
  runeRects: string[];
  neutralLocSpawns: Array<{ typeId: string; rect: string }>;
  /** Rect → number of hero-spawning functions that use its center. */
  heroSpawnRects: Map<string, number>;
  camps: CampSpawn[];
}

const NUM = '(-?\\d+(?:\\.\\d*)?)';
const ID = "(\\d+|'[^']{4}')";
const OWNER = '([\\w]+(?:\\[\\d+\\])?|Player\\(\\d+\\))';

export const rawcode = (token: string): string => {
  if (token.startsWith("'")) return token.slice(1, 5);
  const n = Number(token) >>> 0;
  return String.fromCharCode((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
};

export const rectCenter = (r: Rect): { x: number; y: number } => ({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 });

const splitFunctions = (lines: string[]): Map<string, string[]> => {
  const fns = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of lines) {
    const m = /^function (\w+) takes/.exec(line);
    if (m) {
      current = [];
      fns.set(m[1]!, current);
    } else if (line === 'endfunction') {
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  return fns;
};

export const parseScript = (source: string): ScriptFacts => {
  const lines = source.split(/\r\n|\r|\n/).map((l) => l.trim());
  const fns = splitFunctions(lines);
  const main = fns.get('main') ?? [];
  const allBodies = [...fns.values()];

  // --- rects and player variables (assigned in main / InitMapRects) -------------------------
  const rects = new Map<string, Rect>();
  const rectRe = new RegExp(`^set (\\w+)=Rect\\(${NUM},${NUM},${NUM},${NUM}\\)$`);
  for (const body of [fns.get('CreateRegions') ?? [], main]) {
    for (const l of body) {
      const m = rectRe.exec(l);
      if (m) rects.set(m[1]!, { minX: +m[2]!, minY: +m[3]!, maxX: +m[4]!, maxY: +m[5]! });
    }
  }
  const playerVars = new Map<string, number>();
  for (const l of main) {
    const m = /^set (\w+(?:\[\d+\])?)=Player\((\d+)\)$/.exec(l);
    if (m) playerVars.set(m[1]!, Number(m[2]));
  }

  // --- preplaced units: `set p=Player(N)` followed by `set v=CreateUnit(p,id,x,y,facing)` ------
  const preplaced: PreplacedUnit[] = [];
  const unitRe = new RegExp(`^(?:set (\\w+)=|call )CreateUnit\\(p,${ID},${NUM},${NUM},${NUM}\\)$`);
  let player = -1;
  for (const l of main) {
    const pm = /^set p=Player\((\d+)\)$/.exec(l);
    if (pm) player = Number(pm[1]);
    const m = unitRe.exec(l);
    if (m && player >= 0) {
      preplaced.push({ varName: m[1] ?? '', player, typeId: rawcode(m[2]!), x: +m[3]!, y: +m[4]!, facingDeg: +m[5]! });
    }
  }

  // --- rebuilds: set a=GetUnitX(u) / set b=GetUnitY(u) / set v=CreateUnit(owner,id,a,b,facing) -
  const xOf = new Map<string, string>();
  const yOf = new Map<string, string>();
  const rebuilds = new Map<string, Rebuild>();
  const rebuildRe = new RegExp(`^set \\w+=CreateUnit\\(${OWNER},${ID},(\\w+),(\\w+),${NUM}\\)$`);
  for (const l of lines) {
    const xm = /^set (\w+)=GetUnitX\((\w+)\)$/.exec(l);
    if (xm) xOf.set(xm[1]!, xm[2]!);
    const ym = /^set (\w+)=GetUnitY\((\w+)\)$/.exec(l);
    if (ym) yOf.set(ym[1]!, ym[2]!);
    const m = rebuildRe.exec(l);
    if (m) {
      const u = xOf.get(m[3]!);
      if (u && yOf.get(m[4]!) === u) rebuilds.set(u, { owner: m[1]!, typeId: rawcode(m[2]!), facingDeg: +m[5]! });
    }
  }

  // --- location variables -----------------------------------------------------------------
  const locRects = new Map<string, Set<string>>();
  const locToUnit = new Map<string, string>();
  for (const l of lines) {
    const rm = /^set (\w+)=GetRectCenter\((\w+)\)$/.exec(l);
    if (rm && rects.has(rm[2]!)) {
      const s = locRects.get(rm[1]!) ?? new Set<string>();
      s.add(rm[2]!);
      locRects.set(rm[1]!, s);
    }
    const um = /^set (\w+)=GetUnitLoc\((\w+)\)$/.exec(l);
    if (um) locToUnit.set(um[1]!, um[2]!);
  }
  // Only variables that always hold the same rect center are unambiguous outside their function.
  const locToRect = new Map<string, string>();
  for (const [v, s] of locRects) if (s.size === 1) locToRect.set(v, [...s][0]!);

  // --- attack-move order functions ---------------------------------------------------------
  const ordersOf = (fn: string): AttackOrder[] => {
    const out: AttackOrder[] = [];
    let owner = '';
    for (const l of fns.get(fn) ?? []) {
      const om = /GetOwningPlayer\(GetTriggerUnit\(\)\)==([\w[\]()]+?)\s*then/.exec(l);
      if (om) owner = om[1]!;
      const am = /IssuePointOrderLoc\(GetTriggerUnit\(\),"attack",(\w+)\)/.exec(l);
      if (am && owner) out.push({ owner, loc: am[1]! });
    }
    return out;
  };

  // --- triggers built as `set t=CreateTrigger()` … `set t=null` ------------------------------
  const orderTriggers: OrderTrigger[] = [];
  for (const body of allBodies) {
    let cur: { rects: string[]; units: string[]; fns: string[] } | null = null;
    const flush = (): void => {
      if (!cur) return;
      const orders = cur.fns.flatMap(ordersOf);
      if (orders.length && (cur.rects.length || cur.units.length)) orderTriggers.push({ rects: cur.rects, units: cur.units, orders });
      cur = null;
    };
    for (const l of body) {
      if (l === 'set t=CreateTrigger()') {
        flush();
        cur = { rects: [], units: [], fns: [] };
        continue;
      }
      if (!cur) continue;
      const c: { rects: string[]; units: string[]; fns: string[] } = cur;
      if (l === 'set t=null') {
        flush();
        continue;
      }
      const rm = /RegionAddRect\(\w+,(\w+)\)/.exec(l);
      if (rm) c.rects.push(rm[1]!);
      const um = /TriggerRegisterUnitInRange\(t,(\w+),/.exec(l);
      if (um) c.units.push(um[1]!);
      const fm = /Trigger(?:AddCondition\(t,Condition\(|AddAction\(t,)function (\w+)\)/.exec(l);
      if (fm) c.fns.push(fm[1]!);
    }
    flush();
  }

  // --- per-function scans: wave spawns, Roshan-style loc spawns, hero spawn rects, runes, camps --
  const waveSpawns: WaveSpawn[] = [];
  const neutralLocSpawns: Array<{ typeId: string; rect: string }> = [];
  const heroRects = new Map<string, number>();
  const runeRects = new Set<string>();
  const campCalls: Array<{ rect: string; checkRect?: string; spawner: string }> = [];
  const waveRe = new RegExp(`CreateNUnitsAtLoc\\((\\w+),${ID},${OWNER},(\\w+),`);
  const neutralRe = new RegExp(`CreateUnitAtLoc\\(Player\\(12\\),${ID},(\\w+),`);
  for (const body of allBodies) {
    const localRect = new Map<string, string>();
    const assigned = new Map<string, Set<string>>();
    const aliases = new Map<string, string>();
    let lastCheck: string | undefined;
    const itemRects = new Set<string>();
    let createsItems = false;
    const heroHere = new Set<string>();
    const rectOf = (v: string): string | undefined => localRect.get(v) ?? locToRect.get(v);
    for (const l of body) {
      const rm = /^set (\w+)=GetRectCenter\((\w+)\)$/.exec(l);
      if (rm && rects.has(rm[2]!)) {
        localRect.set(rm[1]!, rm[2]!);
        const s = assigned.get(rm[1]!) ?? new Set<string>();
        s.add(rm[2]!);
        assigned.set(rm[1]!, s);
      }
      const am = /^set (\w+)=(\w+)$/.exec(l);
      if (am && rects.has(am[2]!)) aliases.set(am[1]!, am[2]!);
      const gm = /GroupEnumUnitsInRect\(\w+,(\w+),/.exec(l);
      if (gm) lastCheck = aliases.get(gm[1]!) ?? (rects.has(gm[1]!) ? gm[1]! : undefined);
      const cm = /^call (\w+)\(GetRectCenterX\((\w+)\),GetRectCenterY\(\2\)\)$/.exec(l);
      if (cm) {
        const rect = aliases.get(cm[2]!) ?? (rects.has(cm[2]!) ? cm[2]! : undefined);
        if (rect) campCalls.push({ rect, checkRect: lastCheck, spawner: cm[1]! });
      }
      const wm = waveRe.exec(l);
      if (wm) {
        const rect = rectOf(wm[4]!);
        if (rect) waveSpawns.push({ count: wm[1]!, typeId: rawcode(wm[2]!), owner: wm[3]!, rect });
      }
      const nm = neutralRe.exec(l);
      if (nm) {
        const rect = rectOf(nm[2]!);
        if (rect) neutralLocSpawns.push({ typeId: rawcode(nm[1]!), rect });
      }
      // Random-hero style spawn: CreateUnitAtLoc(player, pool[i], loc, …) where loc is one of two rect centers.
      const hm = /CreateUnitAtLoc\(\w+,\w+\[\w+\],(\w+),/.exec(l);
      if (hm) {
        const s = assigned.get(hm[1]!);
        if (s && s.size === 2) for (const r of s) heroHere.add(r);
      }
      const im = /EnumItemsInRect\((\w+),/.exec(l);
      if (im && rects.has(im[1]!)) itemRects.add(im[1]!);
      if (l.includes('CreateItem(')) createsItems = true;
    }
    if (createsItems && itemRects.size === 2) for (const r of itemRects) runeRects.add(r);
    for (const r of heroHere) heroRects.set(r, (heroRects.get(r) ?? 0) + 1);
  }

  // Camp spawner → random options → unit types created at (x, y).
  const unitsCreatedAtXY = (fn: string): string[] => {
    const out: string[] = [];
    for (const l of fns.get(fn) ?? []) {
      const m = new RegExp(`CreateUnit\\(\\w+,${ID},x,y,`).exec(l);
      if (m) out.push(rawcode(m[1]!));
    }
    return out;
  };
  const camps: CampSpawn[] = campCalls.map((c) => {
    const direct = unitsCreatedAtXY(c.spawner);
    const optionFns = (fns.get(c.spawner) ?? [])
      .map((l) => /^call (\w+)\(x,y\)$/.exec(l)?.[1])
      .filter((f): f is string => f !== undefined);
    const options = direct.length ? [direct] : optionFns.map(unitsCreatedAtXY).filter((o) => o.length > 0);
    return { ...c, options };
  });

  return {
    rects,
    playerVars,
    preplaced,
    rebuilds,
    locToRect,
    locToUnit,
    orderTriggers,
    waveSpawns,
    runeRects: [...runeRects],
    neutralLocSpawns,
    heroSpawnRects: heroRects,
    camps,
  };
};
