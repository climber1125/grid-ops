// ─────────────────────────────────────────────────────────────
// Synthetic distribution network for Sparks Municipal Electric.
// Built deterministically from feeder specs that follow the road grid.
// Nothing here represents the actual City of Denton electric system.
// ─────────────────────────────────────────────────────────────
import type { LatLng, Topology, LoadClass, DevEl, LineEl, FeederInfo, Load } from './types';
import { cumLen, pointAt, dirAt, subPath, offset, dist } from './geo';
import { RNG } from './rng';
import { nearestName, zoneAt } from './roads';
import { solve } from './network';

interface DevSpec { f: number; type: 'recloser' | 'switch'; id: string; scada: boolean; }
interface CritSpec { f: number; side: 1 | -1; name: string; cls: LoadClass; kw: number; cust: number; }
interface FeederSpec { id: string; sub: string; color: string; ratingA: number; path: LatLng[]; devs: DevSpec[]; crit: CritSpec[]; }
interface TieSpec { id: string; from: string; to: string; toPos: LatLng; path: LatLng[]; scada: boolean; }

export const SUB_SPECS = [
  { id: 'CH', name: 'CEDAR HOLLOW', bus: [33.2445, -97.1420] as LatLng, pos: [33.2458, -97.1436] as LatLng, mva: 20 },
  { id: 'IW', name: 'IRONWOOD', bus: [33.2120, -97.1140] as LatLng, pos: [33.2109, -97.1124] as LatLng, mva: 20 },
  { id: 'BS', name: 'BLUESTEM', bus: [33.1930, -97.1560] as LatLng, pos: [33.1917, -97.1576] as LatLng, mva: 20 },
];

const FEEDERS: FeederSpec[] = [
  {
    id: 'CH-1210', sub: 'CH', color: '#4e9ad6', ratingA: 400,
    path: [[33.2445, -97.1420], [33.2445, -97.1330], [33.2445, -97.1250], [33.2445, -97.1140], [33.2290, -97.1140]],
    devs: [
      { f: 0.28, type: 'switch', id: 'S-1212', scada: false },
      { f: 0.50, type: 'recloser', id: 'R-1215', scada: true },
      { f: 0.78, type: 'switch', id: 'S-1216', scada: true },
    ],
    crit: [{ f: 0.60, side: 1, name: 'SPARKS FIRE STATION 4', cls: 'critical', kw: 70, cust: 1 }],
  },
  {
    id: 'CH-1220', sub: 'CH', color: '#9b86d1', ratingA: 400,
    path: [[33.2445, -97.1420], [33.2290, -97.1420], [33.2290, -97.1560], [33.2190, -97.1560]],
    devs: [
      { f: 0.22, type: 'switch', id: 'S-1222', scada: false },
      { f: 0.40, type: 'recloser', id: 'R-1225', scada: true },
      { f: 0.68, type: 'switch', id: 'S-1226', scada: true },
      { f: 0.92, type: 'switch', id: 'S-1228', scada: false },
    ],
    crit: [{ f: 0.82, side: -1, name: 'SPARKS REGIONAL MEDICAL CENTER', cls: 'critical', kw: 1250, cust: 1 }],
  },
  {
    id: 'IW-2110', sub: 'IW', color: '#45b5c4', ratingA: 400,
    path: [[33.2120, -97.1140], [33.2190, -97.1140], [33.2190, -97.1250], [33.2190, -97.1330], [33.2290, -97.1330]],
    devs: [
      { f: 0.14, type: 'switch', id: 'S-2112', scada: false },
      { f: 0.38, type: 'switch', id: 'S-2114', scada: false },
      { f: 0.62, type: 'switch', id: 'S-2116', scada: true },
      { f: 0.84, type: 'recloser', id: 'R-2118', scada: true },
    ],
    crit: [{ f: 0.71, side: 1, name: 'SPARKS CITY HALL / 911 COMMUNICATIONS', cls: 'critical', kw: 420, cust: 1 }],
  },
  {
    id: 'IW-2120', sub: 'IW', color: '#c9b27c', ratingA: 400,
    path: [[33.2120, -97.1140], [33.2120, -97.1020], [33.2030, -97.1020], [33.2030, -97.0880], [33.1930, -97.0880]],
    devs: [
      { f: 0.20, type: 'switch', id: 'S-2122', scada: false },
      { f: 0.42, type: 'recloser', id: 'R-2125', scada: true },
      { f: 0.66, type: 'switch', id: 'S-2126', scada: false },
      { f: 0.88, type: 'switch', id: 'S-2128', scada: true },
    ],
    crit: [{ f: 0.80, side: -1, name: 'SPARKS WATER TREATMENT PLANT', cls: 'critical', kw: 800, cust: 1 }],
  },
  {
    id: 'BS-3110', sub: 'BS', color: '#6fb59a', ratingA: 400,
    path: [[33.1930, -97.1560], [33.2030, -97.1560], [33.2030, -97.1420], [33.2120, -97.1420], [33.2120, -97.1560]],
    devs: [
      { f: 0.20, type: 'switch', id: 'S-3112', scada: false },
      { f: 0.40, type: 'recloser', id: 'R-3115', scada: true },
      { f: 0.64, type: 'switch', id: 'S-3116', scada: false },
      { f: 0.86, type: 'switch', id: 'S-3118', scada: true },
    ],
    crit: [{ f: 0.55, side: 1, name: 'NTSU CENTRAL UTILITY PLANT', cls: 'com', kw: 850, cust: 1 }],
  },
  {
    id: 'BS-3120', sub: 'BS', color: '#c98bb9', ratingA: 400,
    path: [[33.1930, -97.1560], [33.1930, -97.1420], [33.1930, -97.1330], [33.1930, -97.1250], [33.1930, -97.1140], [33.2030, -97.1140]],
    devs: [
      { f: 0.20, type: 'switch', id: 'S-3122', scada: false },
      { f: 0.36, type: 'recloser', id: 'R-3123', scada: true },
      { f: 0.55, type: 'switch', id: 'S-3124', scada: false },
      { f: 0.76, type: 'switch', id: 'S-3126', scada: false },
    ],
    crit: [{ f: 0.45, side: -1, name: 'SPARKS SENIOR LIVING CENTER', cls: 'critical', kw: 240, cust: 1 }],
  },
];

const TIES: TieSpec[] = [
  { id: 'TS-11', from: 'CH-1210', to: 'IW-2110', toPos: [33.2190, -97.1140], path: [[33.2290, -97.1140], [33.2190, -97.1140]], scada: false },
  { id: 'TS-12', from: 'IW-2110', to: 'CH-1220', toPos: [33.2290, -97.1420], path: [[33.2290, -97.1330], [33.2290, -97.1420]], scada: false },
  { id: 'TS-13', from: 'BS-3110', to: 'CH-1220', toPos: [33.2190, -97.1560], path: [[33.2120, -97.1560], [33.2190, -97.1560]], scada: true },
  { id: 'TS-14', from: 'BS-3120', to: 'IW-2120', toPos: [33.2030, -97.1020], path: [[33.2030, -97.1140], [33.2030, -97.1020]], scada: false },
];

const STREETS = [
  'Cardinal Dr', 'Willowwood St', 'Laurel Ln', 'Sycamore St', 'Redbud Dr', 'Post Oak Dr', 'Meadow Ln', 'Briarcliff Dr',
  'Stonegate Dr', 'Cherrywood Ln', 'Juniper Ct', 'Ashford Pl', 'Hollyhill Ln', 'Bent Creek Dr', 'Crestview Dr', 'Linden Dr',
  'Magnolia St', 'Overlook Dr', 'Prairie St', 'Ridgecrest Cir', 'Saddlebrook Dr', 'Timberline Dr', 'Wintergreen Ln', 'Yucca Dr',
  'Kingsway Dr', 'Lakeview Blvd', 'Northridge St', 'Parkside Dr', 'Quail Run', 'Ranchview Ct', 'Southfork Dr', 'Thistle Ln',
  'Vista Ridge Dr', 'Wagon Wheel Rd', 'Amber Ln', 'Bluebonnet Dr', 'Coronado Ln', 'Dove Ct', 'Elmhurst Dr', 'Foxcroft Cir',
  'Glenwood Dr', 'Hillside Dr', 'Paintbrush Ln', 'Jasmine Ln', 'Kiowa Dr', 'Lantana Ln', 'Mesquite Dr', 'Nottingham Dr',
  'Oakwood Dr', 'Pinecrest Dr', 'Quarry Rd', 'Rosewood Ln', 'Sunset St', 'Trailwood Dr', 'Valley View Dr', 'Westwood Dr',
  'Yorkshire Dr', 'Zinnia Ln', 'Tanglewood Dr', 'Hartwood Ct', 'Copper Canyon', 'Fairhaven Dr', 'Greenleaf Ct', 'Heritage Trl',
  'Ironbark Ln', 'Lone Star Dr', 'Mustang Dr', 'Pecos Dr', 'Brazos Ct', 'Llano Dr', 'Frio Dr', 'Sabine Ct',
];

function loadProfile(cls: LoadClass, rng: RNG): { cust: number; kwPer: number; kva: number } {
  switch (cls) {
    case 'apt': { const c = rng.int(18, 36); return { cust: c, kwPer: rng.range(1.3, 1.8), kva: 167 }; }
    case 'com': { const c = rng.int(1, 4); return { cust: c, kwPer: rng.range(22, 60), kva: 300 }; }
    case 'ind': return { cust: 1, kwPer: rng.range(110, 240), kva: 750 };
    default: { const c = rng.int(8, 15); return { cust: c, kwPer: rng.range(2.0, 2.8), kva: 50 }; }
  }
}

function clsAt(p: LatLng): LoadClass {
  const z = zoneAt(p);
  if (!z) return 'res';
  if (z.cls === 'ind') return 'ind';
  if (z.cls === 'com' || z.cls === 'med') return 'com';
  if (z.cls === 'campus') return 'apt';
  return 'res';
}

export function buildTopology(): Topology {
  const rng = new RNG(1717);
  const T: Topology = {
    nodes: {}, els: {}, adj: {}, loads: {}, loadIds: [], subs: {}, feeders: {}, feederIds: [], laterals: {},
    devIds: [], switchable: [], ties: [], normParent: {}, normFeeder: {}, loadAnc: {}, devLoads: {}, devCust: {}, totalCustomers: 0,
  };
  let nSeq = 0, txSeq = 4100, streetIdx = 0;
  const mkNode = (pos: LatLng) => { const id = 'N' + (nSeq++); T.nodes[id] = { id, pos }; T.adj[id] = []; return id; };
  const addEl = (el: LineEl | DevEl) => { T.els[el.id] = el; T.adj[el.from].push(el.id); T.adj[el.to].push(el.id); if (el.kind === 'device') T.devIds.push(el.id); };
  const mkDev = (id: string, from: string, to: string, feeder: string, type: DevEl['type'], scada: boolean, normalOpen: boolean, pos: LatLng) =>
    addEl({ id, kind: 'device', from, to, feeder, type, scada, normalOpen, pos, loc: nearestName(pos) });
  const mkLine = (id: string, from: string, to: string, feeder: string, path: LatLng[], ug: boolean, lateral: boolean, tie = false) =>
    addEl({ id, kind: 'line', from, to, feeder, len: cumLen(path).at(-1)!, ug, lateral, tie, path });

  const addLoad = (node: string, feeder: string, pos: LatLng, xfmrFrom: string, cls: LoadClass, lateral: string | undefined, street: string, opts?: { name?: string; kw?: number; cust?: number }) => {
    const id = 'TX-' + (txSeq++);
    const ln = mkNode(pos);
    mkDev(id, xfmrFrom, ln, feeder, 'xfmr', false, false, pos);
    let prof = loadProfile(cls, rng);
    if (opts?.kw) prof = { cust: opts.cust ?? 1, kwPer: opts.kw / (opts.cust ?? 1), kva: Math.round(opts.kw * 1.4 / 100) * 100 };
    const load: Load = {
      id, node: ln, feeder, customers: prof.cust, kwPer: prof.kwPer, cls, name: opts?.name, pos, xfmr: id, lateral,
      kva: prof.kva, addr: opts?.name ? `${opts.name}` : `${rng.int(1, 39) * 100 + rng.int(0, 99)} ${street}`,
    };
    T.loads[id] = load; T.loadIds.push(id);
    void node;
    return load;
  };

  for (const s of SUB_SPECS) {
    const bus = mkNode(s.bus);
    T.subs[s.id] = { id: s.id, name: s.name, pos: s.pos, bus, mva: s.mva, feeders: [] };
  }

  for (const fs of FEEDERS) {
    const num = fs.id.slice(3);
    const sub = T.subs[fs.sub];
    sub.feeders.push(fs.id);
    const cum = cumLen(fs.path);
    const L = cum[cum.length - 1];
    const info: FeederInfo = {
      id: fs.id, sub: fs.sub, color: fs.color, ratingA: fs.ratingA, length: L, breaker: 'CB-' + num,
      mainEls: [], end: '', sch: [], vertNodes: [], ties: [],
    };
    T.feeders[fs.id] = info; T.feederIds.push(fs.id);

    type P = { d: number; kind: 'vertex' | 'dev' | 'lat' | 'crit' | 'com' | 'split'; ref?: any };
    const pts: P[] = [];
    for (let i = 1; i < fs.path.length; i++) pts.push({ d: cum[i], kind: 'vertex' });
    for (const d of fs.devs) pts.push({ d: d.f * L, kind: 'dev', ref: d });
    for (const c of fs.crit) pts.push({ d: c.f * L, kind: 'crit', ref: c });
    // laterals
    const NLAT = 12;
    const devF = fs.devs.map(d => d.f).concat(fs.crit.map(c => c.f));
    for (let k = 0; k < NLAT; k++) {
      let f = 0.05 + (0.92 * (k + 0.5)) / NLAT + rng.range(-0.012, 0.012);
      for (const df of devF) if (Math.abs(f - df) < 0.022) f = df + 0.03;
      pts.push({ d: Math.min(f, 0.985) * L, kind: 'lat', ref: { k, side: k % 2 === 0 ? 1 : -1, len: rng.range(260, 620) } });
    }
    for (let k = 0; k < 4; k++) {
      let f = rng.range(0.08, 0.95);
      for (const df of devF) if (Math.abs(f - df) < 0.02) f += 0.03;
      pts.push({ d: Math.min(f, 0.98) * L, kind: 'com', ref: { side: k % 2 ? 1 : -1 } });
    }
    for (let d = 340; d < L; d += 340) pts.push({ d, kind: 'split' });
    const order = { vertex: 0, split: 1, crit: 2, com: 3, lat: 4, dev: 5 };
    pts.sort((a, b) => a.d - b.d || order[a.kind] - order[b.kind]);

    const n0 = mkNode(fs.path[0]);
    mkDev(info.breaker, sub.bus, n0, fs.id, 'breaker', true, false, fs.path[0]);
    info.sch.push({ kind: 'dev', id: info.breaker, f: 0, node: n0 });
    info.vertNodes.push({ pos: fs.path[0], node: n0 });
    let cur = n0, curD = 0, segSeq = 0;

    for (const p of pts) {
      if (p.d - curD > 3) {
        const pos = pointAt(fs.path, cum, p.d);
        const nn = mkNode(pos);
        const id = `${fs.id}-M${String(++segSeq).padStart(2, '0')}`;
        mkLine(id, cur, nn, fs.id, subPath(fs.path, cum, curD, p.d), false, false);
        info.mainEls.push(id);
        cur = nn; curD = p.d;
      }
      const here = T.nodes[cur].pos;
      const [de, dn] = dirAt(fs.path, cum, Math.min(p.d + 1, L));
      if (p.kind === 'vertex') info.vertNodes.push({ pos: here, node: cur });
      else if (p.kind === 'dev') {
        const n2 = mkNode(here);
        mkDev(p.ref.id, cur, n2, fs.id, p.ref.type, p.ref.scada, false, here);
        info.sch.push({ kind: 'dev', id: p.ref.id, f: p.d / L, node: n2 });
        cur = n2;
      } else if (p.kind === 'crit' || p.kind === 'com') {
        const side = p.ref.side as number;
        const pos = offset(here, -dn * 38 * side, de * 38 * side);
        const cls: LoadClass = p.kind === 'crit' ? p.ref.cls : (clsAt(pos) === 'ind' ? 'ind' : 'com');
        const ld = addLoad(cur, fs.id, pos, cur, cls, undefined, nearestName(pos),
          p.kind === 'crit' ? { name: p.ref.name, kw: p.ref.kw, cust: p.ref.cust } : undefined);
        if (p.kind === 'crit') info.sch.push({ kind: 'load', id: ld.id, f: p.d / L, node: cur });
      } else if (p.kind === 'lat') {
        const { k, side, len } = p.ref;
        const street = STREETS[streetIdx++ % STREETS.length];
        const fuse = `F-${num.slice(0, 3)}${String(k + 1).padStart(2, '0')}`;
        const pe = -dn * side, pn = de * side;          // perpendicular unit vector
        const p0 = offset(here, pe * 14, pn * 14);
        const ln0 = mkNode(p0);
        mkDev(fuse, cur, ln0, fs.id, 'fuse', false, false, p0);
        const lat = { fuse, feeder: fs.id, els: [] as string[], loads: [] as string[], street };
        T.laterals[fuse] = lat;
        const nx = Math.max(3, Math.min(8, Math.round(len / 85)));
        const ug = rng.chance(0.3);
        let prev = ln0, prevPos = p0;
        const cls0 = clsAt(offset(here, pe * len / 2, pn * len / 2));
        for (let i = 1; i <= nx; i++) {
          const pi = offset(p0, pe * len * i / nx, pn * len * i / nx);
          const li = mkNode(pi);
          const lid = `${fuse}-L${i}`;
          mkLine(lid, prev, li, fs.id, [prevPos, pi], ug, true);
          lat.els.push(lid);
          const alt = i % 2 ? 1 : -1;
          const lpos = offset(pi, de * 22 * alt, dn * 22 * alt);
          const ld = addLoad(li, fs.id, lpos, li, cls0 === 'ind' && i > 2 ? 'com' : cls0, fuse, street);
          lat.loads.push(ld.id);
          prev = li; prevPos = pi;
        }
        info.sch.push({ kind: 'lat', id: fuse, f: p.d / L, node: cur });
      }
    }
    info.end = cur;
  }

  // Ties: line from the 'from' feeder's end to an open tie switch at the 'to' feeder's vertex
  for (const ts of TIES) {
    const from = T.feeders[ts.from], to = T.feeders[ts.to];
    let target = to.vertNodes[0];
    for (const v of to.vertNodes) if (dist(v.pos, ts.toPos) < dist(target.pos, ts.toPos)) target = v;
    const tn = mkNode(ts.toPos);
    mkLine(`${ts.id}-LN`, from.end, tn, ts.from, ts.path, false, false, true);
    mkDev(ts.id, tn, target.node, ts.from, 'tie', ts.scada, true, ts.toPos);
    from.ties.push(ts.id); to.ties.push(ts.id); T.ties.push(ts.id);
    from.sch.push({ kind: 'tie', id: ts.id, f: 1, node: from.end });
    const tf = to.vertNodes.indexOf(target);
    to.sch.push({ kind: 'tie', id: ts.id, f: tf / Math.max(1, to.vertNodes.length - 1), node: target.node });
  }
  for (const f of Object.values(T.feeders)) f.sch.sort((a, b) => a.f - b.f);

  T.switchable = T.devIds.filter(id => (T.els[id] as DevEl).type !== 'xfmr');

  // Normal-state tree
  const dev: Record<string, { open: boolean }> = {};
  for (const id of T.devIds) dev[id] = { open: (T.els[id] as DevEl).normalOpen };
  const net = solve(T, dev);
  for (const [n, p] of net.parent) T.normParent[n] = p;
  for (const [n, f] of net.src) T.normFeeder[n] = f;
  const upNode = (n: string): string | null => {
    const p = T.normParent[n]; if (!p) return null;
    const el = T.els[p]; return el.from === n ? el.to : el.from;
  };
  for (const id of T.devIds) { T.devLoads[id] = []; T.devCust[id] = 0; }
  for (const lid of T.loadIds) {
    const anc: string[] = [];
    let n: string | null = T.loads[lid].node;
    while (n) {
      const p = T.normParent[n];
      if (p && T.els[p].kind === 'device') anc.push(p);
      n = upNode(n);
    }
    T.loadAnc[lid] = anc;
    for (const d of anc) { T.devLoads[d].push(lid); T.devCust[d] += T.loads[lid].customers; }
    T.totalCustomers += T.loads[lid].customers;
  }
  return T;
}

export const TOPO: Topology = buildTopology();
