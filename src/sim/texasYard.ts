// ─────────────────────────────────────────────────────────────
// Texas campus training yard — the "Texas Ops" feeder.
//
// This is the only file to edit to match the real yard:
//   • ANCHOR is one known point on the yard (lat, lng).
//   • Each pole is [east, north] in FEET from the anchor.
//   • Each feeder is the list of poles it runs through, in order.
//   • Devices and transformers sit on poles.
// Every device here gets an NFC/QR tag whose link is /t/<device id>.
// Nothing on the yard is energized: this is a training map only.
// ─────────────────────────────────────────────────────────────
import type { LatLng } from './types';

/** Approximate. Replace with a point measured on the yard. */
export const YARD_ANCHOR: LatLng = [33.1890, -97.1990];

export const YARD_SUB = { id: 'TX', name: 'TEXAS CAMPUS (TRAINING)', at: [0, 0] as [number, number], mva: 5 };

/** Poles: [east, north] in feet from the anchor. */
export const YARD_POLES: Record<string, [number, number]> = {
  // Feeder A runs north, then east
  P1: [0, 120], P2: [0, 260], P3: [0, 400], P4: [140, 400], P5: [280, 400], P6: [420, 400],
  // Feeder B runs east, then north
  P11: [120, 0], P12: [260, 0], P13: [400, 0], P14: [420, 140], P15: [420, 270],
};

export type YardDevType = 'switch' | 'recloser' | 'cap';
export interface YardFeeder {
  id: string; color: string; ratingA: number;
  /** Poles in order from the substation. */
  route: string[];
  devs: Record<string, { type: YardDevType; id: string; scada: boolean }>;
  /** Transformers (each with its fused cutout) and the load they serve. */
  xfmrs: Record<string, { name: string; kw: number; cust: number; critical?: boolean }>;
}

export const YARD_FEEDERS: YardFeeder[] = [
  {
    id: 'TX-4110', color: '#e07a5f', ratingA: 200,
    route: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
    devs: {
      P1: { type: 'switch', id: 'S-4111', scada: false },
      P3: { type: 'recloser', id: 'R-4113', scada: true },
      P5: { type: 'switch', id: 'S-4115', scada: false },
    },
    xfmrs: {
      P2: { name: 'YARD CLASSROOM A', kw: 45, cust: 1 },
      P4: { name: 'SHOP BUILDING', kw: 60, cust: 1 },
      P6: { name: 'POLE YARD LIGHTING', kw: 15, cust: 1 },
    },
  },
  {
    id: 'TX-4120', color: '#81b29a', ratingA: 200,
    route: ['P11', 'P12', 'P13', 'P14', 'P15'],
    devs: {
      P11: { type: 'switch', id: 'S-4121', scada: false },
      P13: { type: 'switch', id: 'S-4123', scada: true },
      P14: { type: 'cap', id: 'CAP-4124', scada: false },
    },
    xfmrs: {
      P12: { name: 'GAS LAB', kw: 40, cust: 1 },
      P13: { name: 'TRAINING OFFICE', kw: 35, cust: 1, critical: true },
      P15: { name: 'EQUIPMENT BARN', kw: 30, cust: 1 },
    },
  },
];

/** Normally open ties between yard poles. */
export const YARD_TIES: { id: string; from: string; to: string; fromFeeder: string; toFeeder: string; scada: boolean }[] = [
  { id: 'TS-4119', from: 'P6', to: 'P15', fromFeeder: 'TX-4110', toFeeder: 'TX-4120', scada: false },
];

export const YARD_FEEDER_IDS = YARD_FEEDERS.map(f => f.id);
export const isYardFeeder = (id: string | undefined) => !!id && YARD_FEEDER_IDS.includes(id);

/** Feet east/north of the anchor to lat/lng. */
export function yardPos([e, n]: [number, number]): LatLng {
  const m = 0.3048;
  return [YARD_ANCHOR[0] + (n * m) / 111320, YARD_ANCHOR[1] + (e * m) / (111320 * Math.cos((YARD_ANCHOR[0] * Math.PI) / 180))];
}

/** Every operable yard device with where it is — for the crew phone, tag labels and map. */
export interface YardDevice { id: string; kind: string; pole: string; xy: [number, number]; scada: boolean; feeder: string; }
export function yardDeviceList(): YardDevice[] {
  const out: YardDevice[] = [];
  const kindOf: Record<YardDevType, string> = { switch: 'Switch', recloser: 'Recloser', cap: 'Capacitor bank' };
  for (const f of YARD_FEEDERS) {
    const n = f.id.slice(3);
    out.push({ id: `CB-${n}`, kind: 'Breaker', pole: 'Sub', xy: YARD_SUB.at, scada: true, feeder: f.id });
    out.push({ id: `D-${n}L`, kind: 'Getaway disconnect', pole: 'Sub', xy: YARD_SUB.at, scada: false, feeder: f.id });
    for (const [pole, d] of Object.entries(f.devs)) {
      if (d.type === 'recloser') {
        const k = d.id.slice(2);
        out.push({ id: `D-${k}A`, kind: 'Recloser source disconnect', pole, xy: YARD_POLES[pole], scada: false, feeder: f.id });
        out.push({ id: d.id, kind: 'Recloser', pole, xy: YARD_POLES[pole], scada: d.scada, feeder: f.id });
        out.push({ id: `D-${k}B`, kind: 'Recloser load disconnect', pole, xy: YARD_POLES[pole], scada: false, feeder: f.id });
        out.push({ id: `BP-${k}`, kind: 'Recloser bypass switch', pole, xy: YARD_POLES[pole], scada: false, feeder: f.id });
      } else out.push({ id: d.id, kind: kindOf[d.type], pole, xy: YARD_POLES[pole], scada: d.scada, feeder: f.id });
    }
  }
  for (const t of YARD_TIES) out.push({ id: t.id, kind: 'Tie switch (normally open)', pole: t.to, xy: YARD_POLES[t.to], scada: t.scada, feeder: t.toFeeder });
  return out;
}
