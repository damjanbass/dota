// CSS for the kit's ability-specific overlays (AoE charge pips, Assassinate reticle, TP map, channel bar, toasts).
const STYLE_ID = 'sniper-kit-style';

const CSS = `
.kit-root { position: absolute; inset: 0; pointer-events: none; font-family: Verdana, Tahoma, sans-serif; }
.kit-pips { position: absolute; left: 50%; top: calc(50% + 30px); transform: translateX(-50%); display: flex; gap: 5px;
  align-items: center; opacity: 0.85; }
.kit-pips.off { display: none; }
.kit-pips b { font: bold 10px Verdana, sans-serif; color: #ffd27a; text-shadow: 0 1px 2px #000; margin-right: 2px; }
.kit-pip { width: 9px; height: 9px; border-radius: 50%; border: 1px solid rgba(255,210,122,0.9); box-shadow: 0 0 2px #000;
  background: conic-gradient(rgba(255,190,90,0.95) var(--p, 0%), rgba(0,0,0,0.35) 0); }
.kit-pip.full { background: #ffbe5a; box-shadow: 0 0 5px rgba(255,170,60,0.9); }
.kit-armed { position: absolute; left: 50%; top: calc(50% + 48px); transform: translateX(-50%); font: bold 11px Verdana, sans-serif;
  color: #ffb347; text-shadow: 0 1px 2px #000; letter-spacing: 1px; white-space: nowrap; }
.kit-armed.off { display: none; }
.kit-toast { position: absolute; left: 50%; top: 64%; transform: translateX(-50%); padding: 4px 12px; border-radius: 3px;
  background: rgba(0,0,0,0.55); font: bold 13px Verdana, sans-serif; color: #ff6a5a; text-shadow: 0 1px 2px #000;
  opacity: 0; transition: opacity 0.25s; white-space: nowrap; }
.kit-toast.info { color: #ffe08a; }
.kit-toast.show { opacity: 1; transition: none; }

.kit-rt { position: absolute; left: 50%; top: 50%; width: 0; height: 0; display: none; --c: rgba(200,200,200,0.85); }
.kit-rt.on { display: block; }
.kit-rt.lock { --c: #ff3a2a; }
.kit-rt svg { position: absolute; left: -60px; top: -60px; width: 120px; height: 120px; overflow: visible; }
.kit-rt circle { fill: none; stroke-width: 3; }
.kit-rt .bg { stroke: rgba(0,0,0,0.45); stroke-width: 5; }
.kit-rt .fg { stroke: var(--c); transform: rotate(-90deg); filter: drop-shadow(0 0 3px rgba(255,40,20,0.8)); }
.kit-rt .tick { stroke: var(--c); stroke-width: 1.5; opacity: 0.8; }
.kit-rt i { position: absolute; width: 14px; height: 14px; border: 0 solid var(--c); filter: drop-shadow(0 0 2px #000); }
.kit-rt i.tl { border-left-width: 2px; border-top-width: 2px; }
.kit-rt i.tr { border-right-width: 2px; border-top-width: 2px; }
.kit-rt i.bl { border-left-width: 2px; border-bottom-width: 2px; }
.kit-rt i.br { border-right-width: 2px; border-bottom-width: 2px; }
.kit-rt .lbl, .kit-rt .tgt, .kit-rt .hint { position: absolute; left: 0; transform: translateX(-50%); white-space: nowrap;
  text-shadow: 0 1px 2px #000, 0 0 6px rgba(0,0,0,0.8); }
.kit-rt .lbl { top: -92px; font: bold 13px Verdana, sans-serif; letter-spacing: 3px; color: var(--c); }
.kit-rt .tgt { top: 70px; font: bold 12px Verdana, sans-serif; color: #fff; }
.kit-rt .hint { top: 90px; font: 10px Verdana, sans-serif; color: rgba(255,255,255,0.7); }
.kit-flash { position: absolute; inset: 0; background: radial-gradient(circle at 50% 55%, rgba(255,235,190,0.55), rgba(255,140,60,0.15) 40%, rgba(0,0,0,0) 70%);
  opacity: 0; }
.kit-flash.show { animation: kit-flash 0.32s ease-out forwards; }
@keyframes kit-flash { 0% { opacity: 1; } 100% { opacity: 0; } }

.kit-ch { position: absolute; left: 50%; top: 70%; transform: translateX(-50%); width: 300px; display: none; text-align: center; }
.kit-ch.on { display: block; }
.kit-ch .t { font: bold 12px Verdana, sans-serif; color: #bfeaff; letter-spacing: 1px; text-shadow: 0 1px 2px #000; margin-bottom: 4px; }
.kit-ch .bar { height: 8px; border: 1px solid rgba(160,220,255,0.8); background: rgba(0,0,0,0.55); box-shadow: 0 0 6px rgba(80,180,255,0.5); }
.kit-ch .bar div { height: 100%; width: 0; background: linear-gradient(90deg, #3aa0ff, #bff0ff); }
.kit-ch .h { margin-top: 4px; font: 10px Verdana, sans-serif; color: rgba(255,255,255,0.75); text-shadow: 0 1px 2px #000; }
.kit-tpv { position: absolute; inset: -20%; opacity: 0; display: none;
  background: repeating-conic-gradient(from 0deg, rgba(90,190,255,0.0) 0deg, rgba(90,190,255,0.16) 12deg, rgba(90,190,255,0.0) 24deg);
  -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 38%, #000 75%);
  mask-image: radial-gradient(circle at 50% 50%, transparent 38%, #000 75%);
  animation: kit-spin 2.4s linear infinite; }
.kit-tpv.on { display: block; }
@keyframes kit-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.kit-map { position: absolute; inset: 0; display: none; pointer-events: auto; z-index: 50; cursor: crosshair;
  background: rgba(4,8,6,0.82); }
.kit-map.on { display: block; }
.kit-map canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
`;

export const ensureKitStyles = (): void => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
};
