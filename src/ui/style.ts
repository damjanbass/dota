// HUD / menu stylesheet, injected once. System fonts only (no network): Arial Black for the CS-style
// numerals, Palatino / Georgia for WC3-style titles, Verdana / Tahoma for body text.
// --u is one "design pixel" at 1080p, clamped so 720p stays readable and 4K doesn't get tiny.

const CSS = `
.hud, .menu-root { --u: clamp(0.7px, calc(100vh / 1080), 1.6px);
  --cs: 255, 176, 40; --cs-col: rgba(var(--cs), 0.92); --cs-dim: rgba(var(--cs), 0.55);
  --sen: #48d848; --sco: #ff4a3a; --neu: #f0d040; --gold: #f2c94c; --mana: #3d8bff;
  --wc-border: #b58c3c; --panel: rgba(8, 10, 14, 0.82);
  --f-num: "Arial Black", "Segoe UI Black", Impact, sans-serif;
  --f-title: "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
  --f-body: Verdana, Tahoma, "Segoe UI", sans-serif;
  font-family: var(--f-body); color: #eee; }
.hud { position: absolute; inset: 0; pointer-events: none; user-select: none; overflow: hidden; }
.hud * { box-sizing: border-box; }
.hud-glyph { display: inline-block; vertical-align: middle; }
.hud-world { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; pointer-events: none; }
.hud-layer { position: absolute; inset: 0; pointer-events: none; }
.hud-num { font-family: var(--f-num); color: var(--cs-col); text-shadow: 0 0 calc(6 * var(--u)) rgba(0,0,0,0.55), 0 calc(2 * var(--u)) 0 rgba(0,0,0,0.35); letter-spacing: calc(1 * var(--u)); }
.hud-bar { position: relative; height: calc(7 * var(--u)); background: rgba(0,0,0,0.55); border: calc(1 * var(--u)) solid rgba(var(--cs), 0.35); }
.hud-bar > i { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; transform-origin: left center; background: var(--cs-col); }
.hud-bar.mp > i { background: var(--mana); }
.hud-bar.xp { height: calc(5 * var(--u)); border-color: rgba(200,160,255,0.35); }
.hud-bar.xp > i { background: #b88cff; }

/* --- bottom-left: HP / MP / level ------------------------------------------------------- */
.hud-status { position: absolute; left: calc(22 * var(--u)); bottom: calc(18 * var(--u)); display: flex; align-items: flex-end; gap: calc(20 * var(--u)); }
.hud-lvl { position: relative; width: calc(64 * var(--u)); height: calc(64 * var(--u)); }
.hud-lvl canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.hud-lvl b { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--f-num); font-size: calc(26 * var(--u)); color: var(--gold); text-shadow: 0 0 calc(4 * var(--u)) #000; }
.hud-lvl small { position: absolute; left: 0; right: 0; bottom: calc(-16 * var(--u)); text-align: center; font-size: calc(11 * var(--u)); color: #c8b8ff; letter-spacing: calc(1 * var(--u)); text-shadow: 0 0 3px #000; }
.hud-stat { display: flex; flex-direction: column; gap: calc(4 * var(--u)); }
.hud-stat .row { display: flex; align-items: center; gap: calc(8 * var(--u)); line-height: 1; }
.hud-stat .row .hud-glyph { width: calc(30 * var(--u)); height: calc(30 * var(--u)); color: var(--cs-col); filter: drop-shadow(0 0 calc(3 * var(--u)) rgba(0,0,0,0.6)); }
.hud-stat.mp .row .hud-glyph { color: #7fb2ff; width: calc(24 * var(--u)); height: calc(24 * var(--u)); }
.hud-hp-num { font-size: calc(56 * var(--u)); }
.hud-mp-num { font-size: calc(38 * var(--u)); color: rgba(140, 186, 255, 0.95); }
.hud-stat .max { font-family: var(--f-num); font-size: calc(15 * var(--u)); color: var(--cs-dim); align-self: flex-end; padding-bottom: calc(6 * var(--u)); }
.hud-stat.mp .max { color: rgba(140,186,255,0.6); }
.hud-stat.hp .hud-bar { width: calc(190 * var(--u)); }
.hud-stat.mp .hud-bar { width: calc(140 * var(--u)); border-color: rgba(120,170,255,0.35); }
.hud-status.low .hud-hp-num, .hud-status.low .hp .hud-glyph { color: rgba(255, 50, 40, 0.95); animation: hud-pulse 0.8s ease-in-out infinite; }
.hud-status.low .hp .hud-bar > i { background: rgba(255, 50, 40, 0.95); }
@keyframes hud-pulse { 50% { opacity: 0.55; } }

/* --- minimap (bottom-left, above the numbers) ------------------------------------------- */
.hud-minimap { position: absolute; left: calc(18 * var(--u)); bottom: calc(118 * var(--u)); width: calc(232 * var(--u)); height: calc(232 * var(--u));
  padding: calc(4 * var(--u)); background: linear-gradient(#2a2418, #0c0a06); border: calc(2 * var(--u)) solid var(--wc-border);
  box-shadow: 0 0 0 calc(1 * var(--u)) #000, 0 calc(4 * var(--u)) calc(14 * var(--u)) rgba(0,0,0,0.6); }
.hud-minimap canvas { width: 100%; height: 100%; display: block; image-rendering: auto; }

/* --- bottom-centre: abilities ------------------------------------------------------------ */
.hud-abilities { position: absolute; left: 50%; bottom: calc(16 * var(--u)); transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: calc(6 * var(--u)); }
.hud-learn { font-size: calc(13 * var(--u)); color: #ffe27a; background: rgba(0,0,0,0.6); border: calc(1 * var(--u)) solid rgba(255,210,90,0.5); padding: calc(3 * var(--u)) calc(10 * var(--u)); border-radius: calc(3 * var(--u)); text-shadow: 0 0 calc(4 * var(--u)) #000; animation: hud-pulse 1.4s ease-in-out infinite; }
.hud-learn.off { display: none; }
.hud-slots { display: flex; align-items: flex-end; gap: calc(8 * var(--u)); padding: calc(6 * var(--u)) calc(8 * var(--u)); background: linear-gradient(rgba(20,18,12,0.65), rgba(0,0,0,0.75)); border: calc(1 * var(--u)) solid rgba(181,140,60,0.7); border-radius: calc(4 * var(--u)); }
.hud-slot { position: relative; width: calc(66 * var(--u)); }
.hud-slot.passive { width: calc(50 * var(--u)); }
.hud-slot canvas { display: block; width: 100%; aspect-ratio: 1; border: calc(2 * var(--u)) solid #6b5428; border-radius: calc(3 * var(--u)); background: #000; }
.hud-slot.glow canvas { border-color: #7dff9a; box-shadow: 0 0 calc(12 * var(--u)) rgba(80,255,120,0.75); }
.hud-slot .pips { display: flex; justify-content: center; gap: calc(3 * var(--u)); margin-top: calc(4 * var(--u)); height: calc(6 * var(--u)); }
.hud-slot .pips i { width: calc(9 * var(--u)); height: calc(5 * var(--u)); background: rgba(0,0,0,0.65); border: calc(1 * var(--u)) solid rgba(255,210,90,0.45); }
.hud-slot .pips i.on { background: #ffcf40; border-color: #ffe7a0; box-shadow: 0 0 calc(4 * var(--u)) rgba(255,200,60,0.8); }
.hud-slot .plus { position: absolute; top: calc(-12 * var(--u)); right: calc(-8 * var(--u)); width: calc(24 * var(--u)); height: calc(24 * var(--u)); border-radius: 50%;
  background: radial-gradient(#ffe680, #d09000); color: #2a1800; font: 900 calc(19 * var(--u))/calc(22 * var(--u)) var(--f-num); text-align: center; border: calc(1 * var(--u)) solid #fff3c0;
  box-shadow: 0 0 calc(10 * var(--u)) rgba(255,210,60,0.9); display: none; pointer-events: auto; cursor: pointer; }
.hud-slot.learnable .plus { display: block; }

/* --- bottom-right: gold + inventory ------------------------------------------------------- */
.hud-goldinv { position: absolute; right: calc(22 * var(--u)); bottom: calc(18 * var(--u)); display: flex; flex-direction: column; align-items: flex-end; gap: calc(8 * var(--u)); }
.hud-gold { display: flex; align-items: center; gap: calc(8 * var(--u)); position: relative; }
.hud-gold .hud-glyph { width: calc(32 * var(--u)); height: calc(32 * var(--u)); }
.hud-gold-num { font-size: calc(46 * var(--u)); color: rgba(255, 214, 80, 0.95); transition: color 0.25s; }
.hud-gold.gain .hud-gold-num { color: #6dff6d; transition: none; }
.hud-gold.loss .hud-gold-num { color: #ff5050; transition: none; }
.hud-gold-split { font-size: calc(12 * var(--u)); color: rgba(255,230,160,0.85); text-shadow: 0 0 3px #000; letter-spacing: calc(0.5 * var(--u)); }
.hud-gold-split b { color: #ffe27a; }
.hud-gold-delta { position: absolute; right: 0; top: calc(-22 * var(--u)); font-family: var(--f-num); font-size: calc(20 * var(--u)); color: #6dff6d; text-shadow: 0 0 4px #000; opacity: 0; }
.hud-gold-delta.neg { color: #ff6060; }
.hud-gold-delta.show { animation: hud-rise 1.1s ease-out forwards; }
@keyframes hud-rise { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(calc(-26 * var(--u))); } }
.hud-inv { display: grid; grid-template-columns: repeat(3, calc(52 * var(--u))); gap: calc(5 * var(--u)); padding: calc(6 * var(--u)); background: rgba(0,0,0,0.6); border: calc(1 * var(--u)) solid rgba(181,140,60,0.7); border-radius: calc(4 * var(--u)); }
.hud-inv .slot { position: relative; width: calc(52 * var(--u)); height: calc(52 * var(--u)); border: calc(1 * var(--u)) solid #4a3a1c; background: rgba(20,18,14,0.9) center / cover no-repeat; }
.hud-inv .slot .cd { position: absolute; inset: 0; background: conic-gradient(rgba(0,0,0,0.72) calc(var(--p, 0) * 1turn), transparent 0); }
.hud-inv .slot .n { position: absolute; right: calc(2 * var(--u)); bottom: 0; font: 900 calc(13 * var(--u)) var(--f-num); color: #fff; text-shadow: 0 0 3px #000, 0 0 2px #000; }
.hud-inv .slot .t { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 900 calc(16 * var(--u)) var(--f-num); color: #fff; text-shadow: 0 0 4px #000; }

/* --- top centre ---------------------------------------------------------------------------- */
.hud-top { position: absolute; top: calc(8 * var(--u)); left: 50%; transform: translateX(-50%); display: flex; align-items: stretch; gap: calc(6 * var(--u)); }
.hud-top .team { display: flex; gap: calc(3 * var(--u)); align-items: center; }
.hud-top .team.sco { flex-direction: row-reverse; }
.hud-portrait { position: relative; width: calc(38 * var(--u)); height: calc(30 * var(--u)); border-bottom: calc(3 * var(--u)) solid var(--sen); display: flex; align-items: center; justify-content: center;
  font: 900 calc(12 * var(--u)) var(--f-body); color: #fff; text-shadow: 0 0 3px #000; box-shadow: inset 0 0 calc(8 * var(--u)) rgba(0,0,0,0.7); }
.team.sco .hud-portrait { border-bottom-color: var(--sco); }
.hud-portrait.me { outline: calc(1 * var(--u)) solid #ffe27a; }
.hud-portrait.dead { filter: grayscale(1) brightness(0.45); }
.hud-portrait .rs { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 900 calc(14 * var(--u)) var(--f-num); color: #ff6050; filter: none; }
.hud-portrait.unseen { opacity: 0.55; }
.hud-score { min-width: calc(40 * var(--u)); display: flex; align-items: center; justify-content: center; font: 900 calc(26 * var(--u)) var(--f-num); text-shadow: 0 0 calc(4 * var(--u)) #000; background: rgba(0,0,0,0.55); padding: 0 calc(6 * var(--u)); }
.hud-score.sen { color: var(--sen); }
.hud-score.sco { color: var(--sco); }
.hud-clock { min-width: calc(108 * var(--u)); display: flex; flex-direction: column; align-items: center; justify-content: center; background: linear-gradient(rgba(30,24,12,0.85), rgba(0,0,0,0.85)); border: calc(1 * var(--u)) solid var(--wc-border); border-top: 0; padding: calc(2 * var(--u)) calc(8 * var(--u)) calc(4 * var(--u)); }
.hud-clock .t { font: 900 calc(22 * var(--u)) var(--f-num); color: #f6efe0; letter-spacing: calc(1 * var(--u)); text-shadow: 0 0 calc(3 * var(--u)) #000; }
.hud-clock .dn { display: flex; align-items: center; gap: calc(5 * var(--u)); font-size: calc(10 * var(--u)); color: #c8bfa8; text-transform: uppercase; letter-spacing: calc(1 * var(--u)); }
.hud-clock .dn .hud-glyph { width: calc(16 * var(--u)); height: calc(16 * var(--u)); }
.hud-clock .phase { width: calc(80 * var(--u)); height: calc(3 * var(--u)); background: rgba(255,255,255,0.12); margin-top: calc(3 * var(--u)); }
.hud-clock .phase i { display: block; height: 100%; width: 100%; transform-origin: left; background: #ffd34a; }
.hud-clock.night .phase i { background: #8fa8ff; }

/* --- kill feed (top-right) -------------------------------------------------------------------- */
.hud-feed { position: absolute; top: calc(12 * var(--u)); right: calc(14 * var(--u)); display: flex; flex-direction: column; align-items: flex-end; gap: calc(3 * var(--u)); }
.hud-feed .line { display: flex; align-items: center; gap: calc(7 * var(--u)); padding: calc(3 * var(--u)) calc(8 * var(--u)); background: rgba(0,0,0,0.45); font: bold calc(14 * var(--u)) var(--f-body); white-space: nowrap; text-shadow: 0 0 3px #000; animation: hud-feed-in 0.15s ease-out; }
.hud-feed .line.me { border: calc(2 * var(--u)) solid rgba(220, 40, 40, 0.9); background: rgba(40,0,0,0.55); }
.hud-feed .line .hud-glyph { width: calc(34 * var(--u)); height: calc(21 * var(--u)); }
.hud-feed .sentinel { color: var(--sen); }
.hud-feed .scourge { color: var(--sco); }
.hud-feed .neutral { color: var(--neu); }
.hud-feed .tag { color: #ffd040; font-size: calc(11 * var(--u)); letter-spacing: calc(1 * var(--u)); }
.hud-feed .tag.fb { color: #ff4040; }
@keyframes hud-feed-in { from { opacity: 0; transform: translateX(calc(20 * var(--u))); } }

/* --- announcer (centre) ------------------------------------------------------------------------ */
.hud-announce { position: absolute; left: 0; right: 0; top: 22%; display: flex; flex-direction: column; align-items: center; gap: calc(4 * var(--u)); }
.hud-announce .msg { font: 900 calc(40 * var(--u)) var(--f-title); color: #ffd84a; letter-spacing: calc(2 * var(--u)); text-align: center; padding: 0 calc(20 * var(--u));
  text-shadow: 0 0 calc(12 * var(--u)) rgba(255,120,0,0.6), 0 calc(3 * var(--u)) 0 #000, 0 0 calc(3 * var(--u)) #000; animation: hud-announce 2.6s ease-out forwards; }
.hud-announce .msg.long { font-size: calc(28 * var(--u)); }
.hud-announce .msg.sentinel { color: #8cff7a; text-shadow: 0 0 calc(12 * var(--u)) rgba(40,200,40,0.6), 0 calc(3 * var(--u)) 0 #000; }
.hud-announce .msg.scourge { color: #ff7060; text-shadow: 0 0 calc(12 * var(--u)) rgba(220,40,20,0.6), 0 calc(3 * var(--u)) 0 #000; }
.hud-announce .msg.big { font-size: calc(54 * var(--u)); }
@keyframes hud-announce { 0% { opacity: 0; transform: scale(1.6); } 8% { opacity: 1; transform: scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translateY(calc(-10 * var(--u))); } }

/* --- scoreboard (Tab) ------------------------------------------------------------------------------ */
.hud-score-panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -52%); width: min(calc(980 * var(--u)), 96vw); max-height: 86vh; overflow: hidden;
  background: rgba(0, 0, 0, 0.78); border: calc(1 * var(--u)) solid rgba(255,255,255,0.18); box-shadow: 0 0 calc(30 * var(--u)) rgba(0,0,0,0.8); padding: calc(14 * var(--u)) calc(18 * var(--u)); display: none; }
.hud-score-panel.on { display: block; }
.hud-score-panel h2 { margin: 0 0 calc(8 * var(--u)); display: flex; justify-content: space-between; align-items: baseline; font: bold calc(18 * var(--u)) var(--f-title); color: #f0e6c8; }
.hud-score-panel h2 small { font: calc(12 * var(--u)) var(--f-body); color: #aaa; }
.hud-score-panel table { width: 100%; border-collapse: collapse; font-size: calc(13 * var(--u)); margin-bottom: calc(10 * var(--u)); }
.hud-score-panel th { text-align: left; font-weight: normal; color: #9a9a9a; font-size: calc(11 * var(--u)); text-transform: uppercase; letter-spacing: calc(1 * var(--u)); padding: calc(3 * var(--u)) calc(6 * var(--u)); border-bottom: calc(1 * var(--u)) solid rgba(255,255,255,0.15); }
.hud-score-panel th.team { font: bold calc(15 * var(--u)) var(--f-title); text-transform: none; letter-spacing: 0; }
.hud-score-panel .sentinel th.team { color: var(--sen); }
.hud-score-panel .scourge th.team { color: var(--sco); }
.hud-score-panel td { padding: calc(4 * var(--u)) calc(6 * var(--u)); border-bottom: calc(1 * var(--u)) solid rgba(255,255,255,0.06); white-space: nowrap; }
.hud-score-panel td.num, .hud-score-panel th.num { text-align: center; }
.hud-score-panel .sentinel td { color: #c8f0c0; }
.hud-score-panel .scourge td { color: #f4c4bc; }
.hud-score-panel tr.me td { background: rgba(255, 226, 122, 0.12); color: #ffe9a0; }
.hud-score-panel tr.dead td { opacity: 0.55; }
.hud-score-panel .items { display: flex; gap: calc(2 * var(--u)); }
.hud-score-panel .items i { width: calc(22 * var(--u)); height: calc(22 * var(--u)); background: rgba(255,255,255,0.05) center / cover no-repeat; border: calc(1 * var(--u)) solid rgba(255,255,255,0.1); }
.hud-score-panel .pt { display: inline-flex; width: calc(22 * var(--u)); height: calc(18 * var(--u)); align-items: center; justify-content: center; margin-right: calc(6 * var(--u)); font: 900 calc(9 * var(--u)) var(--f-body); color: #fff; vertical-align: middle; }
.hud-score-panel .rs { color: #ff7060; font-weight: bold; }

/* --- death screen ------------------------------------------------------------------------------------ */
.hud-death { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column; gap: calc(10 * var(--u));
  backdrop-filter: grayscale(1) brightness(0.65); -webkit-backdrop-filter: grayscale(1) brightness(0.65); background: radial-gradient(ellipse at center, rgba(40,0,0,0.15), rgba(0,0,0,0.6)); }
.hud-death.on { display: flex; }
.hud-death .killed { font: bold calc(30 * var(--u)) var(--f-title); color: #f0e6d8; text-shadow: 0 calc(2 * var(--u)) calc(6 * var(--u)) #000; }
.hud-death .killed b { color: #ff6050; }
.hud-death .timer { font: 900 calc(84 * var(--u)) var(--f-num); color: var(--cs-col); text-shadow: 0 0 calc(10 * var(--u)) #000; line-height: 1; }
.hud-death .sub { font-size: calc(14 * var(--u)); color: #cfc8bc; text-transform: uppercase; letter-spacing: calc(3 * var(--u)); }
.hud-death .bb { pointer-events: auto; margin-top: calc(10 * var(--u)); }
.hud-death .hint { font-size: calc(13 * var(--u)); color: #aaa; }
.hud-death .hint kbd { font: bold calc(12 * var(--u)) var(--f-body); color: #ffe27a; border: calc(1 * var(--u)) solid #6b5428; padding: 0 calc(5 * var(--u)); background: rgba(0,0,0,0.6); }

/* --- shared WC3 panel + buttons -------------------------------------------------------------------------- */
.wc-panel { background: linear-gradient(rgba(22,20,16,0.96), rgba(8,8,10,0.96)); border: calc(2 * var(--u)) solid var(--wc-border); box-shadow: 0 0 0 calc(1 * var(--u)) #000, 0 calc(10 * var(--u)) calc(40 * var(--u)) rgba(0,0,0,0.8); border-radius: calc(4 * var(--u)); }
.wc-btn { pointer-events: auto; cursor: pointer; font: bold calc(15 * var(--u)) var(--f-title); color: #ffd860; background: linear-gradient(#4a3a1c, #1c140a); border: calc(2 * var(--u)) solid #8a6a2c; border-radius: calc(3 * var(--u));
  padding: calc(8 * var(--u)) calc(22 * var(--u)); text-shadow: 0 calc(1 * var(--u)) 0 #000; letter-spacing: calc(1 * var(--u)); }
.wc-btn:hover:not(:disabled) { background: linear-gradient(#6a5428, #2c200c); color: #fff2b0; border-color: #d0a040; }
.wc-btn:disabled { filter: grayscale(0.8) brightness(0.7); cursor: default; }
.wc-btn.primary { font-size: calc(20 * var(--u)); padding: calc(10 * var(--u)) calc(40 * var(--u)); }
.wc-btn.small { font-size: calc(12 * var(--u)); padding: calc(4 * var(--u)) calc(10 * var(--u)); }

/* --- shop (B) ------------------------------------------------------------------------------------------------ */
.hud-shop { position: absolute; right: calc(30 * var(--u)); top: 50%; transform: translateY(-54%); width: min(calc(900 * var(--u)), 94vw); height: min(calc(640 * var(--u)), 84vh); display: none; flex-direction: column; pointer-events: auto; }
.hud-shop.on { display: flex; }
.hud-shop header { display: flex; align-items: center; justify-content: space-between; padding: calc(10 * var(--u)) calc(14 * var(--u)); border-bottom: calc(1 * var(--u)) solid rgba(181,140,60,0.5); }
.hud-shop header h2 { margin: 0; font: bold calc(22 * var(--u)) var(--f-title); color: #ffd860; text-shadow: 0 calc(2 * var(--u)) 0 #000; }
.hud-shop header .gold { font: 900 calc(20 * var(--u)) var(--f-num); color: #ffd650; display: flex; align-items: center; gap: calc(6 * var(--u)); }
.hud-shop header .gold .hud-glyph { width: calc(22 * var(--u)); height: calc(22 * var(--u)); }
.hud-shop .near { display: flex; gap: calc(10 * var(--u)); padding: calc(6 * var(--u)) calc(14 * var(--u)); font-size: calc(12 * var(--u)); color: #aaa; border-bottom: calc(1 * var(--u)) solid rgba(255,255,255,0.08); }
.hud-shop .near span { padding: calc(2 * var(--u)) calc(8 * var(--u)); border-radius: calc(10 * var(--u)); background: rgba(255,255,255,0.06); }
.hud-shop .near span.ok { background: rgba(60,200,60,0.2); color: #9cff9c; }
.hud-shop .body { flex: 1; display: flex; min-height: 0; }
.hud-shop nav { width: calc(170 * var(--u)); border-right: calc(1 * var(--u)) solid rgba(181,140,60,0.35); padding: calc(8 * var(--u)) 0; overflow-y: auto; }
.hud-shop nav button { pointer-events: auto; cursor: pointer; display: block; width: 100%; text-align: left; background: none; border: 0; border-left: calc(3 * var(--u)) solid transparent; padding: calc(7 * var(--u)) calc(12 * var(--u)); color: #d8cfb8; font: bold calc(14 * var(--u)) var(--f-title); }
.hud-shop nav button small { display: block; font: calc(10 * var(--u)) var(--f-body); color: #8a8270; margin-top: calc(1 * var(--u)); }
.hud-shop nav button.on { background: rgba(255,210,90,0.1); border-left-color: #ffd860; color: #ffe9a0; }
.hud-shop nav button:hover { background: rgba(255,255,255,0.05); }
.hud-shop .grid { flex: 1; padding: calc(10 * var(--u)); overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(92 * var(--u)), 1fr)); gap: calc(8 * var(--u)); align-content: start; }
.hud-shop .card { pointer-events: auto; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: calc(3 * var(--u)); padding: calc(6 * var(--u)); background: rgba(255,255,255,0.04); border: calc(1 * var(--u)) solid rgba(255,255,255,0.08); border-radius: calc(3 * var(--u)); color: #ddd; font: calc(11 * var(--u)) var(--f-body); text-align: center; }
.hud-shop .card img { width: calc(52 * var(--u)); height: calc(52 * var(--u)); display: block; }
.hud-shop .card .c { font: 900 calc(12 * var(--u)) var(--f-num); color: #ffd650; }
.hud-shop .card.sel { border-color: #ffd860; background: rgba(255,210,90,0.12); }
.hud-shop .card.poor .c { color: #ff7060; }
.hud-shop .card:hover { border-color: rgba(255,210,90,0.6); }
.hud-shop .detail { width: calc(300 * var(--u)); border-left: calc(1 * var(--u)) solid rgba(181,140,60,0.35); padding: calc(12 * var(--u)); overflow-y: auto; display: flex; flex-direction: column; gap: calc(8 * var(--u)); }
.hud-shop .detail h3 { margin: 0; display: flex; gap: calc(10 * var(--u)); align-items: center; font: bold calc(17 * var(--u)) var(--f-title); color: #ffe9a0; }
.hud-shop .detail h3 img { width: calc(48 * var(--u)); height: calc(48 * var(--u)); }
.hud-shop .detail .cost { font: 900 calc(15 * var(--u)) var(--f-num); color: #ffd650; }
.hud-shop .detail ul { margin: 0; padding-left: calc(16 * var(--u)); font-size: calc(12 * var(--u)); color: #b8e0ff; }
.hud-shop .detail p { margin: 0; font-size: calc(12 * var(--u)); color: #bbb; line-height: 1.4; }
.hud-shop .tree { font-size: calc(12 * var(--u)); }
.hud-shop .tree .node { display: flex; align-items: center; gap: calc(6 * var(--u)); padding: calc(2 * var(--u)) 0; cursor: pointer; pointer-events: auto; color: #ddd; }
.hud-shop .tree .node img { width: calc(22 * var(--u)); height: calc(22 * var(--u)); }
.hud-shop .tree .node .c { margin-left: auto; font: 900 calc(11 * var(--u)) var(--f-num); color: #ffd650; }
.hud-shop .tree .node.owned { color: #8cff8c; }
.hud-shop .tree .node.owned .c::after { content: ' \\2713'; color: #8cff8c; }
.hud-shop .tree .kids { padding-left: calc(16 * var(--u)); border-left: calc(1 * var(--u)) dashed rgba(255,210,90,0.3); margin-left: calc(10 * var(--u)); }
.hud-shop .detail .label { font-size: calc(10 * var(--u)); color: #8a8270; text-transform: uppercase; letter-spacing: calc(1 * var(--u)); }
.hud-shop .buy { display: flex; gap: calc(8 * var(--u)); flex-wrap: wrap; }
.hud-shop .msg { min-height: calc(18 * var(--u)); font-size: calc(13 * var(--u)); color: #ff7060; font-weight: bold; }
.hud-shop .msg.ok { color: #8cff8c; }
.hud-shop footer { padding: calc(6 * var(--u)) calc(14 * var(--u)); font-size: calc(11 * var(--u)); color: #8a8270; border-top: calc(1 * var(--u)) solid rgba(255,255,255,0.08); }
.hud-shop footer kbd { color: #ffe27a; font-weight: bold; }

/* --- end screen ----------------------------------------------------------------------------------------- */
.ui-end { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: calc(14 * var(--u)); pointer-events: auto;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0.45), rgba(0,0,0,0.9)); z-index: 30; }
.ui-end h1 { margin: 0; font: 900 calc(96 * var(--u)) var(--f-title); letter-spacing: calc(10 * var(--u)); text-shadow: 0 0 calc(30 * var(--u)) currentColor, 0 calc(4 * var(--u)) 0 #000; animation: ui-end-in 1s ease-out; }
.ui-end.win h1 { color: #ffd84a; }
.ui-end.lose h1 { color: #d83a2a; }
.ui-end .why { font: italic calc(20 * var(--u)) var(--f-title); color: #e8dcc0; }
.ui-end table { border-collapse: collapse; font-size: calc(13 * var(--u)); min-width: calc(640 * var(--u)); background: rgba(0,0,0,0.5); }
.ui-end th, .ui-end td { padding: calc(4 * var(--u)) calc(10 * var(--u)); border-bottom: calc(1 * var(--u)) solid rgba(255,255,255,0.08); text-align: center; }
.ui-end th { color: #999; font-weight: normal; font-size: calc(11 * var(--u)); text-transform: uppercase; }
.ui-end td:first-child, .ui-end th:first-child { text-align: left; }
.ui-end tr.sentinel td { color: #c8f0c0; }
.ui-end tr.scourge td { color: #f4c4bc; }
.ui-end tr.me td { color: #ffe9a0; background: rgba(255,226,122,0.1); }
.ui-end .facts { display: flex; gap: calc(28 * var(--u)); font-size: calc(13 * var(--u)); color: #ccc; }
.ui-end .facts b { display: block; font: 900 calc(26 * var(--u)) var(--f-num); color: var(--cs-col); }
@keyframes ui-end-in { from { opacity: 0; transform: scale(1.3); letter-spacing: calc(40 * var(--u)); } }

/* --- menus --------------------------------------------------------------------------------------------- */
.menu-root { position: absolute; inset: 0; z-index: 40; pointer-events: auto; display: flex; align-items: center; justify-content: center; }
.menu-root.bg { background:
  radial-gradient(ellipse at 30% 70%, rgba(40,90,40,0.35), transparent 60%),
  radial-gradient(ellipse at 70% 30%, rgba(110,30,30,0.35), transparent 60%),
  linear-gradient(135deg, #0b0f0a, #070708 50%, #120809); }
.menu-root.dim { background: rgba(0,0,0,0.62); backdrop-filter: blur(3px); }
.menu-main { display: grid; grid-template-columns: 1.25fr 1fr; gap: calc(18 * var(--u)); width: min(calc(1180 * var(--u)), 96vw); max-height: 94vh; }
.menu-title { grid-column: 1 / -1; text-align: center; }
.menu-title h1 { margin: 0; font: 900 calc(54 * var(--u)) var(--f-title); color: #ffd860; letter-spacing: calc(3 * var(--u)); text-shadow: 0 0 calc(24 * var(--u)) rgba(255,160,0,0.45), 0 calc(3 * var(--u)) 0 #000; }
.menu-title p { margin: calc(4 * var(--u)) 0 0; color: #b8ab8c; font-size: calc(14 * var(--u)); letter-spacing: calc(4 * var(--u)); text-transform: uppercase; }
.menu-card { padding: calc(14 * var(--u)) calc(18 * var(--u)); display: flex; flex-direction: column; gap: calc(10 * var(--u)); min-height: 0; overflow-y: auto; }
.menu-card h3 { margin: 0; font: bold calc(17 * var(--u)) var(--f-title); color: #ffe9a0; border-bottom: calc(1 * var(--u)) solid rgba(181,140,60,0.4); padding-bottom: calc(5 * var(--u)); }
.menu-row { display: flex; align-items: center; gap: calc(10 * var(--u)); font-size: calc(13 * var(--u)); color: #ddd; }
.menu-row label { min-width: calc(130 * var(--u)); color: #c8bfa8; }
.menu-row output { min-width: calc(48 * var(--u)); text-align: right; font: bold calc(13 * var(--u)) var(--f-body); color: #ffe27a; }
.menu-row input[type=range] { flex: 1; accent-color: #d0a040; }
.menu-seg { display: inline-flex; border: calc(1 * var(--u)) solid #6b5428; border-radius: calc(3 * var(--u)); overflow: hidden; }
.menu-seg button { cursor: pointer; background: rgba(0,0,0,0.4); color: #c8bfa8; border: 0; border-right: calc(1 * var(--u)) solid #6b5428; padding: calc(5 * var(--u)) calc(12 * var(--u)); font: bold calc(12 * var(--u)) var(--f-body); }
.menu-seg button:last-child { border-right: 0; }
.menu-seg button.on { background: linear-gradient(#6a5428, #3a2c10); color: #fff2b0; }
.menu-teams { display: grid; grid-template-columns: 1fr 1fr; gap: calc(14 * var(--u)); }
.menu-team h4 { margin: 0 0 calc(6 * var(--u)); display: flex; justify-content: space-between; align-items: center; font: bold calc(15 * var(--u)) var(--f-title); }
.menu-team.sentinel h4 { color: var(--sen); }
.menu-team.scourge h4 { color: var(--sco); }
.menu-team .slot { display: flex; align-items: center; gap: calc(6 * var(--u)); margin-bottom: calc(4 * var(--u)); font-size: calc(12 * var(--u)); }
.menu-team .slot .pt { width: calc(26 * var(--u)); height: calc(22 * var(--u)); display: inline-flex; align-items: center; justify-content: center; font: 900 calc(10 * var(--u)) var(--f-body); color: #fff; flex: none; }
.menu-team select { flex: 1; background: #15120c; color: #eee; border: calc(1 * var(--u)) solid #4a3a1c; padding: calc(3 * var(--u)); font: calc(12 * var(--u)) var(--f-body); }
.menu-team .you { flex: 1; padding: calc(3 * var(--u)) calc(4 * var(--u)); color: #ffe27a; font-weight: bold; }
.menu-team .lane { color: #8a8270; font-size: calc(10 * var(--u)); min-width: calc(30 * var(--u)); text-align: right; }
.menu-step { display: inline-flex; align-items: center; gap: calc(4 * var(--u)); }
.menu-step button { cursor: pointer; width: calc(22 * var(--u)); height: calc(22 * var(--u)); background: #2a2010; color: #ffd860; border: calc(1 * var(--u)) solid #6b5428; font: bold calc(14 * var(--u)) var(--f-body); line-height: 1; padding: 0; }
.menu-step b { min-width: calc(14 * var(--u)); text-align: center; color: #fff; font-size: calc(13 * var(--u)); }
.menu-keys { display: grid; grid-template-columns: auto 1fr; gap: calc(3 * var(--u)) calc(12 * var(--u)); font-size: calc(12 * var(--u)); color: #ccc; }
.menu-keys kbd { font: bold calc(11 * var(--u)) var(--f-body); color: #ffe27a; background: rgba(0,0,0,0.5); border: calc(1 * var(--u)) solid #6b5428; border-radius: calc(2 * var(--u)); padding: 0 calc(5 * var(--u)); justify-self: start; }
.menu-actions { display: flex; justify-content: center; gap: calc(12 * var(--u)); grid-column: 1 / -1; }
.menu-pause { width: min(calc(520 * var(--u)), 94vw); padding: calc(18 * var(--u)) calc(22 * var(--u)); display: flex; flex-direction: column; gap: calc(12 * var(--u)); }
.menu-pause h2 { margin: 0; text-align: center; font: 900 calc(34 * var(--u)) var(--f-title); color: #ffd860; letter-spacing: calc(4 * var(--u)); text-shadow: 0 calc(3 * var(--u)) 0 #000; }
.menu-pause .col { display: flex; flex-direction: column; gap: calc(8 * var(--u)); }
.menu-note { font-size: calc(11 * var(--u)); color: #8a8270; }
.menu-check { display: flex; align-items: center; gap: calc(8 * var(--u)); font-size: calc(13 * var(--u)); color: #ddd; cursor: pointer; }
.menu-check input { accent-color: #d0a040; width: calc(16 * var(--u)); height: calc(16 * var(--u)); }
`;

const STYLE_ID = 'hud-style';

export const ensureStyles = (): void => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
};

/** Tiny DOM helper: element with class and optional HTML. */
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** Escapes text for innerHTML templates. */
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Sets textContent only when it changed (avoids layout churn). */
export const setText = (node: Node, text: string): void => {
  if (node.textContent !== text) node.textContent = text;
};
