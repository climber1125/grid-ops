// ─────────────────────────────────────────────────────────────
// Switching exercises. An instructor (or the sim) sets the job:
//   • isolate — clear a section of line for a crew to work on
//   • bypass  — take a regulator or recloser out of service with no outage
// The student writes the switching order, submits it for a check, runs it by
// radio, issues the clearance and restores. Each exercise carries the company
// rules it is graded against, because every utility does this differently.
// Everything is recorded into a report file the instructor opens later.
// ─────────────────────────────────────────────────────────────
import type { Engine } from './engine';
import type { DevEl, LineEl, SwStep, SwAction, SimState, Topology } from './types';
import { solve, sectionAround } from './network';
import { ACTION_LABEL, devWord } from './radio';

// ── Company rules ───────────────────────────────────────────
/** fail = not allowed / required, warn = flag it, off = not checked. */
export type RuleLevel = 'fail' | 'warn' | 'off';
export interface CompanyRules {
  /** Closing a parallel between feeders from two different substations. fail = prohibited (break-before-make only). */
  crossSub: RuleLevel;
  /** Reclosing must be blocked on the feeders involved before making a parallel. */
  reclose: RuleLevel;
  /** Line regulators on the feeders involved must be in MANUAL before making a parallel. */
  regManual: RuleLevel;
  /** A capacitor bank in the work section must be put in MANUAL and opened before the section is de-energized. */
  capOff: RuleLevel;
}
export const RULE_PRESETS: Record<string, { name: string; about: string; rules: CompanyRules }> = {
  standard: {
    name: 'Standard',
    about: 'Momentary parallels across substations allowed with approval (flagged). Reclosing, regulator and cap bank rules flagged as best practice.',
    rules: { crossSub: 'warn', reclose: 'warn', regManual: 'warn', capOff: 'warn' },
  },
  strict: {
    name: 'Strict',
    about: 'No parallels between substations (break-before-make). Reclosing blocked and regulators in MANUAL before any parallel. Cap banks off before de-energizing.',
    rules: { crossSub: 'fail', reclose: 'fail', regManual: 'fail', capOff: 'fail' },
  },
  permissive: {
    name: 'Permissive',
    about: 'Parallels across substations allowed. Reclosing, regulator and cap bank handling left to the operator — not graded.',
    rules: { crossSub: 'off', reclose: 'off', regManual: 'off', capOff: 'off' },
  },
};
export const DEFAULT_RULES: CompanyRules = RULE_PRESETS.standard.rules;
export const RULE_TEXT: Record<keyof CompanyRules, string> = {
  crossSub: 'Parallels between two substations',
  reclose: 'Block reclosing before a parallel',
  regManual: 'Regulators to MANUAL before a parallel',
  capOff: 'Cap bank off before de-energizing it',
};

export interface ExerciseDef {
  v: 1;
  id: string;
  title: string;
  /** isolate (default): clear a section of line. bypass: take a regulator or recloser out of service with no outage. */
  kind?: 'isolate' | 'bypass';
  feeder: string;
  /** isolate: main line element the crew works on; the work section is the section around it. bypass: the regulator or recloser id. */
  workEl: string;
  /** What the crew is doing, e.g. "Replace broken crossarm". */
  work: string;
  /** Truck doing the work (and the default switching crew). */
  truck: string;
  /** Minutes the crew works under the clearance. */
  minutes: number;
  /** Show the order check to the student right after they submit. */
  coach: boolean;
  by: 'instructor' | 'generated';
  notes?: string;
  rules?: CompanyRules;
  rulesName?: string;
}

export type StepLike = { dev: string; action: SwAction; exec: string; loop: boolean };
export interface Finding { level: 'fail' | 'warn' | 'info' | 'pass'; text: string; step?: number }
export interface StepCheck { i: number; dev: string; action: SwAction; exec: string; loop: boolean; findings: Finding[]; drop: number; pickup: number }
export interface OrderCheck {
  verdict: 'pass' | 'fail';
  findings: Finding[];
  steps: StepCheck[];
  /** Step index (0-based) after which the work is isolated (section dead and every isolation point open, bypass made). */
  isolatedAt: number | null;
  workCustomers: number;
  /** Customers outside the work section still out once isolated. */
  outsideOutAtIso: number;
  /** Best possible outside outage using the available ties. */
  minOutside: number;
  /** Customers outside the work section that went out during the sequence. */
  momentary: number;
  endNormal: boolean;
}

export interface ExSubmission { t: number; order: string; title: string; steps: StepLike[]; holdAfter?: number; check: OrderCheck }
export interface ExOp { t: number; dev: string; action: SwAction; by: string; order?: string }
export interface ExState {
  def: ExerciseDef;
  student: string;
  startedWall: string;
  finishedWall?: string;
  submissions: ExSubmission[];
  ops: ExOp[];
  /** Unplanned (outside the work section) customer interruptions. */
  unplanned: Record<string, { first: number; last: number; cust: number }>;
  cmiUnplanned: number;
  lastT: number;
  finished: boolean;
  /** Device state when the exercise started. */
  startDev?: SimState['dev'];
}

const rulesOf = (def: ExerciseDef): CompanyRules => ({ ...DEFAULT_RULES, ...(def.rules ?? {}) });

// ── Sections and equipment ──────────────────────────────────
export interface Section { key: string; feeder: string; el: string; bounds: string[]; customers: number; label: string }

/** Every main-line section that has customers, bounded by sectionalizing devices. */
export function listSections(T: Topology): Section[] {
  const out: Section[] = [];
  const seen = new Set<string>();
  for (const fid of T.feederIds) {
    for (const el of T.feeders[fid].mainEls) {
      const sec = sectionAround(T, el);
      const key = [...sec.bounds].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const ns = new Set(sec.nodes);
      let c = 0;
      for (const l of T.loadIds) if (ns.has(T.loads[l].node)) c += T.loads[l].customers;
      if (!c) continue;
      const closed = sec.bounds.filter(b => !(T.els[b] as DevEl).normalOpen);
      const no = sec.bounds.filter(b => (T.els[b] as DevEl).normalOpen);
      const label = `${fid}: ${closed.length > 1 ? `between ${closed.join(' and ')}` : `beyond ${closed[0] ?? '?'}`}${no.length ? ` (N.O. ${no.join(', ')})` : ''} — ${c} customers`;
      out.push({ key, feeder: fid, el, bounds: sec.bounds, customers: c, label });
    }
  }
  return out;
}

/** Equipment that can be taken out of service on its bypass (regulators and reclosers). */
export function listBypassable(T: Topology) {
  return T.devIds.map(id => T.els[id] as DevEl).filter(d => d.type === 'reg' || d.type === 'recloser')
    .map(d => ({ id: d.id, feeder: d.feeder, type: d.type, label: `${d.id} — ${d.type === 'reg' ? 'voltage regulator bank' : 'line recloser'} on ${d.feeder}` }));
}
/** Source/load disconnects and bypass switch of a bypass group. */
export function groupParts(T: Topology, id: string) {
  const d = T.els[id] as DevEl;
  const n = d.type === 'reg' ? id.slice(3) : id.slice(2);
  const src = d.type === 'reg' ? `D-${n}S` : `D-${n}A`, load = d.type === 'reg' ? `D-${n}L` : `D-${n}B`;
  return { dev: d, src, load, bp: `BP-${n}` };
}

export const WORK_TYPES = [
  'Replace broken crossarm',
  'Replace failed pin insulator',
  'Replace cracked pole top and reframe',
  'Replace burned jumper and dead-end shoe',
  'Re-sag primary conductor',
  'Change out a leaning pole',
  'Replace failed lightning arrester and connector',
];
export const BYPASS_WORK: Record<'reg' | 'recloser', string[]> = {
  reg: ['Regulator maintenance — replace control and check oil', 'Replace failed regulator on one phase', 'Regulator inspection and neutral-light repair'],
  recloser: ['Recloser change-out for maintenance', 'Replace recloser control battery and test', 'Recloser oil test and inspection'],
};

/** A random exercise. Mostly section isolations, sometimes an equipment bypass. */
export function generateExercise(T: Topology, rnd: () => number = Math.random, rules?: CompanyRules): ExerciseDef {
  const trucks = ['230', '233', '238', '240'];
  const truck = trucks[Math.floor(rnd() * trucks.length)];
  const id = 'EX-' + Math.floor(1000 + rnd() * 9000);
  if (rnd() < 0.25) {
    const eq = listBypassable(T);
    const pick = eq[Math.floor(rnd() * eq.length)];
    const works = BYPASS_WORK[pick.type as 'reg' | 'recloser'];
    return { v: 1, id, title: `Bypass ${pick.id}`, kind: 'bypass', feeder: pick.feeder, workEl: pick.id, work: works[Math.floor(rnd() * works.length)], truck, minutes: 15, coach: false, by: 'generated', rules };
  }
  const secs = listSections(T).filter(s => s.customers >= 25);
  const s = secs[Math.floor(rnd() * secs.length)];
  const els = T.feeders[s.feeder].mainEls.filter(e => sectionAround(T, e).bounds.slice().sort().join('|') === s.key);
  const workEl = els[Math.floor(rnd() * els.length)] ?? s.el;
  return {
    v: 1, id, title: `Planned work on ${s.feeder}`, kind: 'isolate', feeder: s.feeder, workEl,
    work: WORK_TYPES[Math.floor(rnd() * WORK_TYPES.length)], truck, minutes: 15, coach: false, by: 'generated', rules,
  };
}

// ── Share codes ─────────────────────────────────────────────
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
export function encodeExercise(d: ExerciseDef): string { return b64(JSON.stringify(d)); }
export function decodeExercise(code: string): ExerciseDef | null {
  try { const d = JSON.parse(unb64(code.trim())); return d && d.v === 1 && d.workEl && d.feeder ? d : null; } catch { return null; }
}

// ── Helpers ─────────────────────────────────────────────────
type DevState = SimState['dev'];
const cloneDev = (s: DevState): DevState => { const o: DevState = {}; for (const k in s) o[k] = { ...s[k], tags: [...s[k].tags] }; return o; };
export function normalDevState(e: Engine): DevState {
  const o: DevState = {};
  for (const id of e.T.devIds) {
    const d = e.T.els[id] as DevEl;
    o[id] = { open: d.normalOpen, lockout: false, tags: [], comm: true, ops: 0 };
    if (d.type === 'reg') { o[id].ctl = 'auto'; o[id].tap = e.s.dev[id]?.tap || 6; }
    if (d.type === 'cap') { o[id].ctl = 'auto'; o[id].open = e.s.dev[id]?.open ?? false; }
  }
  return o;
}
/** Is a device in its normal position and control setting? */
function isNormal(e: Engine, st: DevState, id: string) {
  const d = e.T.els[id] as DevEl, s = st[id];
  if (d.type === 'cap') return s.ctl === 'auto';
  if (d.type === 'reg') return s.ctl === 'auto';
  if ((d.type === 'breaker' || d.type === 'recloser') && s.nonReclose) return false;
  return s.open === d.normalOpen;
}

export function workSection(e: Engine, def: ExerciseDef) {
  if (def.kind === 'bypass') {
    const g = groupParts(e.T, def.workEl);
    const nodes = [g.dev.from, g.dev.to];
    return { nodes, bounds: [g.src, g.load], nodeSet: new Set(nodes), loads: [] as string[], vis: [] as string[], points: [g.src, g.load], mustClose: [g.bp], customers: 0 };
  }
  const sec = sectionAround(e.T, def.workEl);
  const ns = new Set(sec.nodes);
  const loads = e.T.loadIds.filter(l => ns.has(e.T.loads[l].node));
  // Breakers and reclosers aren't a visible open: the disconnect between them and the work section must also be open.
  const vis = e.T.devIds.filter(id => { const d = e.T.els[id] as DevEl; return d.type === 'disc' && !!d.vis && sec.bounds.includes(d.vis) && ns.has(d.from) && ns.has(d.to); });
  return { ...sec, nodeSet: ns, loads, vis, points: [...sec.bounds, ...vis], mustClose: [] as string[], customers: loads.reduce((a, l) => a + e.T.loads[l].customers, 0) };
}
export function workLocation(e: Engine, def: ExerciseDef) {
  if (def.kind === 'bypass') { const d = e.T.els[def.workEl] as DevEl; return { pos: d.pos, loc: d.loc }; }
  const el = e.T.els[def.workEl] as LineEl;
  const mid = el.path[Math.floor(el.path.length / 2)] ?? e.T.nodes[el.from].pos;
  return { pos: mid, loc: e.locOf(mid) };
}
/** Cap banks whose tap is inside the work section. */
function capsIn(e: Engine, ns: Set<string>) { return e.T.devIds.filter(id => { const d = e.T.els[id] as DevEl; return d.type === 'cap' && ns.has(d.from); }); }
/** The other feeder a tie switch connects to. */
function tieOther(e: Engine, tie: string, feeder: string) { return e.T.feederIds.find(f => f !== feeder && e.T.feeders[f].ties.includes(tie)) ?? (e.T.els[tie] as DevEl).feeder; }

function feederLoading(e: Engine, dev: DevState) {
  const net = solve(e.T, dev);
  const kw: Record<string, number> = {};
  for (const lid of e.T.loadIds) {
    const n = e.T.loads[lid].node;
    if (!net.en.has(n)) continue;
    const f = net.src.get(n)!;
    kw[f] = (kw[f] ?? 0) + e.loadKw(lid);
  }
  const out: { feeder: string; pct: number }[] = [];
  for (const f of e.T.feederIds) out.push({ feeder: f, pct: (kw[f] ?? 0) / (1.732 * 12.47 * 0.95) / e.T.feeders[f].ratingA });
  return out;
}

/** Customers outside the work section that are out in a given device state. */
function outsideOut(e: Engine, dev: DevState, work: Set<string>) {
  const net = solve(e.T, dev);
  let c = 0; const crit: string[] = [];
  for (const lid of e.T.loadIds) {
    const L = e.T.loads[lid];
    if (work.has(L.node) || net.en.has(L.node)) continue;
    c += L.customers; if (L.cls === 'critical') crit.push(L.name ?? lid);
  }
  return { c, crit, net };
}

/** Best outside-outage achievable with the work isolated, using any combination of normally open ties. */
function bestPickup(e: Engine, def: ExerciseDef) {
  const ws = workSection(e, def);
  const base = normalDevState(e);
  for (const b of ws.points) base[b].open = true;
  for (const b of ws.mustClose) base[b].open = false;
  const ties = e.T.ties.filter(t => !ws.bounds.includes(t));
  let best = { out: Infinity, ties: [] as string[] };
  for (let m = 0; m < 1 << ties.length; m++) {
    const st = cloneDev(base);
    const used: string[] = [];
    ties.forEach((t, i) => { if (m & (1 << i)) { st[t].open = false; used.push(t); } });
    const o = outsideOut(e, st, ws.nodeSet);
    if (o.net.loops.length) continue;
    if (feederLoading(e, st).some(f => f.pct > 1)) continue;
    if (o.c < best.out || (o.c === best.out && used.length < best.ties.length)) best = { out: o.c, ties: used };
  }
  return best;
}
/** Critical customers still out in the best pickup arrangement (unavoidable). */
function bestCrit(e: Engine, def: ExerciseDef) {
  const ws = workSection(e, def), b = bestPickup(e, def);
  const st = normalDevState(e);
  for (const x of ws.points) st[x].open = true;
  for (const x of ws.mustClose) st[x].open = false;
  for (const t of b.ties) st[t].open = false;
  return outsideOut(e, st, ws.nodeSet).crit;
}

/** Apply a control action to a copy of the device state, mirroring Engine.devAction. Returns an error or null. */
function applyControl(e: Engine, st: DevState, s: StepLike): string | null {
  const d = e.T.els[s.dev] as DevEl, x = st[s.dev];
  switch (s.action) {
    case 'manual': case 'auto':
      if (d.type !== 'reg' && d.type !== 'cap') return `${s.dev} has no AUTO/MANUAL control`;
      if (x.ctl === s.action) return `${s.dev} control is already in ${s.action.toUpperCase()}`;
      x.ctl = s.action; return null;
    case 'neutral':
      if (d.type !== 'reg') return `${s.dev} is not a regulator`;
      if (x.ctl !== 'manual') return `${s.dev} is in AUTO — place the control in MANUAL before running it to neutral`;
      x.tap = 0; return null;
    case 'nr-on': case 'nr-off':
      if (d.type !== 'breaker' && d.type !== 'recloser') return `${s.dev} has no reclosing`;
      if (!!x.nonReclose === (s.action === 'nr-on')) return `Reclosing on ${s.dev} is already ${s.action === 'nr-on' ? 'blocked' : 'enabled'}`;
      x.nonReclose = s.action === 'nr-on'; return null;
  }
  return null;
}

// ── Order check ─────────────────────────────────────────────
/**
 * Plays an order out step by step from a device state and reports what would happen.
 * Mirrors what the engine refuses (already in position, not SCADA, tagged, unflagged loop)
 * so the check matches what execution will do, and grades against the exercise's company rules.
 */
export function checkOrder(e: Engine, def: ExerciseDef, steps: StepLike[], holdAfter?: number, start: DevState = normalDevState(e)): OrderCheck {
  const R = rulesOf(def);
  const ws = workSection(e, def);
  const findings: Finding[] = [];
  const res: StepCheck[] = [];
  const ruleF = (lvl: RuleLevel, text: string, step?: number) => { if (lvl !== 'off') findings.push({ level: lvl, text, step }); };
  let st = cloneDev(start);
  let net = solve(e.T, st);
  const wasOut = new Set<string>();
  for (const lid of e.T.loadIds) if (!net.en.has(e.T.loads[lid].node)) wasOut.add(lid);
  let momentary = 0, isolatedAt: number | null = null, outsideAtIso = 0, driveGap = false;
  let lastDrop: { step: number; exec: string; dev: string } | null = null;
  const momSeen = new Set<string>();
  const caps = capsIn(e, ws.nodeSet);
  const capWarned = new Set<string>();
  const isolated = (s: DevState, n: ReturnType<typeof solve>) => ws.points.every(b => s[b].open) && ws.mustClose.every(b => !s[b].open) && ws.nodes.every(x => !n.en.has(x));

  steps.forEach((s, i) => {
    const f: Finding[] = [];
    const sc: StepCheck = { i, dev: s.dev, action: s.action, exec: s.exec, loop: s.loop, findings: f, drop: 0, pickup: 0 };
    res.push(sc);
    const d = e.T.els[s.dev] as DevEl | undefined;
    const n = i + 1;
    if (!d || d.kind !== 'device') { f.push({ level: 'fail', text: `Step ${n}: ${s.dev} is not a device on this system`, step: i }); return; }
    if (s.exec === 'SCADA' && !d.scada) { f.push({ level: 'fail', text: `Step ${n}: ${s.dev} is not SCADA-controllable — assign a truck`, step: i }); return; }
    if (s.exec !== 'SCADA' && !e.s.trucks[s.exec]) f.push({ level: 'warn', text: `Step ${n}: Truck ${s.exec} is not on the roster`, step: i });

    // Control actions (manual/auto/neutral/reclosing)
    if (s.action !== 'open' && s.action !== 'close') {
      const err = applyControl(e, st, s);
      if (err) f.push({ level: 'fail', text: `Step ${n}: ${err}`, step: i });
      return;
    }
    if (d.type === 'reg') { f.push({ level: 'fail', text: `Step ${n}: a regulator isn't opened or closed — use its disconnects and bypass switch`, step: i }); return; }
    if (st[s.dev].open === (s.action === 'open')) { f.push({ level: 'fail', text: `Step ${n}: ${s.dev} is already ${s.action === 'open' ? 'open' : 'closed'} at this point — the crew will report unable`, step: i }); return; }
    if (s.action === 'close' && st[s.dev].tags.length) { f.push({ level: 'fail', text: `Step ${n}: ${s.dev} carries a HOLD tag — close blocked`, step: i }); return; }
    const lb = e.loadBreakIssue(s.dev, s.action, st);
    if (lb) f.push({ level: lb.severe ? 'fail' : 'warn', text: `Step ${n}: ${lb.text}`, step: i });
    const rb = e.regBypassIssue(s.dev, s.action, st);
    if (rb) f.push({ level: 'fail', text: `Step ${n}: ${rb}`, step: i });
    const trial = cloneDev(st); trial[s.dev].open = s.action === 'open';
    const n2 = solve(e.T, trial);
    const madeLoop = n2.loops.length > net.loops.length;
    if (s.action === 'close' && madeLoop && !s.loop) { f.push({ level: 'fail', text: `Step ${n}: closing ${s.dev} parallels ${n2.parallelSubs ? 'two substations' : 'two feeders'} but the step isn't marked LOOP — it will be refused`, step: i }); return; }
    if (madeLoop) {
      // Company rules for making a parallel
      const fa = net.src.get(d.from), fb = net.src.get(d.to);
      const feeders = [...new Set([fa, fb].filter(Boolean) as string[])];
      if (n2.parallelSubs && !net.parallelSubs) {
        if (R.crossSub === 'fail') f.push({ level: 'fail', text: `Step ${n}: closing ${s.dev} parallels two different substations — not permitted under these company rules. Use break-before-make`, step: i });
        else if (R.crossSub === 'warn') f.push({ level: 'warn', text: `Step ${n}: closing ${s.dev} parallels two different substations. Confirm phase angle and get approval, or use break-before-make`, step: i });
      } else if (s.loop) f.push({ level: 'pass', text: `Step ${n}: make-before-break parallel through ${s.dev}${n2.parallelSubs ? '' : ' (same substation)'}`, step: i });
      for (const fid of feeders) {
        const cb = e.T.feeders[fid].breaker;
        if (!st[cb].nonReclose) ruleF(R.reclose, `Step ${n}: reclosing is not blocked on ${cb} (${fid}) before making the parallel`, i);
        for (const id of e.T.devIds) { const g = e.T.els[id] as DevEl; if (g.type === 'reg' && g.feeder === fid && n2.en.has(g.from) && st[id].ctl !== 'manual') ruleF(R.regManual, `Step ${n}: regulator ${id} on ${fid} is still in AUTO when the parallel is made`, i); }
      }
    }
    if (s.loop && !madeLoop) f.push({ level: 'info', text: `Step ${n}: marked LOOP, but closing ${s.dev} doesn't make a parallel`, step: i });
    // Cap banks in the work section going dead while still on line
    for (const c of caps) {
      const cd = e.T.els[c] as DevEl;
      if (!capWarned.has(c) && net.en.has(cd.from) && !n2.en.has(cd.from) && (!st[c].open || st[c].ctl === 'auto')) {
        capWarned.add(c);
        ruleF(R.capOff, `Step ${n}: capacitor bank ${c} is de-energized while ${!st[c].open ? 'still on line' : 'in AUTO'} — place it in MANUAL and open it first, then allow 5 minutes before grounding`, i);
      }
    }
    for (const lid of e.T.loadIds) {
      const L = e.T.loads[lid], was = net.en.has(L.node), now = n2.en.has(L.node);
      if (was && !now) { sc.drop += L.customers; if (!ws.nodeSet.has(L.node)) wasOut.add(lid); }
      if (!was && now) { sc.pickup += L.customers; if (wasOut.has(lid) && !ws.nodeSet.has(L.node) && !momSeen.has(lid) && isolatedAt === null) { momSeen.add(lid); momentary += L.customers; if (lastDrop && lastDrop.exec === s.exec && s.exec !== 'SCADA' && lastDrop.dev !== s.dev) driveGap = true; } wasOut.delete(lid); }
    }
    if (sc.drop) lastDrop = { step: i, exec: s.exec, dev: s.dev };
    // Re-energizing the work before the hold point
    if (isolatedAt !== null && holdAfter !== undefined && i <= holdAfter && ws.nodes.some(x => n2.en.has(x)) && !ws.nodes.some(x => net.en.has(x)))
      f.push({ level: 'fail', text: `Step ${n}: re-energizes the work before the hold point`, step: i });
    st = trial; net = n2;
    if (isolatedAt === null && isolated(st, net)) {
      isolatedAt = i;
      const o = outsideOut(e, st, ws.nodeSet);
      outsideAtIso = o.c;
      const unavoidable = bestCrit(e, def);
      for (const c of o.crit) findings.push(unavoidable.includes(c) ? { level: 'warn', text: `${c} is out while the work is isolated and can't be picked up — arrange backup generation and notify` } : { level: 'fail', text: `${c} is out when the work is isolated, but it could be picked up` });
      for (const fl of feederLoading(e, st)) {
        if (fl.pct > 1) findings.push({ level: 'fail', text: `${fl.feeder} is loaded to ${Math.round(fl.pct * 100)}% of its ${e.T.feeders[fl.feeder].ratingA} A limit once isolated` });
        else if (fl.pct > 0.9) findings.push({ level: 'warn', text: `${fl.feeder} is at ${Math.round(fl.pct * 100)}% of its limit once isolated` });
      }
    }
  });

  for (const r of res) findings.push(...r.findings);
  const best = bestPickup(e, def);
  if (isolatedAt === null) {
    const closed = ws.bounds.filter(b => !st[b].open);
    const noVis = ws.vis.filter(b => !st[b].open);
    const noBp = ws.mustClose.filter(b => st[b].open);
    findings.unshift({ level: 'fail', text: def.kind === 'bypass'
      ? `${def.workEl} is never taken out of service${noBp.length ? ` — bypass ${noBp.join(', ')} never closed` : ''}${closed.length ? ` — ${closed.join(', ')} never opened` : ''}`
      : `The work section is never isolated${closed.length ? ` — ${closed.join(', ')} never opened` : noVis.length ? ` — no visible open: ${noVis.map(v => `${v} (for ${(e.T.els[v] as DevEl).vis})`).join(', ')} must be opened` : ' — it is still energized from somewhere'}` });
  } else {
    findings.unshift({ level: 'pass', text: def.kind === 'bypass'
      ? `${def.workEl} out of service after step ${isolatedAt + 1}: bypass ${ws.mustClose.join(', ')} closed, ${ws.points.join(', ')} open, ${def.workEl} dead`
      : `Work section isolated after step ${isolatedAt + 1}: ${ws.points.join(', ')} open, section dead` });
    if (outsideAtIso > best.out) findings.push({ level: 'fail', text: `${outsideAtIso - best.out} customers outside the work are left out who could be picked up${best.ties.length ? ` through ${best.ties.join(', ')}` : ''}` });
    else findings.push({ level: 'pass', text: outsideAtIso ? `Outage held to the minimum: ${outsideAtIso} customers outside the section can't be picked up` : 'No customers outside the work are left out' });
    if (momentary) findings.push({ level: 'warn', text: `${momentary} customers outside the work go out during the switching (break-before-make)${driveGap ? ' — and the same crew has to drive between the two switches, so expect several minutes, not a blink. Use a LOOP step if permitted, or a second crew' : ''}` });
    if (holdAfter === undefined) findings.push({ level: 'warn', text: `No hold point marked — mark the hold after step ${isolatedAt + 1}` });
    else if (holdAfter !== isolatedAt) findings.push({ level: 'warn', text: `Hold point is after step ${holdAfter + 1}, but the work is isolated after step ${isolatedAt + 1}` });
    else findings.push({ level: 'pass', text: `Hold point is in the right place (after step ${holdAfter + 1})` });
  }
  const abnormal = e.T.switchable.filter(id => !isNormal(e, st, id));
  const endNormal = abnormal.length === 0;
  const desc = (id: string) => { const d = e.T.els[id] as DevEl, s = st[id]; return d.type === 'reg' || d.type === 'cap' ? `${id} (control in ${s.ctl?.toUpperCase()})` : s.nonReclose ? `${id} (reclosing blocked)` : id; };
  if (isolatedAt !== null && isolatedAt === steps.length - 1) findings.push({ level: 'info', text: 'Order covers isolation only — restoration steps are needed (in this order after the hold, or a second order)' });
  else if (!endNormal) findings.push({ level: 'warn', text: `Order leaves ${abnormal.map(desc).join(', ')} out of normal` });
  else findings.push({ level: 'pass', text: 'Order returns the system to normal' });

  const verdict = findings.some(x => x.level === 'fail') ? 'fail' : 'pass';
  return { verdict, findings, steps: res, isolatedAt, workCustomers: ws.customers, outsideOutAtIso: outsideAtIso, minOutside: best.out === Infinity ? 0 : best.out, momentary, endNormal };
}

// ── Reference order ─────────────────────────────────────────
/** A correct order for the exercise under its company rules. */
export function referenceOrder(e: Engine, def: ExerciseDef): { steps: StepLike[]; holdAfter: number } {
  const T = e.T, R = rulesOf(def);
  const exec = (id: string) => ((T.els[id] as DevEl).scada ? 'SCADA' : def.truck);
  const S = (dev: string, action: SwAction, loop = false): StepLike => ({ dev, action, exec: exec(dev), loop });

  if (def.kind === 'bypass') {
    const g = groupParts(T, def.workEl);
    if (g.dev.type === 'reg') {
      const iso = [S(def.workEl, 'manual'), S(def.workEl, 'neutral'), S(g.bp, 'close'), S(g.load, 'open'), S(g.src, 'open')];
      const rest = [S(g.src, 'close'), S(g.load, 'close'), S(g.bp, 'open'), S(def.workEl, 'auto')];
      return { steps: [...iso, ...rest], holdAfter: iso.length - 1 };
    }
    const nr = R.reclose !== 'off' ? [S(def.workEl, 'nr-on')] : [];
    const iso = [...nr, S(g.bp, 'close'), S(def.workEl, 'open'), S(g.load, 'open'), S(g.src, 'open')];
    const rest = [S(g.src, 'close'), S(g.load, 'close'), S(def.workEl, 'close'), S(g.bp, 'open'), ...(nr.length ? [S(def.workEl, 'nr-off')] : [])];
    return { steps: [...iso, ...rest], holdAfter: iso.length - 1 };
  }

  const ws = workSection(e, def);
  // Upstream bound: first bound found walking from the section toward the source in the normal configuration.
  let up: string | null = null;
  let n: string | undefined = ws.nodes[0], guard = 0;
  while (n && guard++ < 2000 && !up) {
    const p: string | undefined = T.normParent[n]; if (!p) break;
    if (ws.bounds.includes(p)) up = p;
    const el: LineEl | DevEl = T.els[p]; n = el.from === n ? el.to : el.from;
  }
  const downs = ws.bounds.filter(b => !(T.els[b] as DevEl).normalOpen && b !== up);
  const best = bestPickup(e, def);
  const pre: StepLike[] = [], iso: StepLike[] = [], rest: StepLike[] = [], post: StepLike[] = [];
  // Cap banks in the work section come off first and go back to AUTO at the end (the controller waits out its own lockout).
  if (R.capOff !== 'off') for (const c of capsIn(e, ws.nodeSet)) { pre.push(S(c, 'manual'), S(c, 'open')); post.push(S(c, 'auto')); }
  const st = normalDevState(e);
  const usedTies = new Set<string>();
  const parallelFeeders = new Set<string>();
  for (const d of downs) {
    const trial = cloneDev(st); trial[d].open = true; if (up) trial[up].open = true;
    const tie = best.ties.find(t => { if (usedTies.has(t)) return false; const t2 = cloneDev(trial); t2[t].open = false; return solve(T, t2).en.size > solve(T, trial).en.size; });
    if (tie) {
      usedTies.add(tie);
      const p = cloneDev(st); p[tie].open = false;
      const cross = solve(T, p).parallelSubs;
      if (cross && R.crossSub === 'fail') {
        // Break-before-make: open the downstream point, then pick it up from the other station.
        iso.push(S(d, 'open'), S(tie, 'close'));
        rest.push(S(tie, 'open'), S(d, 'close'));
      } else {
        parallelFeeders.add(def.feeder); parallelFeeders.add(tieOther(e, tie, def.feeder));
        iso.push(S(tie, 'close', true), S(d, 'open'));
        rest.push(S(d, 'close', true), S(tie, 'open'));
      }
      st[tie].open = false; st[d].open = true;
    } else {
      iso.push(S(d, 'open'));
      rest.push(S(d, 'close'));
    }
  }
  if (up) { iso.push(S(up, 'open')); rest.unshift(S(up, 'close')); }
  for (const v of ws.vis) { iso.push({ dev: v, action: 'open', exec: def.truck, loop: false }); rest.unshift({ dev: v, action: 'close', exec: def.truck, loop: false }); }
  // Parallels: block reclosing and put regulators in MANUAL on the feeders involved first; put them back at the end.
  for (const f of parallelFeeders) {
    if (R.reclose !== 'off') { pre.push(S(T.feeders[f].breaker, 'nr-on')); post.unshift(S(T.feeders[f].breaker, 'nr-off')); }
    if (R.regManual !== 'off') for (const id of T.devIds) { const g = T.els[id] as DevEl; if (g.type === 'reg' && g.feeder === f) { pre.push(S(id, 'manual')); post.push(S(id, 'auto')); } }
  }
  const steps = [...pre, ...iso, ...rest, ...post];
  return { steps, holdAfter: pre.length + iso.length - 1 };
}

export function stepText(e: Engine, s: StepLike) {
  const d = e.T.els[s.dev] as DevEl | undefined;
  return `${ACTION_LABEL[s.action]} ${devWord(d)} ${s.dev}${s.loop ? ' (LOOP)' : ''} — ${s.exec === 'SCADA' ? 'SCADA' : `Truck ${s.exec}`}`;
}

// ── Report ──────────────────────────────────────────────────
export interface ExReport {
  kind: 'sparks-switching-report'; v: 1;
  def: ExerciseDef; rules: CompanyRules; student: string; startedWall: string; finishedWall: string; simMinutes: number;
  work: { loc: string; bounds: string[]; vis: string[]; customers: number };
  submissions: ExSubmission[];
  orders: { id: string; title: string; status: string; holdAfter?: number; steps: SwStep[] }[];
  ops: ExOp[];
  executedCheck: OrderCheck;
  reference: { steps: StepLike[]; holdAfter: number; check: OrderCheck };
  clearances: { id: string; truck: string; devs: string[]; issued: string; released: string | null }[];
  violations: { t: string; code: string; text: string }[];
  decisions: { t: string; text: string; good?: boolean }[];
  unplanned: { customers: number; cmi: number; loads: number };
  objectives: { text: string; status: string; note?: string }[];
  radio: { t: string; from: string; text: string }[];
  outcome: { isolatedOk: boolean; clearanceIssued: boolean; clearanceReleased: boolean; returnedNormal: boolean; violations: number; wrongRepeatsCaught: number; wrongRepeatsMissed: number; timeToIsolateMin: number | null };
  verdict: 'pass' | 'notes' | 'fail';
}

export function exerciseNormal(e: Engine) { return e.T.switchable.every(id => isNormal(e, e.s.dev, id)); }

export function buildReport(e: Engine): ExReport | null {
  const ex = e.s.scen.flags.ex as ExState | undefined;
  if (!ex) return null;
  const def = ex.def, ws = workSection(e, def);
  const orders = Object.values(e.s.orders).map(o => ({ id: o.id, title: o.title, status: o.status, holdAfter: o.holdAfter, steps: o.steps.map(s => ({ ...s })) }));
  // Replay what actually happened, as one sequence of operations, from the starting state.
  const executed: StepLike[] = ex.ops.map(o => ({ dev: o.dev, action: o.action, exec: o.by === 'SCADA' || e.s.trucks[o.by] ? o.by : 'SCADA', loop: true }));
  const firstClr = Object.values(e.s.clearances).find(c => c.truck === def.truck) ?? Object.values(e.s.clearances)[0];
  const executedCheck = checkOrder(e, def, executed, undefined, ex.startDev ?? normalDevState(e));
  // Hold points and LOOP flags belong to a written order, not to the replay of what operated.
  executedCheck.findings = executedCheck.findings.filter(f => !/hold point|Hold point|marked LOOP|make-before-break parallel|isn't marked LOOP/.test(f.text));
  const ref = referenceOrder(e, def);
  const hh = (t: number) => e.hhmm(t);
  let caught = 0, missed = 0;
  for (const o of orders) for (const s of o.steps) for (const l of s.log ?? []) { if (/caught the wrong/.test(l.ev)) caught++; if (/CONFIRMED a wrong/.test(l.ev)) missed++; }
  const isoOp = executedCheck.isolatedAt !== null ? ex.ops[executedCheck.isolatedAt] : null;
  const viol = e.s.metrics.violations;
  const outcome = {
    isolatedOk: executedCheck.isolatedAt !== null,
    clearanceIssued: !!firstClr,
    clearanceReleased: !!firstClr?.released,
    returnedNormal: exerciseNormal(e),
    violations: viol.length,
    wrongRepeatsCaught: caught,
    wrongRepeatsMissed: missed,
    timeToIsolateMin: isoOp ? Math.round(isoOp.t / 6) / 10 : null,
  };
  const unplannedCust = Object.values(ex.unplanned).reduce((a, u) => a + u.cust, 0);
  const safeAndDone = outcome.isolatedOk && outcome.clearanceIssued && outcome.violations === 0 && outcome.returnedNormal && !missed;
  const verdict = !safeAndDone ? 'fail' : unplannedCust || executedCheck.findings.some(f => f.level === 'fail') ? 'notes' : 'pass';
  return {
    kind: 'sparks-switching-report', v: 1, def, rules: rulesOf(def), student: ex.student || 'Student', startedWall: ex.startedWall, finishedWall: ex.finishedWall ?? new Date().toISOString(),
    simMinutes: Math.round(e.s.t / 60),
    work: { loc: workLocation(e, def).loc, bounds: ws.bounds, vis: ws.vis, customers: ws.customers },
    submissions: ex.submissions, orders, ops: ex.ops, executedCheck,
    reference: { ...ref, check: checkOrder(e, def, ref.steps, ref.holdAfter, ex.startDev ?? normalDevState(e)) },
    clearances: Object.values(e.s.clearances).map(c => ({ id: c.id, truck: c.truck, devs: c.devs, issued: hh(c.issued), released: c.released !== null ? hh(c.released) : null })),
    violations: viol.map(v => ({ t: hh(v.t), code: v.code, text: v.text })),
    decisions: e.s.metrics.decisions.map(d => ({ t: hh(d.t), text: d.text, good: d.good })),
    unplanned: { customers: unplannedCust, cmi: Math.round(ex.cmiUnplanned), loads: Object.keys(ex.unplanned).length },
    objectives: e.scen.objectives.map(o => ({ text: o.text, status: e.s.scen.obj[o.id]?.status ?? 'pending', note: e.s.scen.obj[o.id]?.note })),
    radio: e.s.radio.filter((m: any) => m.kind === 'switching' || /clearance|switching/i.test(m.text)).map((m: any) => ({ t: hh(m.t), from: m.from, text: m.text })),
    outcome, verdict,
  };
}
