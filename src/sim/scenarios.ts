// ─────────────────────────────────────────────────────────────
// Training scenarios. Each sets the initial system state, scripts
// causal events through the engine queue, and grades objectives
// from actual simulation state (never from UI clicks alone).
// ─────────────────────────────────────────────────────────────
import type { Engine } from './engine';
import type { Cause, DevEl, LatLng } from './types';
import { SERVICE_CENTER, nearestName } from './roads';
import { sectionAround } from './network';
import { offset } from './geo';

export interface ScenarioDef {
  id: string; short: string; name: string; brief: string;
  objectives: { id: string; text: string }[];
  background: Partial<Record<'xfmr' | 'lateral' | 'momentary' | 'single' | 'comm' | 'mainline', number>>;
  setup(e: Engine): void;
  periodic?(e: Engine): void;
  event?(e: Engine, name: string, data: any): void;
  isDone?(e: Engine): boolean;
}

// ── helpers ──────────────────────────────────────────────────
function startOnWorkOrder(e: Engine, truck: string, dur = 300) {
  const tr = e.truck(truck);
  const wo = e.newWorkOrder();
  wo.pos = tr.pos; wo.loc = nearestName(tr.pos); wo.status = 'Assigned'; wo.truck = truck;
  tr.task = { kind: 'workorder', id: wo.id }; tr.status = 'Working'; tr.tok++;
  e.schedule(dur, 'crew', { truck, tok: tr.tok, step: 'woDone' });
}

function allNormal(e: Engine): boolean {
  for (const id of e.T.switchable) {
    const d = e.T.els[id] as DevEl, st = e.s.dev[id];
    if (st.open !== d.normalOpen || st.lockout) return false;
  }
  return true;
}

function incFor(e: Engine, dev: string) {
  return Object.values(e.s.incidents).find(i => i.truthDev === dev);
}

function noViolation(e: Engine, codes: string[]) {
  return !e.s.metrics.violations.some(v => codes.includes(v.code));
}

function fault(e: Engine, el: string, onLoad: boolean, cause: Cause, permanent: boolean, hazard = false) {
  const f = e.createFault(el, onLoad, cause, permanent, hazard);
  e.applyFault(f);
  return f;
}

function seedWorkingIncident(e: Engine, truck: string, lid: string, remaining: number) {
  const L = e.T.loads[lid];
  const f = e.createFault(lid, true, 'xfmr_failure', true);
  e.protect(f, false);
  e.refresh();
  f.found = true;
  const inc = e.createIncident('AMI', L.xfmr, L.xfmr);
  inc.t = -42 * 60; inc.firstDispatchT = -38 * 60;
  const tr = e.truck(truck);
  tr.pos = offset(L.pos, 18, 12);
  tr.task = { kind: 'incident', id: inc.id, stage: 'repair' }; tr.status = 'Working'; tr.tok++;
  inc.crew = truck; inc.crewHistory.push(truck); inc.status = 'Working'; inc.stage = 'Repair'; inc.cause = f.desc;
  inc.etr = e.s.t + remaining + 900;
  inc.timeline.push({ t: -20 * 60, text: `Truck ${truck}: failed transformer, changing out. ETR ${e.hhmm(inc.etr)}` });
  e.schedule(remaining, 'crew', { truck, tok: tr.tok, step: 'repairDone' });
}

const dispatchWithin = (e: Engine, objId: string, dev: string, t0: number | undefined, limit: number) => {
  if (t0 === undefined) return;
  const inc = incFor(e, dev);
  if (inc?.firstDispatchT != null) e.setObj(objId, inc.firstDispatchT - t0 <= limit ? 'pass' : 'fail', `${Math.round((inc.firstDispatchT - t0) / 60 * 10) / 10} min`);
  else if (e.s.t - t0 > limit) e.setObj(objId, 'fail', 'No crew dispatched in time');
};

// ── Scenarios ────────────────────────────────────────────────
export const SCENARIOS: Record<string, ScenarioDef> = {
  A: {
    id: 'A', short: 'A', name: 'Normal Operations',
    brief: 'Routine afternoon shift. Crews are working orders, the system throws routine trouble: transformer and lateral outages, momentaries, single-customer calls and RTU comm problems. Auto-assist (desk dispatcher) handles routine dispatch and refuse approvals unless you act first. Run your desk.',
    objectives: [
      { id: 'a1', text: 'Average dispatch time under 8 minutes' },
      { id: 'a2', text: 'Acknowledge every P1 alarm within 2 minutes' },
      { id: 'a3', text: 'No safety violations' },
    ],
    background: { xfmr: 1500, lateral: 2400, momentary: 900, single: 2400, comm: 3000, mainline: 7200 },
    setup(e) {
      e.s.autoAssist = true;
      const t230 = e.addTruck('230', SERVICE_CENTER);
      e.addTruck('233', [33.2290, -97.1252]);
      e.addTruck('235', [33.1930, -97.1300]);
      e.schedule(4, 'woPick', { truck: '230', tok: t230.tok });
      startOnWorkOrder(e, '233', 380);
      const lid = e.T.loadIds.find(l => e.T.loads[l].feeder === 'BS-3120' && e.T.loads[l].cls === 'res' && e.T.loads[l].lateral)!;
      seedWorkingIncident(e, '235', lid, 420);
      e.schedule(25, 'scn', { name: 'gen', g: 'xfmr' });
      e.schedule(80, 'scn', { name: 'gen', g: 'momentary' });
      e.schedule(210, 'scn', { name: 'gen', g: 'lateral' });
      e.schedule(330, 'scn', { name: 'gen', g: 'single' });
    },
    event(e, name, d) { if (name === 'gen') e.genEvent(d.g); },
    periodic(e) {
      if (e.s.alarms.some(a => a.pri === 1 && !a.acked && e.s.t - a.t > 120)) e.setObj('a2', 'fail', 'P1 alarm unacknowledged > 2 min');
      if (!noViolation(e, ['tag', 'energize-fault', 'clearance', 'clearance-release', 'repeat-back'])) e.setObj('a3', 'fail');
    },
    isDone(e) {
      if (e.s.t < 7200) return false;
      const dts = e.s.metrics.dispatchTimes.filter(x => x > 0);
      const avg = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0;
      e.setObj('a1', avg < 480 ? 'pass' : 'fail', `${(avg / 60).toFixed(1)} min avg`);
      e.setObj('a2', 'pass'); e.setObj('a3', 'pass');
      return true;
    },
  },

  B: {
    id: 'B', short: 'B', name: 'Feeder Lockout',
    brief: 'IW-2110 serves downtown, the Bell Ave neighborhood and City Hall / 911 Communications. Shortly after shift change it will lock out. Find the fault, isolate it, restore everyone you can from adjacent feeders, protect the crew with a clearance, and return the system to normal.',
    objectives: [
      { id: 'b1', text: 'Dispatch a crew within 5 minutes of the lockout' },
      { id: 'b2', text: 'Never energize the known faulted section' },
      { id: 'b3', text: 'Isolate the faulted section (open S-2114 and S-2116)' },
      { id: 'b4', text: 'Restore all customers outside the faulted section within 45 minutes' },
      { id: 'b5', text: 'Issue the clearance only after isolation; release only on the crew\'s release' },
      { id: 'b6', text: 'Return to normal configuration and close the incident' },
    ],
    background: { single: 1800 },
    setup(e) {
      e.s.autoAssist = false;
      e.s.scen.flags.noRandomErrors = true;
      e.addTruck('233', SERVICE_CENTER);
      const t230 = e.addTruck('230', [33.2445, -97.1290]);
      e.addTruck('235', [33.1930, -97.1450]);
      e.schedule(6, 'woPick', { truck: '230', tok: t230.tok });
      startOnWorkOrder(e, '235', 900);
      e.schedule(20, 'scn', { name: 'lockout' });
    },
    event(e, name) {
      if (name === 'lockout') {
        const el = e.mainElAfter('S-2114', 2);
        const f = fault(e, el, false, 'tree_primary', true, false);
        e.s.scen.flags.lockT = e.s.t;
        e.s.scen.flags.faultEl = el;
        e.s.scen.flags.faultId = f.id;
      }
    },
    periodic(e) {
      const F = e.s.scen.flags;
      if (F.lockT === undefined) return;
      dispatchWithin(e, 'b1', 'CB-2110', F.lockT, 300);
      if (!noViolation(e, ['energize-fault'])) e.setObj('b2', 'fail');
      const f = e.s.faults[F.faultId];
      if (f?.found && e.s.dev['S-2114'].open && e.s.dev['S-2116'].open) e.setObj('b3', 'pass');
      const sec = new Set(sectionAround(e.T, F.faultEl).nodes);
      const outside = e.T.devLoads['CB-2110'].filter(l => !sec.has(e.T.loads[l].node) && !e.loadEn(l));
      if (e.s.t - F.lockT > 60 && outside.length === 0 && f?.active) e.setObj('b4', e.s.t - F.lockT <= 2700 ? 'pass' : 'fail', `${Math.round((e.s.t - F.lockT) / 60)} min`);
      else if (e.s.t - F.lockT > 2700) e.setObj('b4', 'fail', 'Unfaulted customers still out at 45 min');
      if (!noViolation(e, ['clearance', 'clearance-release', 'tag'])) e.setObj('b5', 'fail');
      else if (Object.values(e.s.clearances).some(c => c.status === 'Released')) e.setObj('b5', 'pass');
      const inc = incFor(e, 'CB-2110');
      if (inc?.status === 'Closed' && allNormal(e)) { e.setObj('b6', 'pass'); e.setObj('b2', 'pass'); }
    },
    isDone(e) { const F = e.s.scen.flags; return e.s.scen.obj.b6.status !== 'pending' || (F.lockT !== undefined && e.s.t - F.lockT > 4 * 3600); },
  },

  C: {
    id: 'C', short: 'C', name: 'Storm Response',
    brief: 'A severe thunderstorm line is moving through Sparks with 60 mph gusts and frequent lightning. Expect multiple outages, a wire down, a recloser lockout, and heavy call volume. Two callout crews will check in. Prioritize public safety and critical customers, then restore the most customers fastest.',
    objectives: [
      { id: 'c1', text: 'Assign a crew to the wire-down hazard within 8 minutes of the report' },
      { id: 'c2', text: 'Never dispatch to a P3 while a P1 sits unassigned over 2 minutes' },
      { id: 'c3', text: 'Restore 75% of interrupted customers within 60 minutes of storm onset' },
      { id: 'c4', text: 'No safety violations' },
    ],
    background: { xfmr: 900, lateral: 1100, momentary: 600 },
    setup(e) {
      e.s.autoAssist = false;
      e.s.scen.flags.callMult = 1.5;
      e.s.scen.flags.noRoutine = true;
      e.s.scen.flags.noRandomErrors = true;
      e.s.weather = { text: 'SEVERE T-STORM WARNING until 16:15 — gusts 60 mph, frequent lightning', level: 'warning' };
      e.addTruck('230', SERVICE_CENTER);
      e.addTruck('233', [33.2290, -97.1330]);
      e.addTruck('235', [33.2030, -97.1560]);
      const sched: [number, string, any][] = [
        [30, 'mom', { f: 'CH-1210' }], [60, 'lat', { f: 'CH-1210' }], [100, 'xf', { f: 'IW-2120' }],
        [150, 'wire', { f: 'BS-3110' }], [240, 'main', {}], [330, 'xf', { f: 'CH-1220' }],
        [420, 'lat', { f: 'CH-1220' }], [480, 'callout', { t: '238' }], [540, 'xf', { f: 'BS-3120' }],
        [660, 'lat', { f: 'BS-3120' }], [720, 'callout', { t: '240' }], [800, 'mom', { f: 'IW-2110' }],
        [1500, 'lat', { f: 'IW-2110' }], [2700, 'clear', {}],
      ];
      for (const [t, name, d] of sched) e.schedule(t, 'scn', { name, ...d });
      e.log('SYSTEM', 'alarm', 'NWS: Severe Thunderstorm Warning for Sparks until 16:15. Storm protocol in effect.');
    },
    event(e, name, d) {
      const lat = (f: string) => Object.keys(e.T.laterals).filter(x => e.T.laterals[x].feeder === f && !e.s.dev[x].open);
      switch (name) {
        case 'mom': fault(e, e.pick(e.T.feeders[d.f].mainEls.slice(2)), false, 'lightning', false); break;
        case 'lat': { const fz = e.pick(lat(d.f)); if (fz) fault(e, e.pick(e.T.laterals[fz].els), false, 'tree_lateral', true); break; }
        case 'xf': { const ls = e.T.loadIds.filter(l => e.T.loads[l].feeder === d.f && e.T.loads[l].cls === 'res' && e.loadEn(l)); if (ls.length) fault(e, e.pick(ls), true, e.pick(['xfmr_failure', 'lightning'] as Cause[]) === 'lightning' ? 'xfmr_failure' : 'animal', true); break; }
        case 'wire': {
          const fz = e.pick(lat(d.f));
          if (fz) { const f = fault(e, e.T.laterals[fz].els[1] ?? e.T.laterals[fz].els[0], false, 'tree_lateral', true, true); e.s.scen.flags.wireFault = f.id; }
          break;
        }
        case 'main': { const el = e.mainElAfter('R-3115', 2); fault(e, el, false, 'tree_primary', true, false); break; }
        case 'callout': {
          const tr = e.addTruck(d.t, SERVICE_CENTER);
          e.say([[d.t, `Sparks Control, ${d.t} on duty at the service center, two-man crew, ready for assignment.`], ['C', `Copy ${d.t}, stand by for assignment.`]], { unit: d.t });
          e.log('DISPATCH', 'good', `Callout crew Truck ${d.t} (${tr.crew}) on duty`);
          break;
        }
        case 'clear':
          e.s.weather = { text: 'Storm cleared — scattered showers, wind NW 15 mph', level: 'watch' };
          e.s.scen.flags.genOff = { xfmr: true, lateral: true, momentary: true };
          e.log('SYSTEM', 'info', 'NWS: Severe Thunderstorm Warning expired.');
          break;
      }
    },
    periodic(e) {
      const F = e.s.scen.flags;
      const hazInc = Object.values(e.s.incidents).find(i => i.hazard);
      if (hazInc && F.hazT === undefined) F.hazT = e.s.t;
      if (hazInc && F.hazT !== undefined) {
        if (hazInc.firstDispatchT !== null) e.setObj('c1', hazInc.firstDispatchT - F.hazT <= 480 ? 'pass' : 'fail', `${((hazInc.firstDispatchT - F.hazT) / 60).toFixed(1)} min`);
        else if (e.s.t - F.hazT > 480) e.setObj('c1', 'fail', 'Wire down unassigned > 8 min');
      }
      F.chk = F.chk ?? 0;
      for (const inc of Object.values(e.s.incidents)) {
        if (inc.firstDispatchT === null || inc.firstDispatchT <= F.chk) continue;
        if (inc.priority === 3) {
          const waiting = Object.values(e.s.incidents).some(o => o.priority === 1 && o.status !== 'Closed' && o.status !== 'Restored' && (o.firstDispatchT === null || o.firstDispatchT > inc.firstDispatchT!) && inc.firstDispatchT! - o.t > 120);
          if (waiting) e.setObj('c2', 'fail', `${inc.id} (P3) dispatched while a P1 waited`);
        }
      }
      F.chk = e.s.t;
      if (e.s.t >= 3600 && e.s.scen.obj.c3.status === 'pending') {
        const ci = e.s.metrics.ci, out = e.customersOut();
        const pct = ci ? (ci - out) / ci : 1;
        e.setObj('c3', pct >= 0.75 ? 'pass' : 'fail', `${Math.round(pct * 100)}% restored`);
      }
      if (!noViolation(e, ['tag', 'energize-fault', 'clearance', 'clearance-release', 'repeat-back'])) e.setObj('c4', 'fail');
    },
    isDone(e) {
      if (e.s.t < 5400) return false;
      e.setObj('c2', 'pass'); e.setObj('c4', 'pass');
      return true;
    },
  },

  D: {
    id: 'D', short: 'D', name: 'Switching Operations',
    brief: 'Planned work: Truck 230 will replace a failed pin insulator on BS-3120 between S-3124 and S-3126. Switching order is drafted: pick up the load with a momentary loop through TS-14 from IW-2120, isolate the work section, issue the clearance, then restore. Use full three-part communication and verify every repeat-back.',
    objectives: [
      { id: 'd1', text: 'Catch the incorrect repeat-back' },
      { id: 'd2', text: 'Execute every switching step in order with repeat-backs' },
      { id: 'd3', text: 'Issue the clearance only on an isolated, de-energized section' },
      { id: 'd4', text: 'No unplanned customer interruptions' },
      { id: 'd5', text: 'Do not leave the loop closed longer than 15 minutes' },
      { id: 'd6', text: 'Return to normal configuration' },
    ],
    background: { single: 1800 },
    setup(e) {
      e.s.autoAssist = true;
      e.s.scen.flags.noRandomErrors = true;
      e.s.scen.flags.plannedMinutes = 18;
      const t230 = e.addTruck('230', offset((e.T.els['S-3126'] as DevEl).pos, 25, 10));
      e.addTruck('233', SERVICE_CENTER);
      e.addTruck('235', [33.2445, -97.1200]);
      startOnWorkOrder(e, '235', 1200);
      const el = e.mainElAfter('S-3124', 1);
      const sec = sectionAround(e.T, el);
      const ns = new Set(sec.nodes);
      let cust = 0;
      for (const l of e.T.loadIds) if (ns.has(e.T.loads[l].node)) { e.s.planned[l] = true; cust += e.T.loads[l].customers; }
      t230.task = { kind: 'planned', id: 'PW-7712' }; t230.status = 'Standing By';
      t230.waitIso = { inc: '', devs: ['S-3124', 'S-3126'], purpose: 'Planned insulator replacement' };
      (t230.waitIso as any).el = el;
      const o = e.newOrder('Planned — BS-3120 insulator replacement between S-3124 and S-3126', [
        { dev: 'TS-14', action: 'close', exec: '230', loop: true },
        { dev: 'S-3126', action: 'open', exec: '230', injectError: true, injectErrorDev: 'S-3122' },
        { dev: 'S-3124', action: 'open', exec: '230' },
        { dev: 'S-3124', action: 'close', exec: '230' },
        { dev: 'S-3126', action: 'close', exec: '230', loop: true },
        { dev: 'TS-14', action: 'open', exec: '230' },
      ]);
      o.holdAfter = 2;
      e.s.scen.flags.order = o.id;
      e.log('OMS', 'info', `Planned outage notice sent to ${cust} customers on BS-3120 (section S-3124 to S-3126).`);
      e.say([['230', 'Sparks Control, 230 on location at S-3126 for the planned insulator job, ready to start switching when you are.'], ['C', 'Copy 230, stand by.']], { unit: '230', start: 3 });
    },
    event(e, name) {
      if (name === 'orderComplete') {
        const tr = e.truck('230');
        e.say([['C', 'Truck 230, Sparks Control. Switching order complete, BS-3120 is back to normal. You are clear of the planned job, thank you.'], ['230', '230 copies, clear and available.']], { unit: '230', start: 6 });
        e.freeTruck(tr);
      }
    },
    periodic(e) {
      const F = e.s.scen.flags;
      if (F.caughtRepeat) e.setObj('d1', 'pass');
      if (F.missedRepeat) e.setObj('d1', 'fail', 'Incorrect repeat-back was confirmed');
      const o = e.s.orders[F.order];
      if (o?.status === 'Complete') e.setObj('d2', 'pass');
      if (o?.status === 'Cancelled') e.setObj('d2', 'fail', 'Order cancelled');
      if (!noViolation(e, ['clearance'])) e.setObj('d3', 'fail');
      else if (Object.values(e.s.clearances).some(c => c.truck === '230')) e.setObj('d3', 'pass');
      for (const l of Object.keys(e.s.loadOutSince)) if (!e.s.planned[l] && e.T.loads[l].feeder.startsWith('BS-3120') || (!e.s.planned[l] && e.T.loads[l].feeder === 'IW-2120')) { e.setObj('d4', 'fail', `${l} interrupted`); break; }
      if (e.s.loopSince !== null && e.s.t - e.s.loopSince > 900) e.setObj('d5', 'fail', 'Loop closed > 15 min');
      if (o?.status === 'Complete') {
        e.setObj('d5', 'pass'); e.setObj('d4', 'pass');
        if (allNormal(e)) e.setObj('d6', 'pass');
      }
    },
    isDone(e) { const o = e.s.orders[e.s.scen.flags.order]; return (!!o && (o.status === 'Complete' || o.status === 'Cancelled') && e.s.scen.obj.d6.status !== 'pending') || e.s.t > 3 * 3600 || (o?.status === 'Complete' && e.s.t - (o.steps.at(-1)?.doneT ?? e.s.t) > 120); },
  },

  E: {
    id: 'E', short: 'E', name: 'Critical Facility Outage',
    brief: 'CH-1220 serves Sparks Regional Medical Center through the Medical District. A fault will lock out recloser R-1225 and drop the hospital to emergency generation. Recognize the priority, get it back on utility power quickly using the SCADA tie to BS-3110, without backfeeding or closing into the fault.',
    objectives: [
      { id: 'e1', text: 'Dispatch a crew within 3 minutes of the lockout' },
      { id: 'e2', text: 'Restore Sparks Regional Medical Center within 20 minutes' },
      { id: 'e3', text: 'No backfeed, close-into-fault, or clearance violations' },
      { id: 'e4', text: 'Repair, return to normal configuration, and close the incident' },
    ],
    background: { single: 1800 },
    setup(e) {
      e.s.autoAssist = false;
      e.s.scen.flags.noRandomErrors = true;
      e.addTruck('230', SERVICE_CENTER);
      e.addTruck('233', [33.2445, -97.1330]);
      e.addTruck('235', [33.1930, -97.1420]);
      startOnWorkOrder(e, '233', 600);
      e.schedule(25, 'scn', { name: 'fault' });
    },
    event(e, name) {
      if (name === 'fault') {
        const el = e.mainElAfter('R-1225', 2);
        const f = fault(e, el, false, 'insulator', true, false);
        e.s.scen.flags.faultT = e.s.t; e.s.scen.flags.faultId = f.id;
        e.schedule(200, 'scn', { name: 'hospital' });
      }
      if (name === 'hospital') {
        const h = e.T.loadIds.find(l => e.T.loads[l].name?.includes('MEDICAL'))!;
        if (!e.loadEn(h)) e.log('OMS', 'alarm', 'Sparks Regional Medical Center facilities (phone): on emergency generator, ATS transferred, surgery suspended for non-emergent cases. Requesting ETR.');
      }
    },
    periodic(e) {
      const F = e.s.scen.flags;
      if (F.faultT === undefined) return;
      dispatchWithin(e, 'e1', 'R-1225', F.faultT, 180 + 17);
      const h = e.T.loadIds.find(l => e.T.loads[l].name?.includes('MEDICAL'))!;
      if (e.s.t - F.faultT > 30 && e.loadEn(h)) e.setObj('e2', e.s.t - F.faultT <= 1200 + 17 ? 'pass' : 'fail', `${((e.s.t - F.faultT) / 60).toFixed(1)} min`);
      else if (e.s.t - F.faultT > 1217) e.setObj('e2', 'fail', 'Hospital still on generator at 20 min');
      if (!noViolation(e, ['energize-fault', 'clearance', 'clearance-release', 'tag'])) e.setObj('e3', 'fail');
      const inc = incFor(e, 'R-1225');
      if (inc?.status === 'Closed' && allNormal(e)) { e.setObj('e4', 'pass'); e.setObj('e3', 'pass'); }
    },
    isDone(e) { const F = e.s.scen.flags; return e.s.scen.obj.e4.status !== 'pending' || (F.faultT !== undefined && e.s.t - F.faultT > 4 * 3600); },
  },

  F: {
    id: 'F', short: 'F', name: 'Communication Failure',
    brief: 'Truck 235 holds clearance on the end of CH-1210 (S-1216 to TS-11) for a planned pole change. During the job you will lose radio contact with the crew. Manage it without assuming the section is safe to energize, no matter who asks.',
    objectives: [
      { id: 'f1', text: 'Make at least two contact attempts within 5 minutes of the missed check' },
      { id: 'f2', text: 'Send a welfare check to the crew within 10 minutes' },
      { id: 'f3', text: 'Do not close, release, or energize anything under 235\'s clearance' },
      { id: 'f4', text: 'Restore the section only after 235 releases the clearance' },
    ],
    background: { xfmr: 1500, single: 1500 },
    setup(e) {
      e.s.autoAssist = true;
      e.s.scen.flags.noRandomErrors = true;
      e.s.dev['S-1216'].open = true;
      const el = e.mainElAfter('S-1216', 1);
      const sec = sectionAround(e.T, el);
      const ns = new Set(sec.nodes);
      for (const l of e.T.loadIds) if (ns.has(e.T.loads[l].node)) e.s.planned[l] = true;
      const tr = e.addTruck('235', offset(e.T.nodes[e.T.feeders['CH-1210'].end].pos as LatLng, 20, 120));
      e.addTruck('230', SERVICE_CENTER);
      e.addTruck('233', [33.2190, -97.1250]);
      startOnWorkOrder(e, '233', 700);
      e.refresh();
      const id = e.nextId('CL', 300);
      e.s.clearances[id] = { id, truck: '235', devs: sec.bounds, nodes: sec.nodes, issued: -3600, released: null, status: 'Active', purpose: 'Planned pole change-out, CH-1210 end section' };
      for (const b of sec.bounds) e.s.dev[b].tags.push(id);
      tr.clearance = id; tr.task = { kind: 'planned', id: 'PW-7730' }; tr.status = 'Working';
      e.schedule(2700, 'crew', { truck: '235', tok: tr.tok, step: 'repairDone' });
      e.schedule(60, 'scn', { name: 'commLoss' });
      e.schedule(150, 'scn', { name: 'check' });
      e.schedule(510, 'scn', { name: 'pressure' });
      e.log('SAFETY', 'info', `Clearance ${id} active to Truck 235 since ${e.hhmm(-3600)}: hold tags on ${sec.bounds.join(', ')}`);
    },
    event(e, name) {
      const F = e.s.scen.flags;
      const tr = e.truck('235');
      if (name === 'commLoss') { tr.comm = false; }
      if (name === 'check') {
        e.say([['C', 'Truck 235, Sparks Control, routine check on your clearance.']], { unit: '235' });
        e.schedule(15, 'noResponse', { truck: '235' });
        e.schedule(18, 'scn', { name: 'missed' });
      }
      if (name === 'missed' && !tr.comm) {
        F.missT = e.s.t; tr.status = 'Out of Contact';
        e.alarm('unit:235', 'Truck 235 missed clearance check — no radio contact (crew under CL hold)', 1);
        e.schedule(1500, 'scn', { name: 'selfRestore' });
      }
      if (name === 'pressure' && !tr.comm) {
        e.say([['249', 'Sparks Control, Supervisor 249. I\'ve got customers on Windsor and Woodrow calling the city manager. Can we close S-1216 and get them back on? 235 should be about done.']], { unit: '249' });
        e.request('pressure', '249', 'Close S-1216 to restore the CH-1210 end section', { dev: 'S-1216' });
      }
      if (name === 'selfRestore' && !tr.comm) e.restoreComm('235', '235 back on the air, our portable died and the truck radio lost its antenna lead. Crew is OK.');
      if (name === 'commRestored') F.commBackT = e.s.t;
    },
    periodic(e) {
      const F = e.s.scen.flags;
      if (F.missT !== undefined) {
        if ((F.contactAttempts ?? 0) >= 2) e.setObj('f1', e.s.t - F.missT <= 300 ? 'pass' : 'fail');
        else if (e.s.t - F.missT > 300) e.setObj('f1', 'fail', `${F.contactAttempts ?? 0} attempt(s)`);
        if (F.welfareT !== undefined) e.setObj('f2', F.welfareT - F.missT <= 600 ? 'pass' : 'fail', `${((F.welfareT - F.missT) / 60).toFixed(1)} min`);
        else if (e.s.t - F.missT > 600) e.setObj('f2', 'fail', 'No welfare check sent');
      }
      if (!noViolation(e, ['tag', 'clearance-release', 'energize-fault'])) e.setObj('f3', 'fail');
      const cl = Object.values(e.s.clearances).find(c => c.truck === '235');
      if (cl?.status === 'Released' && !e.s.dev['S-1216'].open) {
        e.setObj('f4', noViolation(e, ['clearance-release']) ? 'pass' : 'fail');
        e.setObj('f3', 'pass');
        const tr = e.truck('235');
        if (tr.task?.kind === 'planned') {
          e.say([['C', 'Truck 235, Sparks Control. S-1216 is closed, section restored. You are clear of the planned job.'], ['235', '235 copies, clear.']], { unit: '235', start: 4 });
          e.freeTruck(tr);
        }
      }
    },
    isDone(e) { return e.s.scen.obj.f4.status !== 'pending' || e.s.t > 2.5 * 3600; },
  },
};

export const SCENARIO_LIST = ['A', 'B', 'C', 'D', 'E', 'F'];
