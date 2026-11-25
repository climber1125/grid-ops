// Texas Ops yard drawing — shared by the crew phone and the console (view + editor).
// Draws from a YardDoc so the editor can show a draft. Drag to pan, wheel / pinch /
// buttons to zoom. Pole numbers appear once you're zoomed in enough to read them.
import { useEffect, useMemo, useRef, useState } from 'react';
import { YARD_AREAS, YARD_PARKING, yardXY, type YardDoc, type YardDocLink } from '../sim/texasYard';
import type { YardSnap } from './backend';
import './yardsvg.css';

type XY = [number, number];
export interface YardEditHooks {
  /** Pole clicked (or tapped). */
  onPole?(id: string): void;
  /** Span clicked (index into doc.links). */
  onSpan?(i: number): void;
  /** Empty map clicked, in yard units. */
  onEmpty?(xy: XY): void;
  /** Pole dragged to a new spot (only when `drag` is true). */
  onMove?(id: string, xy: XY): void;
  drag?: boolean;
  selected?: string | null;
  /** First pole of a span being drawn. */
  pending?: string | null;
}

const DEV_COLOR = (st: { open: boolean } | undefined) => (!st ? '#6b7480' : st.open ? '#1e8e3e' : '#d93025');

export function YardSvg({ doc, snap, me, highlight, edit, height = '60vh', labelPx = 9, minLabelZoom = 1.8 }: {
  doc: YardDoc; snap?: YardSnap | null; me?: string; highlight?: Set<string>;
  edit?: YardEditHooks; height?: string; labelPx?: number; minLabelZoom?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [px, setPx] = useState<[number, number]>([400, 400]);
  const base = useMemo(() => {
    const pts: XY[] = [...Object.values(doc.poles).map(p => p.xy), ...YARD_AREAS.flatMap(a => a.poly)];
    const x0 = Math.min(...pts.map(p => p[0])) - 10, x1 = Math.max(...pts.map(p => p[0])) + 10;
    const y0 = Math.min(...pts.map(p => p[1])) - 10, y1 = Math.max(...pts.map(p => p[1])) + 10;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [vb, setVb] = useState(base);
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const upd = () => { const r = el.getBoundingClientRect(); setPx([r.width || 400, r.height || 400]); };
    const ro = new ResizeObserver(upd);
    ro.observe(el); upd();
    return () => ro.disconnect();
  }, []);
  const zoom = base.w / vb.w;
  const u = Math.max(vb.w / px[0], vb.h / px[1]); // yard units per screen pixel
  const showIds = zoom >= minLabelZoom;

  const toYard = (cx: number, cy: number): XY => {
    const r = svg.current!.getBoundingClientRect();
    const sx = vb.w / r.width, sy = vb.h / r.height, s = Math.max(sx, sy);
    const ox = (r.width * s - vb.w) / 2, oy = (r.height * s - vb.h) / 2; // xMidYMid meet
    return [vb.x + (cx - r.left) * s - ox, vb.y + (cy - r.top) * s - oy];
  };
  const zoomAt = (f: number, at?: XY) => setVb(v => {
    const nw = Math.min(base.w * 1.2, Math.max(base.w / 12, v.w / f)), k = nw / v.w;
    const c = at ?? [v.x + v.w / 2, v.y + v.h / 2];
    return { x: c[0] - (c[0] - v.x) * k, y: c[1] - (c[1] - v.y) * k, w: nw, h: v.h * k };
  });

  // pan / pinch / drag-a-pole
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'pole'; id?: string; start: XY; vb0: typeof vb; moved: boolean; dist0?: number } | null>(null);
  const onDown = (ev: React.PointerEvent) => {
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    ptrs.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const poleId = (ev.target as Element).getAttribute('data-pole');
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      gesture.current = { kind: 'pan', start: toYard((a.x + b.x) / 2, (a.y + b.y) / 2), vb0: vb, moved: true, dist0: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    gesture.current = { kind: poleId && edit?.drag ? 'pole' : 'pan', id: poleId ?? undefined, start: [ev.clientX, ev.clientY], vb0: vb, moved: false };
  };
  const onMoveP = (ev: React.PointerEvent) => {
    if (!ptrs.current.has(ev.pointerId)) return;
    ptrs.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const g = gesture.current; if (!g) return;
    if (ptrs.current.size === 2 && g.dist0) {
      const [a, b] = [...ptrs.current.values()];
      const f = Math.hypot(a.x - b.x, a.y - b.y) / g.dist0;
      const nw = Math.min(base.w * 1.2, Math.max(base.w / 12, g.vb0.w / f)), k = nw / g.vb0.w;
      setVb({ x: g.start[0] - (g.start[0] - g.vb0.x) * k, y: g.start[1] - (g.start[1] - g.vb0.y) * k, w: nw, h: g.vb0.h * k });
      return;
    }
    const dx = ev.clientX - g.start[0], dy = ev.clientY - g.start[1];
    if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
    if (!g.moved) return;
    if (g.kind === 'pole' && g.id) edit?.onMove?.(g.id, toYard(ev.clientX, ev.clientY));
    else { const r = svg.current!.getBoundingClientRect(); const s = Math.max(g.vb0.w / r.width, g.vb0.h / r.height); setVb({ ...g.vb0, x: g.vb0.x - dx * s, y: g.vb0.y - dy * s }); }
  };
  const onUp = (ev: React.PointerEvent) => {
    ptrs.current.delete(ev.pointerId);
    const g = gesture.current;
    if (ptrs.current.size === 0) gesture.current = null;
    if (!g || g.moved || g.dist0) return;
    const t = ev.target as Element;
    const pole = t.getAttribute('data-pole'), span = t.getAttribute('data-span');
    if (pole) edit?.onPole?.(pole);
    else if (span !== null && edit?.onSpan) edit.onSpan(Number(span));
    else edit?.onEmpty?.(toYard(ev.clientX, ev.clientY));
  };
  useEffect(() => {
    const el = svg.current; if (!el) return;
    const wh = (ev: WheelEvent) => { ev.preventDefault(); zoomAt(ev.deltaY < 0 ? 1.25 : 0.8, toYard(ev.clientX, ev.clientY)); };
    el.addEventListener('wheel', wh, { passive: false });
    return () => el.removeEventListener('wheel', wh);
  });

  const P = doc.poles;
  const spanLive = (l: YardDocLink) => {
    if (!snap) return undefined;
    if (l.dev?.no) { const st = snap.dev[l.dev.id]; return st ? !st.open : undefined; }
    return snap.spans?.[[l.a, l.b].sort().join('|')];
  };
  const fCol = (l: YardDocLink) => (l.dev?.no ? '#9aa4b2' : (l.a.startsWith('U') || l.b.startsWith('U')) ? '#c58be0' : '#3b9ae1');
  const devAt = (l: YardDocLink): XY => { const at = P[l.dev!.at]?.xy, o = P[l.dev!.at === l.a ? l.b : l.a]?.xy; if (!at || !o) return [0, 0]; const d = Math.hypot(o[0] - at[0], o[1] - at[1]) || 1, k = Math.min(5, d * 0.3); return [at[0] + ((o[0] - at[0]) / d) * k, at[1] + ((o[1] - at[1]) / d) * k]; };
  const crewAt: Record<string, string[]> = {};
  const gpsXY: Record<string, XY> = {};
  for (const [t, c] of Object.entries(snap?.trucks ?? {})) {
    if (c.gps && Date.now() - c.gps.at < 120_000) { gpsXY[t] = yardXY([c.gps.lat, c.gps.lng]); continue; }
    const k = c.at === 'yard' ? 'YARD' : c.at; (crewAt[k] ??= []).push(t);
  }
  const devPole: Record<string, string> = {};
  for (const l of doc.links) if (l.dev) devPole[l.dev.id] = l.dev.at;
  for (const [fid, src] of Object.entries(doc.sources)) { devPole[`CB-${fid.slice(3)}`] = src; devPole[`D-${fid.slice(3)}L`] = src; }
  const crewXY = (k: string): XY => (k === 'YARD' ? YARD_PARKING : P[k]?.xy ?? (devPole[k] && P[devPole[k]] ? P[devPole[k]].xy : YARD_PARKING));
  const fs = labelPx * u, r = (n: number) => Math.max(n * u, n * 0.25);
  const areaOf = (id: string) => YARD_AREAS.find(a => a.id === P[id]?.area);

  return (
    <div className="yardsvg" ref={wrap} style={{ height }}>
      <div className="ys-tools">
        <button onClick={() => zoomAt(1.5)} title="Zoom in">＋</button>
        <button onClick={() => zoomAt(1 / 1.5)} title="Zoom out">−</button>
        <button onClick={() => setVb(base)} title="Fit the whole yard">Fit</button>
        <span className="ys-hint">{showIds ? 'Pole numbers on' : 'Zoom in for pole numbers'}</span>
      </div>
      <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} style={{ height: '100%' }} className={`ys ${edit ? 'editing' : ''}`}
        onPointerDown={onDown} onPointerMove={onMoveP} onPointerUp={onUp} onPointerCancel={ev => { ptrs.current.delete(ev.pointerId); gesture.current = null; }}>
        <rect x={base.x - base.w} y={base.y - base.h} width={base.w * 3} height={base.h * 3} fill="#10161d" />
        {YARD_AREAS.filter(a => a.poly.length).map(a => <polygon key={a.id} points={a.poly.map(p => p.join(',')).join(' ')} fill={a.color} fillOpacity={0.08} stroke={a.color} strokeWidth={r(1.2)} strokeDasharray={`${r(5)} ${r(4)}`} pointerEvents="none" />)}
        {doc.links.map((l, i) => {
          const a = P[l.a]?.xy, b = P[l.b]?.xy; if (!a || !b) return null;
          const live = spanLive(l);
          return <g key={`s${i}`}>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={live === false ? '#55606e' : fCol(l)} strokeWidth={r(live === false ? 1.6 : 2.6)} strokeDasharray={l.dev?.no || live === false ? `${r(5)} ${r(4)}` : undefined} pointerEvents="none" />
            {edit?.onSpan && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="transparent" strokeWidth={r(12)} data-span={i} style={{ cursor: 'pointer' }} />}
          </g>;
        })}
        {Object.entries(P).map(([id, p]) => {
          const line = p.area === 'LINE', a = areaOf(id), hot = highlight?.has(id), sel = edit?.selected === id || edit?.pending === id;
          // Texas Ops look: line / electrical poles = white dot in a black ring, work poles = orange dot.
          const elec = line || a?.electric;
          const rad = Math.max(r(hot || sel ? 6.5 : p.job ? 5.5 : 4.6), 1.6);
          return <g key={id}>
            <circle cx={p.xy[0]} cy={p.xy[1]} r={rad} data-pole={id}
              fill={elec ? '#f2f5f8' : '#f0a92e'} stroke={sel ? '#ffd33d' : hot ? '#58a6ff' : elec ? '#0b0f14' : '#fff4dc'} strokeWidth={Math.max(r(sel || hot ? 2.6 : elec ? 2.2 : 1.4), 0.5)}
              style={{ cursor: edit ? 'pointer' : undefined }} />
            {p.job && !sel && !hot && <circle cx={p.xy[0]} cy={p.xy[1]} r={rad + r(2.2)} fill="none" stroke="#58a6ff" strokeOpacity={0.7} strokeWidth={r(1.2)} pointerEvents="none" />}
          </g>;
        })}
        {doc.links.filter(l => l.dev).map(l => { const xy = devAt(l), st = snap?.dev[l.dev!.id], s = r(7); return <g key={l.dev!.id} pointerEvents="none">
          <rect x={xy[0] - s / 2} y={xy[1] - s / 2} width={s} height={s} fill={DEV_COLOR(st)} stroke="#fff" strokeWidth={r(1)} />
          <text x={xy[0] + s * 0.8} y={xy[1] - s * 0.6} fontSize={fs} className="ys-dev">{l.dev!.id}{l.dev!.no ? ' N.O.' : ''}</text>
        </g>; })}
        {Object.entries(doc.sources).map(([fid, src]) => { const xy = P[src]?.xy; if (!xy) return null; const st = snap?.dev[`CB-${fid.slice(3)}`], s = r(9); return <g key={fid} pointerEvents="none">
          <rect x={xy[0] - s - r(4)} y={xy[1] - s / 2} width={s} height={s} fill={DEV_COLOR(st)} stroke="#fff" strokeWidth={r(1.2)} />
          <text x={xy[0] - s - r(6)} y={xy[1] + s * 1.4} fontSize={fs} className="ys-dev" textAnchor="end">CB-{fid.slice(3)} {fid === 'TX-4110' ? 'SOURCE 1' : 'SOURCE 2'}</text>
        </g>; })}
        {Object.entries(doc.loads).map(([pid, ld]) => { const xy = P[pid]?.xy; if (!xy || !zoom || zoom < 1.3) return null; return <text key={'ld' + pid} x={xy[0] + r(6)} y={xy[1] + r(12)} fontSize={fs * 0.9} className="ys-load" pointerEvents="none">⌂ {ld.name}</text>; })}
        {YARD_AREAS.filter(a => a.poly.length && a.name).map(a => { const c = a.poly.reduce((s, p) => [s[0] + p[0] / a.poly.length, s[1] + p[1] / a.poly.length], [0, 0]); return <text key={a.id + 't'} x={c[0]} y={c[1]} fontSize={fs * 1.15} className="ys-area" pointerEvents="none">{a.name}</text>; })}
        {showIds && Object.entries(P).map(([id, p]) => <text key={'l' + id} x={p.xy[0]} y={p.xy[1] - r(5.5)} fontSize={fs} className="ys-pid" pointerEvents="none">{id}</text>)}
        {Object.entries(gpsXY).map(([t, p]) => <g key={'g' + t} pointerEvents="none">
          <circle cx={p[0]} cy={p[1]} r={r(6)} fill={me === t ? '#58a6ff' : '#ffd28a'} stroke="#0a0e14" strokeWidth={r(1.5)} />
          <text x={p[0]} y={p[1] + r(16)} fontSize={fs * 1.2} className={`ys-crew ${me === t ? 'me' : ''}`}>📍 {t}</text>
        </g>)}
        {Object.entries(crewAt).map(([k, ts]) => { const p = crewXY(k); return <text key={'c' + k} x={p[0]} y={p[1] + r(16)} fontSize={fs * 1.2} className={`ys-crew ${me && ts.includes(me) ? 'me' : ''}`} pointerEvents="none">▲ {ts.join(' ')}</text>; })}
      </svg>
    </div>
  );
}
