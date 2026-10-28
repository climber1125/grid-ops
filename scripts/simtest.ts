// Headless engine test: drives scenarios through full outage-to-restoration.
import { Engine } from '../src/sim/engine';

const run = (e: Engine, secs: number, step = 0.5) => { for (let i = 0; i < secs / step; i++) e.advance(step); };
const until = (e: Engine, pred: () => boolean, max = 7200, label = '') => {
  let t = 0; while (!pred() && t < max) { e.advance(1); t++; }
  if (!pred()) throw new Error('Timeout waiting for ' + label + ' at t=' + e.s.t.toFixed(0));
};
const doStep = (e: Engine, oid: string) => {
  const o = e.s.orders[oid];
  const idx = o.cur;
  const err = e.issueStep(oid); if (err) throw new Error('issue ' + err);
  if (o.steps[idx].exec === 'SCADA') return;
  until(e, () => o.steps[idx].status === 'RepeatBack', 120, 'repeat');
  const s = o.steps[idx];
  const correct = s.rbDev === s.dev && s.rbAction === s.action;
  e.confirmRepeat(oid, correct);
  if (!correct) { until(e, () => o.steps[idx].status === 'RepeatBack', 120, 'repeat2'); e.confirmRepeat(oid, true); }
  until(e, () => ['Done', 'Failed'].includes(o.steps[idx].status), 2400, 'step done');
  if (o.steps[idx].status === 'Failed') throw new Error('step failed: ' + o.steps[idx].note);
};
const pendingReq = (e: Engine, type: string) => e.s.requests.find(r => r.type === type && r.status === 'Pending');

const T = (await import('../src/sim/topology')).TOPO;
console.log('Topology: nodes', Object.keys(T.nodes).length, 'els', Object.keys(T.els).length, 'loads', T.loadIds.length, 'customers', T.totalCustomers);
{
  const e = Engine.create('A', 7);
  for (const f of T.feederIds) { const r = e.readings[f]; console.log(f, 'kW', r.kw.toFixed(0), 'A', r.amps.toFixed(0), 'pct', (r.pct * 100).toFixed(0), 'vEnd', r.vEnd.toFixed(3), 'cust', r.cust); }
}

// ── Scenario A: watch 40 min unattended
{
  const e = Engine.create('A', 11);
  run(e, 2400);
  const incs = Object.values(e.s.incidents);
  console.log('\n[A] t=40min incidents', incs.length, incs.map(i => `${i.id}:${i.status}:${i.predDev}:${i.custOut}/${i.peak}`).join(' '));
  console.log('[A] radio msgs', e.s.radio.length, 'calls', e.s.callOrder.length, 'alarms', e.s.alarms.length, 'out now', e.customersOut(), 'violations', e.s.metrics.violations.length);
  console.log('[A] trucks', Object.values(e.s.trucks).map(t => `${t.id}:${t.status}:${t.task?.kind ?? '-'}`).join(' '));
  console.log('[A] sample radio:\n  ' + e.s.radio.slice(0, 14).map(m => `${e.hhmmss(m.t)} ${m.from}: ${m.text}`).join('\n  '));
}

// ── Scenario B: full feeder lockout → isolate → restore → clearance → normal
{
  const e = Engine.create('B', 42);
  run(e, 60);
  console.log('\n[B] CB-2110', e.s.dev['CB-2110'], 'out', e.customersOut());
  const inc = Object.values(e.s.incidents).find(i => i.truthDev === 'CB-2110')!;
  console.log('[B] inc', inc.id, inc.priority, inc.custOut, inc.status);
  console.log('[B] dispatch', e.dispatch('233', inc.id));
  until(e, () => inc.stage === 'Isolate', 3600, 'fault found');
  console.log('[B] found at', e.hhmm(), 'isolation', inc.isolation, 'truck', e.truck('233').status);
  console.log('[B] SCADA open S-2116', e.scadaControl('S-2116', 'open'));
  const o = e.newOrder('Isolate fault IW-2110', [{ dev: 'S-2114', action: 'open', exec: '233' }]);
  e.activateOrder(o.id); doStep(e, o.id);
  console.log('[B] S-2114 open?', e.s.dev['S-2114'].open, 'order', o.status);
  console.log('[B] close CB-2110', e.scadaControl('CB-2110', 'close'), 'out', e.customersOut());
  const o2 = e.newOrder('Pick up IW-2110 downstream via TS-12', [{ dev: 'TS-12', action: 'close', exec: '230' }]);
  e.activateOrder(o2.id); doStep(e, o2.id);
  console.log('[B] after TS-12 close out', e.customersOut(), 'CH-1220 pct', (e.readings['CH-1220'].pct * 100).toFixed(0));
  until(e, () => !!pendingReq(e, 'clearance'), 600, 'clearance req');
  console.log('[B] approve clearance', e.approve(pendingReq(e, 'clearance')!.id), e.s.dev['S-2114'].tags);
  // try an unsafe close – should be blocked + violation
  until(e, () => !!pendingReq(e, 'release'), 7200, 'release req');
  console.log('[B] release', e.approve(pendingReq(e, 'release')!.id));
  const o3 = e.newOrder('Restore normal IW-2110', [
    { dev: 'S-2114', action: 'close', exec: '233' }, { dev: 'TS-12', action: 'open', exec: '230' }, { dev: 'S-2116', action: 'close', exec: 'SCADA' }]);
  e.activateOrder(o3.id); doStep(e, o3.id); doStep(e, o3.id); doStep(e, o3.id);
  run(e, 30);
  console.log('[B] inc status', inc.status, 'out', e.customersOut());
  console.log('[B] verify', e.verifyIncident(inc.id));
  run(e, 10);
  console.log('[B] objectives', JSON.stringify(e.s.scen.obj), 'done', e.s.scen.done, 'violations', e.s.metrics.violations);
  console.log('[B] CMI', e.s.metrics.cmi.toFixed(0), 'CI', e.s.metrics.ci);
}

// ── Scenario E: hospital
{
  const e = Engine.create('E', 3);
  run(e, 60);
  const inc = Object.values(e.s.incidents).find(i => i.truthDev === 'R-1225')!;
  console.log('\n[E] inc', inc?.id, inc?.priority, inc?.critical, inc?.custOut);
  e.dispatch('230', inc.id);
  console.log('[E] open S-1226', e.scadaControl('S-1226', 'open'));
  console.log('[E] close TS-13', e.scadaControl('TS-13', 'close'));
  run(e, 10);
  console.log('[E] obj', JSON.stringify(e.s.scen.obj));
  console.log('[E] TS-12 close attempt (would energize fault section):', e.operate('TS-12', 'close', { by: '230' }));
  console.log('[E] violations', e.s.metrics.violations.map(v => v.code));
}

// ── Scenario D: switching w/ injected repeat error
{
  const e = Engine.create('D', 5);
  run(e, 20);
  const oid = e.s.scen.flags.order;
  e.activateOrder(oid);
  for (let i = 0; i < 3; i++) doStep(e, oid);
  console.log('\n[D] after isolation: caught?', e.s.scen.flags.caughtRepeat, 'loop', e.net.loops, 'out', e.customersOut());
  until(e, () => !!pendingReq(e, 'clearance'), 600, 'clr');
  console.log('[D] blocked close during clearance?');
  console.log('[D] grant', e.approve(pendingReq(e, 'clearance')!.id));
  until(e, () => !!pendingReq(e, 'release'), 7200, 'release');
  e.approve(pendingReq(e, 'release')!.id);
  for (let i = 0; i < 3; i++) doStep(e, oid);
  run(e, 200);
  console.log('[D] obj', JSON.stringify(e.s.scen.obj), 'done', e.s.scen.done);
}

// ── Scenario F
{
  const e = Engine.create('F', 9);
  run(e, 200);
  e.statusCheck('235'); e.cellCall('235');
  e.welfareCheck('230', '235');
  run(e, 400);
  const p = pendingReq(e, 'pressure'); if (p) e.deny(p.id);
  until(e, () => !!pendingReq(e, 'release'), 7200, 'release');
  e.approve(pendingReq(e, 'release')!.id);
  e.scadaControl('S-1216', 'close');
  run(e, 20);
  console.log('\n[F] obj', JSON.stringify(e.s.scen.obj), 'violations', e.s.metrics.violations.length);
}

// ── Scenario C quick sanity
{
  const e = Engine.create('C', 21);
  run(e, 900);
  console.log('\n[C] incidents', Object.values(e.s.incidents).map(i => `${i.id}:P${i.priority}${i.hazard ? 'H' : ''}:${i.custOut}`).join(' '), 'trucks', Object.keys(e.s.trucks).join(','));
  const json = JSON.stringify(e.s);
  const e2 = new Engine(JSON.parse(json));
  run(e2, 60);
  console.log('[C] save/restore OK, size KB', (json.length / 1024).toFixed(0), 't', e2.s.t.toFixed(0));
}
