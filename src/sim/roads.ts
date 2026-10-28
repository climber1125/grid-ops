// ─────────────────────────────────────────────────────────────
// Sparks, TX road network — Denton-inspired, synthetic geometry.
// Arterials form a routable graph; local streets are decorative.
// ─────────────────────────────────────────────────────────────
import type { LatLng } from './types';
import { dist } from './geo';

export interface RoadDef { name: string; short: string; cls: 'hwy' | 'art' | 'col'; pts: LatLng[]; }

const EW = [
  { name: 'Windsor Dr', short: 'Windsor', lat: 33.2445, w: -97.172, e: -97.082, cls: 'art' as const },
  { name: 'University Dr (US 380)', short: 'University', lat: 33.2290, w: -97.176, e: -97.078, cls: 'art' as const },
  { name: 'Oak St', short: 'Oak', lat: 33.2190, w: -97.168, e: -97.104, cls: 'col' as const },
  { name: 'Hickory St', short: 'Hickory', lat: 33.2120, w: -97.168, e: -97.084, cls: 'col' as const },
  { name: 'Eagle Dr', short: 'Eagle', lat: 33.2030, w: -97.166, e: -97.084, cls: 'art' as const },
  { name: 'Hobson Ln', short: 'Hobson', lat: 33.1930, w: -97.168, e: -97.084, cls: 'col' as const },
  { name: 'Ryan Rd', short: 'Ryan', lat: 33.1810, w: -97.162, e: -97.086, cls: 'art' as const },
];
const NS = [
  { name: 'Bonnie Brae St', short: 'Bonnie Brae', lng: -97.1560, s: 33.176, n: 33.254, cls: 'art' as const },
  { name: 'Carroll Blvd', short: 'Carroll', lng: -97.1420, s: 33.180, n: 33.252, cls: 'art' as const },
  { name: 'Elm St', short: 'Elm', lng: -97.1330, s: 33.186, n: 33.252, cls: 'col' as const },
  { name: 'Bell Ave', short: 'Bell', lng: -97.1250, s: 33.180, n: 33.250, cls: 'col' as const },
  { name: 'Woodrow Ln', short: 'Woodrow', lng: -97.1140, s: 33.178, n: 33.252, cls: 'col' as const },
  { name: 'Loop 288', short: 'Loop 288', lng: -97.1020, s: 33.178, n: 33.256, cls: 'art' as const },
  { name: 'Mayhill Rd', short: 'Mayhill', lng: -97.0880, s: 33.176, n: 33.250, cls: 'art' as const },
];
const I35: LatLng[] = [
  [33.1700, -97.1180], [33.1810, -97.1265], [33.1930, -97.1372], [33.2030, -97.1488],
  [33.2120, -97.1600], [33.2200, -97.1640], [33.2290, -97.1652], [33.2445, -97.1668], [33.2600, -97.1690],
];
const DALLAS_DR: LatLng[] = [[33.2120, -97.1330], [33.2030, -97.1250], [33.1930, -97.1140], [33.1810, -97.1020]];

export const ROADS: RoadDef[] = [
  ...EW.map(r => ({ name: r.name, short: r.short, cls: r.cls, pts: [[r.lat, r.w], [r.lat, r.e]] as LatLng[] })),
  ...NS.map(r => ({ name: r.name, short: r.short, cls: r.cls, pts: [[r.s, r.lng], [r.n, r.lng]] as LatLng[] })),
  { name: 'Dallas Dr', short: 'Dallas', cls: 'col', pts: DALLAS_DR },
  { name: 'I-35E', short: 'I-35E', cls: 'hwy', pts: I35 },
];

// ── Zones & decorative features ──────────────────────────────
export type Box = [number, number, number, number]; // s, w, n, e
export interface Zone { name: string; cls: 'res' | 'com' | 'ind' | 'campus' | 'med' | 'park'; b: Box; }
export const ZONES: Zone[] = [
  { name: 'Lake Forest', cls: 'res', b: [33.2300, -97.1720, 33.2520, -97.1585] },
  { name: 'Windsor Heights', cls: 'res', b: [33.2320, -97.1545, 33.2520, -97.1180] },
  { name: 'Northeast Sparks', cls: 'res', b: [33.2215, -97.1110, 33.2520, -97.0850] },
  { name: 'Oak Hill', cls: 'res', b: [33.2135, -97.1510, 33.2265, -97.1365] },
  { name: 'Southridge', cls: 'res', b: [33.1760, -97.1545, 33.2010, -97.1270] },
  { name: 'Hobson Park', cls: 'res', b: [33.1760, -97.1235, 33.2010, -97.1040] },
  { name: 'Southwest Sparks', cls: 'res', b: [33.1760, -97.1720, 33.2040, -97.1585] },
  { name: 'Bell Ave Neighborhood', cls: 'res', b: [33.2195, -97.1320, 33.2270, -97.1160] },
  { name: 'Downtown Sparks', cls: 'com', b: [33.2075, -97.1370, 33.2180, -97.1215] },
  { name: 'University Dr Corridor', cls: 'com', b: [33.2268, -97.1580, 33.2312, -97.0950] },
  { name: 'North Texas State Univ.', cls: 'campus', b: [33.2040, -97.1545, 33.2112, -97.1435] },
  { name: 'Medical District', cls: 'med', b: [33.2195, -97.1625, 33.2268, -97.1575] },
  { name: 'Eastside Industrial Park', cls: 'ind', b: [33.1860, -97.1000, 33.2100, -97.0835] },
  { name: 'Civic Center Park', cls: 'park', b: [33.2128, -97.1205, 33.2178, -97.1160] },
  { name: 'Sparks Memorial Park', cls: 'park', b: [33.1950, -97.1440, 33.1998, -97.1360] },
];
export const CREEK: LatLng[] = [
  [33.2500, -97.1300], [33.2410, -97.1270], [33.2330, -97.1200], [33.2250, -97.1180], [33.2180, -97.1190],
  [33.2100, -97.1150], [33.2010, -97.1080], [33.1920, -97.0990], [33.1820, -97.0950], [33.1720, -97.0900],
];

export function zoneAt(p: LatLng): Zone | null {
  const pri = ['med', 'campus', 'ind', 'com', 'park', 'res'];
  let best: Zone | null = null;
  for (const z of ZONES) {
    if (p[0] >= z.b[0] && p[0] <= z.b[2] && p[1] >= z.b[1] && p[1] <= z.b[3]) {
      if (!best || pri.indexOf(z.cls) < pri.indexOf(best.cls)) best = z;
    }
  }
  return best;
}

/** Decorative local-street grid inside residential / commercial zones. */
export function localStreets(): LatLng[][] {
  const out: LatLng[][] = [];
  for (const z of ZONES) {
    if (z.cls === 'park' || z.cls === 'med') continue;
    const step = z.cls === 'ind' ? 0.0042 : 0.0019;
    for (let lat = z.b[0] + step / 2; lat < z.b[2]; lat += step) out.push([[lat, z.b[1]], [lat, z.b[3]]]);
    for (let lng = z.b[1] + step / 2; lng < z.b[3]; lng += step * 1.25) out.push([[z.b[0], lng], [z.b[2], lng]]);
  }
  return out;
}

// ── Routable graph ───────────────────────────────────────────
interface GNode { id: number; pos: LatLng; name: string; }
interface GEdge { to: number; time: number; }
const gNodes: GNode[] = [];
const gAdj: GEdge[][] = [];
const keyIdx = new Map<string, number>();
const SPEED = { hwy: 26, art: 13, col: 10, ramp: 9 };

function gNode(pos: LatLng, name: string): number {
  const k = pos[0].toFixed(5) + ',' + pos[1].toFixed(5);
  const ex = keyIdx.get(k);
  if (ex !== undefined) { if (name && !gNodes[ex].name) gNodes[ex].name = name; return ex; }
  const id = gNodes.length;
  gNodes.push({ id, pos, name }); gAdj.push([]); keyIdx.set(k, id);
  return id;
}
function gEdge(a: number, b: number, speed: number) {
  const t = dist(gNodes[a].pos, gNodes[b].pos) / speed;
  gAdj[a].push({ to: b, time: t }); gAdj[b].push({ to: a, time: t });
}

(function build() {
  for (const r of EW) {
    const lngs = [r.w, ...NS.filter(n => n.lng > r.w && n.lng < r.e && r.lat >= n.s && r.lat <= n.n).map(n => n.lng), r.e].sort((a, b) => a - b);
    let prev = -1;
    for (const lng of lngs) {
      const ns = NS.find(n => n.lng === lng);
      const id = gNode([r.lat, lng], ns ? `${ns.short} and ${r.short}` : '');
      if (prev >= 0) gEdge(prev, id, SPEED[r.cls]);
      prev = id;
    }
  }
  for (const r of NS) {
    const lats = [r.s, ...EW.filter(e => e.lat > r.s && e.lat < r.n && r.lng >= e.w && r.lng <= e.e).map(e => e.lat), r.n].sort((a, b) => a - b);
    let prev = -1;
    for (const lat of lats) {
      const ew = EW.find(e => e.lat === lat);
      const id = gNode([lat, r.lng], ew ? `${r.short} and ${ew.short}` : '');
      if (prev >= 0) gEdge(prev, id, SPEED[r.cls]);
      prev = id;
    }
  }
  const gridCount = gNodes.length;
  // Dallas Dr endpoints are grid intersections
  let prev = -1;
  for (const p of DALLAS_DR) { const id = gNode(p, ''); if (prev >= 0) gEdge(prev, id, SPEED.col); prev = id; }
  // I-35E + ramps to nearest grid node
  prev = -1;
  for (const p of I35) {
    const id = gNode(p, '');
    if (prev >= 0) gEdge(prev, id, SPEED.hwy);
    prev = id;
    let best = -1, bd = 1e9;
    for (let i = 0; i < gridCount; i++) { const d = dist(p, gNodes[i].pos); if (d < bd) { bd = d; best = i; } }
    if (best >= 0 && bd < 1100) gEdge(id, best, SPEED.ramp);
  }
})();

function nearestNode(p: LatLng): number {
  let best = 0, bd = 1e12;
  for (const n of gNodes) { const d = dist(p, n.pos); if (d < bd) { bd = d; best = n.id; } }
  return best;
}

/** Nearest named intersection, e.g. "Woodrow and Oak". */
export function nearestName(p: LatLng): string {
  let best = '', bd = 1e12;
  for (const n of gNodes) {
    if (!n.name) continue;
    const d = dist(p, n.pos);
    if (d < bd) { bd = d; best = n.name; }
  }
  return best;
}

export interface RouteResult { pts: LatLng[]; cumT: number[]; total: number; }

/** Fastest route along arterials (Dijkstra by travel time). Off-road legs at 6 m/s. */
export function route(a: LatLng, b: LatLng): RouteResult {
  const OFF = 6;
  const s = nearestNode(a), g = nearestNode(b);
  const n = gNodes.length;
  const dt = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dt[s] = 0;
  for (;;) {
    let u = -1, bu = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dt[i] < bu) { bu = dt[i]; u = i; }
    if (u < 0 || u === g) break;
    done[u] = true;
    for (const e of gAdj[u]) if (dt[u] + e.time < dt[e.to]) { dt[e.to] = dt[u] + e.time; prev[e.to] = u; }
  }
  const chain: number[] = [];
  for (let v = g; v >= 0; v = prev[v]) { chain.unshift(v); if (v === s) break; }
  const pts: LatLng[] = [a];
  const cumT = [0];
  const push = (p: LatLng, speed: number) => {
    const last = pts[pts.length - 1];
    const d = dist(last, p);
    if (d < 1) return;
    pts.push(p); cumT.push(cumT[cumT.length - 1] + d / speed);
  };
  // Direct if very close
  if (dist(a, b) < 350) { push(b, OFF); return { pts, cumT, total: cumT[cumT.length - 1] }; }
  push(gNodes[chain[0]].pos, OFF);
  for (let i = 1; i < chain.length; i++) {
    const u = chain[i - 1], v = chain[i];
    const e = gAdj[u].find(x => x.to === v)!;
    const d = dist(gNodes[u].pos, gNodes[v].pos);
    push(gNodes[v].pos, d / Math.max(e.time, 0.01));
  }
  push(b, OFF);
  return { pts, cumT, total: cumT[cumT.length - 1] };
}

export const SERVICE_CENTER: LatLng = [33.2036, -97.1262];
