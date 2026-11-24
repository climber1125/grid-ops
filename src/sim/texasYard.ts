// ─────────────────────────────────────────────────────────────
// NLC Texas campus yard — the "Texas Ops" map for Scenario Z.
//
// Traced from the Texas Ops screenshots. Every position below is in
// SCREEN UNITS of that whole-yard screenshot (x → east, y → south),
// and CAL turns them into GPS. To lock the yard onto the real ground,
// drop two Google Maps pins (Source 1 pole and the SE corner pole) and
// put their lat/lng in CAL — nothing else has to change.
//
//   Source 1  = westernmost pole in the LAP          (feeder TX-4110)
//   Source 2  = farthest west pole past the URD pit  (feeder TX-4120)
//   TS-4119   = normally open tie next to Source 2
//   TS-4129   = normally open URD loop point at the east end of the pads
//
// Nothing on the yard is energized: "in service" is the training model.
// ─────────────────────────────────────────────────────────────
import type { LatLng } from './types';

type XY = [number, number];

/** Two reference poles: screen units ↔ GPS. ESTIMATED until measured on the yard. */
export const CAL: { a: { pole: string; xy: XY; ll: LatLng }; b: { pole: string; xy: XY; ll: LatLng }; measured: boolean } = (() => {
  // Estimate: whole-yard view ≈ 0.6 m per screen unit, north up, centred on the campus.
  const c: LatLng = [33.1935, -97.17625], c0: XY = [200, 240], m = 0.6;
  const ll = ([x, y]: XY): LatLng => [c[0] - ((y - c0[1]) * m) / 111320, c[1] + ((x - c0[0]) * m) / (111320 * Math.cos((c[0] * Math.PI) / 180))];
  const A: XY = [110.5, 103.7], B: XY = [311.4, 425.7];
  return { a: { pole: 'L1', xy: A, ll: ll(A) }, b: { pole: 'L25', xy: B, ll: ll(B) }, measured: false };
})();

/** Screen units → lat/lng (similarity transform through the two CAL poles). */
export function yardLL([x, y]: XY): LatLng {
  const { a, b } = CAL;
  const k = Math.cos((a.ll[0] * Math.PI) / 180);
  // work in metres-ish local plane: E = lng*k, N = lat
  const pA = [a.ll[1] * k, a.ll[0]], pB = [b.ll[1] * k, b.ll[0]];
  const sA = [a.xy[0], -a.xy[1]], sB = [b.xy[0], -b.xy[1]]; // screen y is down
  const ds = [sB[0] - sA[0], sB[1] - sA[1]], dp = [pB[0] - pA[0], pB[1] - pA[1]];
  const L2 = ds[0] * ds[0] + ds[1] * ds[1];
  const re = (dp[0] * ds[0] + dp[1] * ds[1]) / L2, im = (dp[1] * ds[0] - dp[0] * ds[1]) / L2; // complex scale+rotation
  const v = [x - sA[0], -y - sA[1]];
  const E = pA[0] + re * v[0] - im * v[1], N = pA[1] + im * v[0] + re * v[1];
  return [N, E / k];
}

// ── Line poles (electrical) ─────────────────────────────────
// L = perimeter line and its branches (Source 1 / TX-4110), U = URD (Source 2 / TX-4120).
export const LINE_POLES: Record<string, XY> = {
  // LAP pit
  L1: [110.5, 103.7], L2: [123.2, 117.6], L3: [129.1, 107.5], L4: [142.3, 108.7], L5: [160.9, 106.9], L6: [174.8, 102.2],
  L7: [174.5, 89.2], L8: [175.4, 81.6], L9: [163.6, 95.1], L10: [153.3, 89.0], L11: [144.7, 95.1], L12: [133.5, 91.6],
  // north run, NE corner, east fence line
  L13: [198.7, 79.2], L14: [254.7, 58.6], L15: [327.3, 37.0], L16: [347.1, 55.6], L17: [348.0, 81.9], L18: [347.4, 98.1],
  L19: [347.7, 110.5], L20: [347.7, 124.0], L21: [341.2, 183.0], L22: [340.4, 286.9], L23: [322.7, 380.7], L24: [322.7, 406.8],
  // SE corner and south run
  L25: [311.4, 425.7], L26: [186.1, 421.0], L27: [57.9, 417.3],
  // branch south from L14: distro B, secondary B rack
  L28: [255.9, 70.4], L29: [255.3, 90.7], L30: [256.5, 112.8], L31: [257.1, 153.0], L32: [256.5, 179.5],
  L33: [246.5, 179.2], L34: [239.4, 179.2], L35: [225.8, 178.6], L36: [218.2, 178.6],
  // URD: riser and pad-mounts
  U1: [62.3, 405.1], U2: [83.2, 405.1], U3: [105.8, 405.1], U4: [122.9, 404.5], U5: [137.1, 404.5], U6: [161.5, 404.8],
};

export type YardDevType = 'switch' | 'recloser';
export interface YardFeeder {
  id: string; name: string; color: string; ratingA: number;
  /** Source pole (breaker + getaway disconnect sit here). */
  source: string;
  /** Spans [from, to] in order out from the source; branches are fine. */
  spans: [string, string][];
  /** Device on the span INTO this pole. */
  devs: Record<string, { type: YardDevType; id: string; scada: boolean }>;
  /** Load served at a pole (fused transformer + building / pad). */
  xfmrs: Record<string, { name: string; kw: number; cust: number; critical?: boolean }>;
}
const chain = (...p: string[]): [string, string][] => p.slice(1).map((x, i) => [p[i], x]);

export const YARD_FEEDERS: YardFeeder[] = [
  {
    id: 'TX-4110', name: 'Source 1 — LAP / perimeter', color: '#3b9ae1', ratingA: 200, source: 'L1',
    spans: [
      ...chain('L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'),
      ...chain('L7', 'L9', 'L10', 'L11', 'L12'),
      ...chain('L7', 'L8', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18', 'L19', 'L20', 'L21', 'L22', 'L23', 'L24', 'L25', 'L26'),
      ...chain('L14', 'L28', 'L29', 'L30', 'L31', 'L32', 'L33', 'L34', 'L35', 'L36'),
    ],
    devs: {
      L8: { type: 'switch', id: 'S-4111', scada: false },
      L28: { type: 'switch', id: 'S-4112', scada: false },
      L16: { type: 'recloser', id: 'R-4113', scada: true },
      L21: { type: 'switch', id: 'S-4115', scada: false },
      L25: { type: 'switch', id: 'S-4117', scada: false },
      L26: { type: 'switch', id: 'S-4118', scada: false },
    },
    xfmrs: {
      L4: { name: 'LAP BUILDING', kw: 40, cust: 1 },
      L15: { name: 'EQUIPMENT YARD', kw: 25, cust: 1 },
      L30: { name: 'DISTRO B PIT', kw: 15, cust: 1 },
      L36: { name: 'SECONDARY B RACK', kw: 15, cust: 1 },
      L20: { name: 'EAST SHOPS', kw: 60, cust: 1, critical: true },
      L24: { name: 'SOUTH LAYDOWN LIGHTS', kw: 20, cust: 1 },
      L26: { name: 'SOUTH GATE & CAMERAS', kw: 10, cust: 1, critical: true },
    },
  },
  {
    id: 'TX-4120', name: 'Source 2 — URD', color: '#c58be0', ratingA: 200, source: 'L27',
    spans: chain('L27', 'U1', 'U2', 'U3', 'U4', 'U5', 'U6'),
    devs: { U1: { type: 'switch', id: 'S-4121', scada: false } },
    xfmrs: {
      U2: { name: 'URD PAD 1', kw: 25, cust: 1 }, U3: { name: 'URD PAD 2', kw: 25, cust: 1 }, U4: { name: 'URD PAD 3', kw: 25, cust: 1 },
      U5: { name: 'URD PAD 4', kw: 25, cust: 1 }, U6: { name: 'URD PAD 5', kw: 25, cust: 1 },
    },
  },
];

/** Normally open points. The switch sits at the `to` pole. */
export const YARD_TIES: { id: string; from: string; to: string; fromFeeder: string; toFeeder: string; scada: boolean; name: string }[] = [
  { id: 'TS-4119', from: 'L26', to: 'L27', fromFeeder: 'TX-4110', toFeeder: 'TX-4120', scada: false, name: 'Tie to Source 2 (N.O.)' },
  { id: 'TS-4129', from: 'L26', to: 'U6', fromFeeder: 'TX-4110', toFeeder: 'TX-4120', scada: false, name: 'URD loop open point (N.O.)' },
];

export const YARD_SUB = { id: 'TX', name: 'TEXAS CAMPUS (TRAINING)', mva: 5 };
export const YARD_FEEDER_IDS = YARD_FEEDERS.map(f => f.id);
export const isYardFeeder = (id: string | undefined) => !!id && YARD_FEEDER_IDS.includes(id);

// ── Work areas and their poles (not electrical) ─────────────
export type AreaKind = 'climbing' | 'distro' | 'transmission' | 'secondary' | 'urd' | 'lap' | 'equipment';
export interface YardArea { id: string; name: string; kind: AreaKind; color: string; poly: XY[]; poles: Record<string, XY>; }

/** A rows × cols block of poles between two corner poles. */
function grid(prefix: string, tl: XY, br: XY, cols: number, rows: number): Record<string, XY> {
  const out: Record<string, XY> = {};
  let n = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    out[`${prefix}-${String(++n).padStart(2, '0')}`] = [tl[0] + ((br[0] - tl[0]) * c) / Math.max(1, cols - 1), tl[1] + ((br[1] - tl[1]) * r) / Math.max(1, rows - 1)];
  }
  return out;
}
function list(prefix: string, pts: XY[]): Record<string, XY> {
  return Object.fromEntries(pts.map((p, i) => [`${prefix}-${String(i + 1).padStart(2, '0')}`, p]));
}
// screenshot → screen-unit helpers (south / middle / north close-ups)
const S = ([x, y]: XY): XY => [x * 0.29 + 29.5, y * 0.29 + 256.9];
const M = ([x, y]: XY): XY => [x * 0.295 + 20.6, y * 0.295 + 150.3];
const N = ([x, y]: XY): XY => [x * 0.295 + 73.6, y * 0.295 + 20.8];

export const YARD_AREAS: YardArea[] = [
  { id: 'A1', name: 'Climbing A1', kind: 'climbing', color: '#6fb59a', poly: [S([210, 235]), S([312, 235]), S([312, 338]), S([210, 338])], poles: grid('A1', S([225, 249]), S([297, 323]), 5, 4) },
  { id: 'A2', name: 'Climbing A2', kind: 'climbing', color: '#c98bb9', poly: [S([346, 215]), S([522, 215]), S([522, 337]), S([346, 337])], poles: grid('A2', S([361, 229]), S([505, 323]), 5, 4) },
  { id: 'B1', name: 'Climbing B1', kind: 'climbing', color: '#e3a53c', poly: [M([82, 273]), M([184, 273]), M([184, 398]), M([82, 398])], poles: grid('B1', M([96, 288]), M([170, 383]), 5, 4) },
  { id: 'B2', name: 'Climbing B2', kind: 'climbing', color: '#9b86d1', poly: [M([246, 278]), M([396, 278]), M([396, 405]), M([246, 405])], poles: grid('B2', M([261, 292]), M([381, 390]), 5, 4) },
  { id: 'DA', name: 'Distro A', kind: 'distro', color: '#d08a5c', poly: [S([800, 258]), S([938, 258]), S([938, 407]), S([800, 407])], poles: grid('DA', S([815, 273]), S([921, 393]), 4, 5) },
  { id: 'DB', name: 'Distro B', kind: 'distro', color: '#3fb6d3', poly: [N([480, 185]), N([605, 185]), N([605, 285]), N([480, 285])], poles: grid('DB', N([493, 200]), N([592, 270]), 5, 4) },
  {
    id: 'TA', name: 'Transmission A', kind: 'transmission', color: '#8fb34e', poly: [S([148, 352]), S([532, 352]), S([520, 478]), S([128, 467])],
    poles: list('TA', [[187, 357], [247, 355], [309, 355], [375, 361], [431, 357], [471, 363], [511, 365], [143, 405], [143, 451], [237, 441], [323, 447], [417, 455], [421, 427], [469, 435], [499, 445], [503, 423]].map(p => S(p as XY))),
  },
  {
    id: 'TB', name: 'Transmission B', kind: 'transmission', color: '#4e9ad6', poly: [S([722, 416]), S([980, 416]), S([965, 533]), S([718, 533])],
    poles: list('TB', [[745, 427], [797, 429], [851, 429], [905, 429], [959, 429], [745, 475], [823, 493], [877, 491], [943, 487], [745, 513], [821, 521], [877, 519], [943, 515]].map(p => S(p as XY))),
  },
  {
    id: 'SA', name: 'Secondary A', kind: 'secondary', color: '#d6c84e', poly: [S([618, 392]), S([708, 392]), S([692, 550]), S([605, 525])],
    poles: list('SA', [[641, 409], [685, 409], [637, 439], [685, 439], [633, 513], [679, 519]].map(p => S(p as XY))),
  },
  {
    id: 'LC', name: 'LAP Climbing', kind: 'climbing', color: '#e3a53c', poly: [N([740, 255]), N([828, 255]), N([825, 365]), N([745, 365])],
    poles: list('LC', [[765, 268], [785, 268], [765, 283], [785, 283], [771, 333], [790, 330]].map(p => N(p as XY))),
  },
  { id: 'LAP', name: 'LAP', kind: 'lap', color: '#9b86d1', poly: [N([98, 236]), N([430, 145]), N([445, 345]), N([110, 382])], poles: {} },
  { id: 'SB', name: 'Secondary B', kind: 'secondary', color: '#3fb6d3', poly: [N([475, 437]), N([650, 437]), N([640, 565]), N([472, 565])], poles: {} },
  { id: 'EQ', name: 'Equipment', kind: 'equipment', color: '#6fb59a', poly: [N([630, 80]), N([930, 62]), N([950, 407]), N([632, 397])], poles: {} },
  { id: 'URD', name: 'URD', kind: 'urd', color: '#c96f6f', poly: [S([85, 481]), S([540, 500]), S([540, 578]), S([83, 578])], poles: {} },
];

/** Where crews park ("at the yard"). */
export const YARD_PARKING: XY = [232, 250];

/** All yard poles (line + work-area) in screen units. */
export const ALL_POLES: Record<string, XY> = { ...LINE_POLES, ...Object.assign({}, ...YARD_AREAS.map(a => a.poles)) };
export const areaOfPole = (id: string) => YARD_AREAS.find(a => id in a.poles) ?? null;
export const isLinePole = (id: string) => id in LINE_POLES;
export const poleLL = (id: string): LatLng | null => (ALL_POLES[id] ? yardLL(ALL_POLES[id]) : null);

/**
 * Poles that get an NFC/QR tag for jobs (crossarm change-outs, guying).
 * Two per work area plus four on the perimeter line — with the devices that's ~40 tags.
 */
export const JOB_POLES: string[] = [
  'A1-03', 'A1-18', 'A2-03', 'A2-18', 'B1-03', 'B1-18', 'B2-03', 'B2-18', 'DA-02', 'DA-19', 'DB-03', 'DB-18',
  'TA-04', 'TA-11', 'TB-03', 'TB-12', 'SA-02', 'SA-05', 'LC-01', 'LC-05',
  'L18', 'L22', 'L23', 'L33',
];

// ── Devices (everything with a tag) ─────────────────────────
export interface YardDevice { id: string; kind: string; pole: string; xy: XY; scada: boolean; feeder: string; }
export function yardDeviceList(): YardDevice[] {
  const out: YardDevice[] = [];
  const kindOf: Record<YardDevType, string> = { switch: 'Switch', recloser: 'Recloser' };
  for (const f of YARD_FEEDERS) {
    const n = f.id.slice(3), src = LINE_POLES[f.source];
    out.push({ id: `CB-${n}`, kind: `Breaker (${f.name.split(' — ')[0]})`, pole: f.source, xy: src, scada: true, feeder: f.id });
    out.push({ id: `D-${n}L`, kind: 'Source disconnect', pole: f.source, xy: src, scada: false, feeder: f.id });
    for (const [pole, d] of Object.entries(f.devs)) {
      const xy = LINE_POLES[pole];
      if (d.type === 'recloser') {
        const k = d.id.slice(2);
        out.push({ id: `D-${k}A`, kind: 'Recloser source disconnect', pole, xy, scada: false, feeder: f.id });
        out.push({ id: d.id, kind: 'Recloser', pole, xy, scada: d.scada, feeder: f.id });
        out.push({ id: `D-${k}B`, kind: 'Recloser load disconnect', pole, xy, scada: false, feeder: f.id });
        out.push({ id: `BP-${k}`, kind: 'Recloser bypass switch', pole, xy, scada: false, feeder: f.id });
      } else out.push({ id: d.id, kind: kindOf[d.type], pole, xy, scada: d.scada, feeder: f.id });
    }
  }
  for (const t of YARD_TIES) out.push({ id: t.id, kind: t.name, pole: t.to, xy: LINE_POLES[t.to], scada: t.scada, feeder: t.toFeeder });
  return out;
}

/** Legacy helper kept for callers that place things by screen units. */
export const yardPos = (xy: XY): LatLng => yardLL(xy);
