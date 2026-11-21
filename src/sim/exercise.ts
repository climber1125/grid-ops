// ─────────────────────────────────────────────────────────────
// Switching exercises: an instructor (or the sim) picks a section of line
// for a crew to work on. The student writes the switching order, submits it
// for a check, executes it by radio, issues the clearance and restores.
// Everything is recorded into a report file the instructor opens later.
// ─────────────────────────────────────────────────────────────
import type { Engine } from './engine';
import type { DevEl, LineEl, SwStep, SimState, Topology } from './types';
import { solve, sectionAround } from './network';
import { devWord } from './radio';

export interface ExerciseDef {
  v: 1;
  id: string;
  title: string;
  feeder: string;
  /** Main line element the crew works on; the work section is the section around it. */
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
}

export interface Finding { level: 'fail' | 'warn' | 'info' | 'pass'; text: string; step?: number }
export interface StepCheck { i: number; dev: string; action: 'open' | 'close'; exec: string; loop: boolean; findings: Finding[]; drop: number; pickup: number }
export interface OrderCheck {
  verdict: 'pass' | 'fail';
  findings: Finding[];
  steps: StepCheck[];
  /** Step index (0-based) after which the work section is dead and every isolation point is open. */
  isolatedAt: number | null;
  workCustomers: number;
  /** Customers outside the work section still out once isolated. */
  outsideOutAtIso: number;
  /** Best possible outside outage using the available ties. */
  minOutside: number;
  /** Customers outside the work section that blinked out during the sequence. */
  momentary: number;
  endNormal: boolean;
}

export interface ExSubmission { t: number; order: string; title: string; steps: { dev: string; action: 'open' | 'close'; exec: string; loop: boolean }[]; holdAfter?: number; check: OrderCheck }
export interface ExOp { t: number; dev: string; action: 'open' | 'close'; by: string; order?: string }
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
}

// ── Sections ────────────────────────────────────────────────
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

export const WORK_TYPES = [
  'Replace broken crossarm',
  'Replace failed pin insulator',
  'Replace cracked pole top and reframe',
  'Replace burned jumper and dead-end shoe',
  'Re-sag primary conductor',
  'Change out a leaning pole',
  'Replace failed lightning arrester and connector',
];

/** A random exercise on any section with a decent customer count. */
export function generateExercise(T: Topology, rnd: () => number = Math.random): ExerciseDef {
  const secs = listSections(T).filter(s => s.customers >= 25);
  const s = secs[Math.floor(rnd() * secs.length)];
  const els = sectionAround(T, s.el).nodes.length ? T.feeders[s.feeder].mainEls.filter(e => sectionAround(T, e).bounds.slice().sort().join('|') === s.key) : [s.el];
  const workEl = els[Math.floor(rnd() * els.length)] ?? s.el;
  const trucks = ['230', '233', '238', '240'];
  return {
    v: 1, id: 'EX-' + Math.floor(1000 + rnd() * 9000), title: `Planned work on ${s.feeder}`, feeder: s.feeder, workEl,
    work: WORK_TYPES[Math.floor(rnd() * WORK_TYPES.length)], truck: trucks[Math.floor(rnd() * trucks.length)], minutes: 15, coach: false, by: 'generated',
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
  for (const id of e.T.devIds) o[id] = { open: (e.T.els[id] as DevEl).normalOpen, lockout: false, tags: [], comm: true, ops: 0 };
  return o;
}
export function workSection(e: Engine, def: ExerciseDef) {
  const sec = sectionAround(e.T, def.workEl);
  const ns = new Set(sec.nodes);
  const loads = e.T.loadIds.filter(l => ns.has(e.T.loads[l].node));
  // Breakers and reclosers aren't a visible open: the disconnect between them and the work section must also be open.
  const vis = e.T.devIds.filter(id => { const d = e.T.els[id] as DevEl; return d.type === 'disc' && !!d.vis && sec.bounds.includes(d.vis) && ns.has(d.from) && ns.has(d.to); });
  return { ...sec, nodeSet: ns, loads, vis, points: [...sec.bounds, ...vis], customers: loads.reduce((a, l) => a + e.T.loads[l].customers, 0) };
}
export function workLocation(e: Engine, def: ExerciseDef) {
  const el = e.T.els[def.workEl] as LineEl;
  const mid = el.path[Math.floor(el.path.length / 2)] ?? e.T.nodes[el.from].pos;
  return { pos: mid, loc: e.locOf(mid) };
}

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

/** Best outside-outage achievable with the work section's isolation points open, using any combination of normally open ties. */
function bestPickup(e: Engine, def: ExerciseDef) {
  const ws = workSection(e, def);
  const base = normalDevState(e);
  for (const b of ws.bounds) base[b].open = true;
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
  for (const x of ws.bounds) st[x].open = true;
  for (const t of b.ties) st[t].open = false;
  return outsideOut(e, st, ws.nodeSet).crit;
}

// ── Order check ─────────────────────────────────────────────
/**
 * Plays an order out step by step from a device state and reports what would happen.
 * Mirrors what the engine refuses (already in position, not SCADA, tagged, unflagged loop)
 * so the check matches what execution will do.
 */
export function checkOrder(e: Engine, def: ExerciseDef, steps: Pick<SwStep, 'dev' | 'action' | 'exec' | 'loop'>[], holdAfter?: number, start: DevState = normalDevState(e)): OrderCheck {
  const ws = workSection(e, def);
  const findings: Finding[] = [];
  const res: StepCheck[] = [];
  let st = cloneDev(start);
  let net = solve(e.T, st);
  const wasOut = new Set<string>();
  for (const lid of e.T.loadIds) if (!net.en.has(e.T.loads[lid].node)) wasOut.add(lid);
  let momentary = 0, isolatedAt: number | null = null, outsideAtIso = 0, driveGap = false;
  let lastDrop: { step: number; exec: string; dev: string } | null = null;
  const momSeen = new Set<string>();
  const isolated = (s: DevState, n: ReturnType<typeof solve>) => ws.points.every(b => s[b].open) && ws.nodes.every(x => !n.en.has(x));

  steps.forEach((s, i) => {
    const f: Finding[] = [];
    const sc: StepCheck = { i, dev: s.dev, action: s.action, exec: s.exec, loop: s.loop, findings: f, drop: 0, pickup: 0 };
    res.push(sc);
    const d = e.T.els[s.dev] as DevEl | undefined;
    const n = i + 1;
    if (!d || d.kind !== 'device') { f.push({ level: 'fail', text: `Step ${n}: ${s.dev} is not a device on this system`, step: i }); return; }
    if (st[s.dev].open === (s.action === 'open')) { f.push({ level: 'fail', text: `Step ${n}: ${s.dev} is already ${s.action === 'open' ? 'open' : 'closed'} at this point — the crew will report unable`, step: i }); return; }
    if (s.exec === 'SCADA' && !d.scada) { f.push({ level: 'fail', text: `Step ${n}: ${s.dev} is not SCADA-controllable — assign a truck`, step: i }); return; }
    if (s.exec !== 'SCADA' && !e.s.trucks[s.exec]) f.push({ level: 'warn', text: `Step ${n}: Truck ${s.exec} is not on the roster`, step: i });
    if (s.action === 'close' && st[s.dev].tags.length) { f.push({ level: 'fail', text: `Step ${n}: ${s.dev} carries a HOLD tag — close blocked`, step: i }); return; }
    const lb = e.loadBreakIssue(s.dev, s.action, st);
    if (lb) f.push({ level: lb.severe ? 'fail' : 'warn', text: `Step ${n}: ${lb.text}`, step: i });
    const trial = cloneDev(st); trial[s.dev].open = s.action === 'open';
    const n2 = solve(e.T, trial);
    const madeLoop = n2.loops.length > net.loops.length;
    if (s.action === 'close' && madeLoop && !s.loop) { f.push({ level: 'fail', text: `Step ${n}: closing ${s.dev} parallels ${n2.parallelSubs ? 'two substations' : 'two feeders'} but the step isn't marked LOOP — it will be refused`, step: i }); return; }
    if (madeLoop && n2.parallelSubs) f.push({ level: 'warn', text: `Step ${n}: closing ${s.dev} parallels two different substations. Confirm phase angle and get approval, or use break-before-make`, step: i });
    if (s.loop && !madeLoop) f.push({ level: 'info', text: `Step ${n}: marked LOOP, but closing ${s.dev} doesn't make a parallel`, step: i });
    if (s.loop && madeLoop && !n2.parallelSubs) f.push({ level: 'pass', text: `Step ${n}: make-before-break parallel through ${s.dev} (same substation)`, step: i });
    for (const lid of e.T.loadIds) {
      const L = e.T.loads[lid], was = net.en.has(L.node), now = n2.en.has(L.node);
      if (was && !now) { sc.drop += L.customers; if (!ws.nodeSet.has(L.node)) wasOut.add(lid); }
      if (!was && now) { sc.pickup += L.customers; if (wasOut.has(lid) && !ws.nodeSet.has(L.node) && !momSeen.has(lid) && isolatedAt === null) { momSeen.add(lid); momentary += L.customers; if (lastDrop && lastDrop.exec === s.exec && s.exec !== 'SCADA' && lastDrop.dev !== s.dev) driveGap = true; } wasOut.delete(lid); }
    }
    if (sc.drop) lastDrop = { step: i, exec: s.exec, dev: s.dev };
    // Re-energizing the work section before the hold point
    if (isolatedAt !== null && holdAfter !== undefined && i <= holdAfter && ws.nodes.some(x => n2.en.has(x)) && !ws.nodes.some(x => net.en.has(x)))
      f.push({ level: 'fail', text: `Step ${n}: re-energizes the work section before the hold point`, step: i });
    st = trial; net = n2;
    if (isolatedAt === null && isolated(st, net)) {
      isolatedAt = i;
      const o = outsideOut(e, st, ws.nodeSet);
      outsideAtIso = o.c;
      const unavoidable = bestCrit(e, def);
      for (const c of o.crit) findings.push(unavoidable.includes(c) ? { level: 'warn', text: `${c} is out while the section is isolated and can't be picked up — arrange backup generation and notify` } : { level: 'fail', text: `${c} is out when the section is isolated, but it could be picked up` });
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
    findings.unshift({ level: 'fail', text: `The work section is never isolated${closed.length ? ` — ${closed.join(', ')} never opened` : noVis.length ? ` — no visible open: ${noVis.map(v => `${v} (for ${(e.T.els[v] as DevEl).vis})`).join(', ')} must be opened` : ' — it is still energized from somewhere'}` });
  } else {
    findings.unshift({ level: 'pass', text: `Work section isolated after step ${isolatedAt + 1}: ${ws.points.join(', ')} open, section dead` });
    if (outsideAtIso > best.out) findings.push({ level: 'fail', text: `${outsideAtIso - best.out} customers outside the work section are left out who could be picked up${best.ties.length ? ` through ${best.ties.join(', ')}` : ''}` });
    else findings.push({ level: 'pass', text: outsideAtIso ? `Outage held to the minimum: ${outsideAtIso} customers outside the section can't be picked up` : 'No customers outside the work section are left out' });
    if (momentary) findings.push({ level: 'warn', text: `${momentary} customers outside the work section go out during the switching (break-before-make)${driveGap ? ' — and the same crew has to drive between the two switches, so expect several minutes, not a blink. Use a LOOP step or a second crew' : ''}` });
    if (holdAfter === undefined) findings.push({ level: 'warn', text: `No hold point marked — mark the hold after step ${isolatedAt + 1}` });
    else if (holdAfter !== isolatedAt) findings.push({ level: 'warn', text: `Hold point is after step ${holdAfter + 1}, but the section is isolated after step ${isolatedAt + 1}` });
    else findings.push({ level: 'pass', text: `Hold point is in the right place (after step ${holdAfter + 1})` });
  }
  const abnormal = e.T.switchable.filter(id => st[id].open !== (e.T.els[id] as DevEl).normalOpen);
  const endNormal = abnormal.length === 0;
  if (isolatedAt !== null && isolatedAt === steps.length - 1) findings.push({ level: 'info', text: 'Order covers isolation only — restoration steps are needed (in this order after the hold, or a second order)' });
  else if (!endNormal) findings.push({ level: 'warn', text: `Order leaves ${abnormal.join(', ')} out of normal position` });
  else findings.push({ level: 'pass', text: 'Order returns the system to normal' });

  const verdict = findings.some(x => x.level === 'fail') ? 'fail' : 'pass';
  return { verdict, findings, steps: res, isolatedAt, workCustomers: ws.customers, outsideOutAtIso: outsideAtIso, minOutside: best.out === Infinity ? 0 : best.out, momentary, endNormal };
}

// ── Reference order ─────────────────────────────────────────
/** A correct order for the exercise: pick up downstream load (make-before-break where the source is the same substation), isolate, hold, restore. */
export function referenceOrder(e: Engine, def: ExerciseDef) {
  const T = e.T, ws = workSection(e, def);
  const exec = (id: string) => ((T.els[id] as DevEl).scada ? 'SCADA' : def.truck);
  // Upstream bound: first bound found walking from the section toward the source in the normal configuration.
  let up: string | null = null;
  const anyNode = ws.nodes[0];
  let n: string | undefined = anyNode, g = 0;
  while (n && g++ < 2000 && !up) {
    const p: string | undefined = T.normParent[n]; if (!p) break;
    if (ws.bounds.includes(p)) up = p;
    const el: LineEl | DevEl = T.els[p]; n = el.from === n ? el.to : el.from;
  }
  const closedBounds = ws.bounds.filter(b => !(T.els[b] as DevEl).normalOpen);
  const downs = closedBounds.filter(b => b !== up);
  const best = bestPickup(e, def);
  type S = { dev: string; action: 'open' | 'close'; exec: string; loop: boolean };
  const iso: S[] = [], rest: S[] = [];
  const st = normalDevState(e);
  const usedTies = new Set<string>();
  for (const d of downs) {
    // The tie that picks up the area beyond this downstream bound.
    const trial = cloneDev(st); trial[d].open = true; if (up) trial[up].open = true;
    const tie = best.ties.find(t => { if (usedTies.has(t)) return false; const t2 = cloneDev(trial); t2[t].open = false; return solve(T, t2).en.size > solve(T, trial).en.size; });
    if (tie) {
      usedTies.add(tie);
      // Make-before-break: parallel through the tie, then open the downstream point. No customer outside the section blinks.
      iso.push({ dev: tie, action: 'close', exec: exec(tie), loop: true }, { dev: d, action: 'open', exec: exec(d), loop: false });
      rest.push({ dev: d, action: 'close', exec: exec(d), loop: true }, { dev: tie, action: 'open', exec: exec(tie), loop: false });
      st[tie].open = false; st[d].open = true;
    } else {
      iso.push({ dev: d, action: 'open', exec: exec(d), loop: false });
      rest.push({ dev: d, action: 'close', exec: exec(d), loop: false });
    }
  }
  if (up) { iso.push({ dev: up, action: 'open', exec: exec(up), loop: false }); rest.unshift({ dev: up, action: 'close', exec: exec(up), loop: false }); }
  for (const v of ws.vis) { iso.push({ dev: v, action: 'open', exec: def.truck, loop: false }); rest.unshift({ dev: v, action: 'close', exec: def.truck, loop: false }); }
  // Restoration: close the upstream point first, then return each downstream area to normal.
  const steps = [...iso, ...rest];
  return { steps, holdAfter: iso.length - 1 };
}

export function stepText(e: Engine, s: { dev: string; action: string; exec: string; loop: boolean }) {
  const d = e.T.els[s.dev] as DevEl | undefined;
  return `${s.action.toUpperCase()} ${devWord(d)} ${s.dev}${s.loop ? ' (LOOP)' : ''} — ${s.exec === 'SCADA' ? 'SCADA' : `Truck ${s.exec}`}`;
}

// ── Report ──────────────────────────────────────────────────
export interface ExReport {
  kind: 'sparks-switching-report'; v: 1;
  def: ExerciseDef; student: string; startedWall: string; finishedWall: string; simMinutes: number;
  work: { loc: string; bounds: string[]; vis: string[]; customers: number };
  submissions: ExSubmission[];
  orders: { id: string; title: string; status: string; holdAfter?: number; steps: SwStep[] }[];
  ops: ExOp[];
  executedCheck: OrderCheck;
  reference: { steps: { dev: string; action: 'open' | 'close'; exec: string; loop: boolean }[]; holdAfter: number; check: OrderCheck };
  clearances: { id: string; truck: string; devs: string[]; issued: string; released: string | null }[];
  violations: { t: string; code: string; text: string }[];
  decisions: { t: string; text: string; good?: boolean }[];
  unplanned: { customers: number; cmi: number; loads: number };
  objectives: { text: string; status: string; note?: string }[];
  radio: { t: string; from: string; text: string }[];
  outcome: { isolatedOk: boolean; clearanceIssued: boolean; clearanceReleased: boolean; returnedNormal: boolean; violations: number; wrongRepeatsCaught: number; wrongRepeatsMissed: number; timeToIsolateMin: number | null };
  verdict: 'pass' | 'notes' | 'fail';
}

export function buildReport(e: Engine): ExReport | null {
  const ex = e.s.scen.flags.ex as ExState | undefined;
  if (!ex) return null;
  const def = ex.def, ws = workSection(e, def);
  const orders = Object.values(e.s.orders).map(o => ({ id: o.id, title: o.title, status: o.status, holdAfter: o.holdAfter, steps: o.steps.map(s => ({ ...s })) }));
  // Replay what actually happened, as one sequence of operations.
  const executed = ex.ops.map(o => ({ dev: o.dev, action: o.action, exec: o.by, loop: true }));
  const firstClr = Object.values(e.s.clearances).find(c => c.truck === def.truck) ?? Object.values(e.s.clearances)[0];
  const executedCheck = checkOrder(e, def, executed.map(x => ({ ...x, exec: x.exec === 'SCADA' || e.s.trucks[x.exec] ? x.exec : 'SCADA' })));
  // Hold points and LOOP flags belong to a written order, not to the replay of what operated.
  executedCheck.findings = executedCheck.findings.filter(f => !/hold point|Hold point|marked LOOP|make-before-break parallel/.test(f.text));
  const ref = referenceOrder(e, def);
  const hh = (t: number) => e.hhmm(t);
  let caught = 0, missed = 0;
  for (const o of orders) for (const s of o.steps) for (const l of s.log ?? []) { if (/caught the wrong/.test(l.ev)) caught++; if (/CONFIRMED a wrong/.test(l.ev)) missed++; }
  const isoOp = executedCheck.isolatedAt !== null ? ex.ops[executedCheck.isolatedAt] : null;
  const allNormal = e.T.switchable.every(id => e.s.dev[id].open === (e.T.els[id] as DevEl).normalOpen);
  const viol = e.s.metrics.violations;
  const outcome = {
    isolatedOk: executedCheck.isolatedAt !== null,
    clearanceIssued: !!firstClr,
    clearanceReleased: !!firstClr?.released,
    returnedNormal: allNormal,
    violations: viol.length,
    wrongRepeatsCaught: caught,
    wrongRepeatsMissed: missed,
    timeToIsolateMin: isoOp ? Math.round(isoOp.t / 6) / 10 : null,
  };
  const unplannedCust = Object.values(ex.unplanned).reduce((a, u) => a + u.cust, 0);
  const safeAndDone = outcome.isolatedOk && outcome.clearanceIssued && outcome.violations === 0 && outcome.returnedNormal && !missed;
  const verdict = !safeAndDone ? 'fail' : unplannedCust ? 'notes' : 'pass';
  return {
    kind: 'sparks-switching-report', v: 1, def, student: ex.student || 'Student', startedWall: ex.startedWall, finishedWall: ex.finishedWall ?? new Date().toISOString(),
    simMinutes: Math.round(e.s.t / 60),
    work: { loc: workLocation(e, def).loc, bounds: ws.bounds, vis: ws.vis, customers: ws.customers },
    submissions: ex.submissions, orders, ops: ex.ops, executedCheck,
    reference: { ...ref, check: checkOrder(e, def, ref.steps, ref.holdAfter) },
    clearances: Object.values(e.s.clearances).map(c => ({ id: c.id, truck: c.truck, devs: c.devs, issued: hh(c.issued), released: c.released !== null ? hh(c.released) : null })),
    violations: viol.map(v => ({ t: hh(v.t), code: v.code, text: v.text })),
    decisions: e.s.metrics.decisions.map(d => ({ t: hh(d.t), text: d.text, good: d.good })),
    unplanned: { customers: unplannedCust, cmi: Math.round(ex.cmiUnplanned), loads: Object.keys(ex.unplanned).length },
    objectives: e.scen.objectives.map(o => ({ text: o.text, status: e.s.scen.obj[o.id]?.status ?? 'pending', note: e.s.scen.obj[o.id]?.note })),
    radio: e.s.radio.filter((m: any) => m.kind === 'switching' || /clearance|switching/i.test(m.text)).map((m: any) => ({ t: hh(m.t), from: m.from, text: m.text })),
    outcome, verdict,
  };
}
