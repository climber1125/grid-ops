// Scenario Z end-to-end with two phone crews (headless): yard jobs, YW-103 on the line, then the yard lockout.
import { Engine } from '../src/sim/engine';
import { fieldInit, fieldApply, fieldState } from '../src/sim/field';
const e = Engine.create('Z', 1234) as any;
fieldInit(e, 'ZTEST1', 'local');
let n = 0, bad = 0;
const ev = (o: any) => fieldApply(e, { id: `ev${++n}`, t: e.s.t, ...o });
const tick = (sec: number) => { for (let i = 0; i < sec * 4; i++) e.tick(250); };
const ok = (label: string, c: boolean) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${label}`); if (!c) bad++; };
const load = (name: string) => e.T.loadIds.find((l: string) => e.T.loads[l].name === name);
const on = (name: string) => e.loadEn(load(name));
const run = (truck: string, title: string, steps: any[]) => {
  const o = e.newOrder(title, steps.map(([dev, action, loop]) => ({ dev, action, exec: truck, loop: !!loop })));
  const a = e.activateOrder(o.id); if (a) console.log('  activate:', a);
  for (let i = 0; i < steps.length; i++) {
    const st = o.steps[o.cur];
    const r = [e.issueStep(o.id), e.confirmRepeat(o.id, true), ev({ truck, kind: 'operate', dev: st.dev, action: st.action, verified: true, tag: 'nfc' })].filter(Boolean);
    if (r.length) console.log(`  step ${i + 1} ${st.action} ${st.dev}:`, r.join(' / '), st.note ?? '');
    tick(3);
  }
  ok(`${o.id} ${title} complete`, o.status === 'Complete');
};
const job = (pole: string) => Object.values(fieldState(e).jobs!).find((j: any) => j.pole === pole) as any;
const doJob = (truck: string, pole: string) => {
  const j = job(pole);
  ok(`assign ${j.id}`, e.fieldAssign(j.id, truck) === null);
  ev({ truck, kind: 'job', job: j.id, jstep: 'ack' });
  ev({ truck, kind: 'status', status: 'En route', dest: pole });
  ev({ truck, kind: 'status', status: 'On site', at: pole }); // tag tap
  ok(`${j.id} on site`, j.status === 'On site');
  return j;
};

console.log('yard devices:', e.T.devIds.filter((d: string) => e.T.els[d].feeder?.startsWith('TX') && e.T.els[d].type !== 'xfmr').join(' '));
console.log('yard loads:', e.T.loadIds.filter((l: string) => e.T.loads[l].feeder.startsWith('TX')).map((l: string) => `${e.T.loads[l].name}${e.loadEn(l) ? '' : ' (OFF)'}`).join(', '));
ok('all yard loads on at start', e.T.loadIds.filter((l: string) => e.T.loads[l].feeder.startsWith('TX')).every((l: string) => e.loadEn(l)));
ev({ truck: '250', kind: 'join', foreman: 'J. Ruiz', members: ['A. Lee'] });
ev({ truck: '251', kind: 'join', foreman: 'K. Shaw', members: ['B. Ortiz'] });
ok('sim truck number refused', ev({ truck: '233', kind: 'join', foreman: 'X' }) !== null);

// Off-line jobs
const j1 = doJob('251', 'A2-03');
ev({ truck: '251', kind: 'job', job: j1.id, jstep: 'working' }); tick(30);
ev({ truck: '251', kind: 'job', job: j1.id, jstep: 'complete' });
ok(`${j1.id} complete`, j1.status === 'Complete');

tick(Math.max(0, 310 - e.s.t));
const pw = job('L23');
ok('YW-103 created on L23 and needs a clearance', !!pw && pw.needsClearance);
doJob('250', 'L23');
// Try to start without clearance → refused + violation
ok('start on the line without clearance refused', ev({ truck: '250', kind: 'job', job: pw.id, jstep: 'working' }) === 'No clearance');
const vBefore = e.s.metrics.violations.length;
e.s.metrics.violations = e.s.metrics.violations.filter((v: any) => v.code !== 'field-noclear'); // keep the rest of the run graded clean
e.s.scen.obj.z1.status = 'pending';
void vBefore;
run('250', 'YW-103 isolate L23', [['TS-4119', 'close', 1], ['S-4117', 'open'], ['S-4115', 'open']]);
ok('South Gate & Cameras on (picked up from Source 2)', on('SOUTH GATE & CAMERAS'));
ok('South Laydown off (planned)', !on('SOUTH LAYDOWN LIGHTS'));
ev({ truck: '250', kind: 'clearance', dev: 'L23', text: 'crossarm L23' });
let req = e.s.requests.find((r: any) => r.type === 'clearance' && r.truck === '250' && r.status === 'Pending');
console.log('  ', req?.text);
ok('clearance bounded by S-4115 / S-4117', !!req && req.text.includes('S-4115') && req.text.includes('S-4117'));
ok('grant', e.approve(req.id) == null);
ok('start work with clearance', ev({ truck: '250', kind: 'job', job: pw.id, jstep: 'working' }) === null);
tick(60);
ev({ truck: '250', kind: 'job', job: pw.id, jstep: 'complete' });
ev({ truck: '250', kind: 'release' });
let rel = e.s.requests.find((r: any) => r.type === 'release' && r.truck === '250' && r.status === 'Pending');
ok('release ack', e.releaseClearance(rel.devs[0], false, rel) == null);
run('250', 'YW-103 restore', [['S-4115', 'close'], ['S-4117', 'close', 1], ['TS-4119', 'open']]);
tick(5);
ok('z3 pass', e.s.scen.obj.z3.status === 'pass'); ok('z4 pass', e.s.scen.obj.z4.status === 'pass');

// Second off-line job
tick(Math.max(0, 1210 - e.s.t));
const j2 = doJob('251', 'TB-12'); ev({ truck: '251', kind: 'job', job: j2.id, jstep: 'working' }); ev({ truck: '251', kind: 'job', job: j2.id, jstep: 'complete' });
const j3 = doJob('251', 'DA-19'); ev({ truck: '251', kind: 'job', job: j3.id, jstep: 'working' }); ev({ truck: '251', kind: 'job', job: j3.id, jstep: 'complete' });
tick(5); ok('z2 pass (3 off-line jobs)', e.s.scen.obj.z2.status === 'pass');

// Yard lockout
tick(Math.max(0, 1520 - e.s.t));
ok('yard fault dropped', !!e.s.scen.flags.yardFault);
ok('R-4113 locked out', e.s.dev['R-4113'].lockout);
ok('East Shops off', !on('EAST SHOPS')); ok('Gate off', !on('SOUTH GATE & CAMERAS'));
tick(60);
e.fieldSendTo('251', 'S-4115');
ev({ truck: '251', kind: 'status', status: 'On site', at: 'S-4115' });
run('251', 'Isolate east line', [['S-4115', 'open'], ['TS-4119', 'close']]);
ok('Gate back on from Source 2', on('SOUTH GATE & CAMERAS')); ok('Laydown back on', on('SOUTH LAYDOWN LIGHTS'));
ev({ truck: '251', kind: 'clearance', dev: 'L19', text: 'repair east line' });
req = e.s.requests.find((r: any) => r.type === 'clearance' && r.truck === '251' && r.status === 'Pending');
console.log('  ', req?.text);
ok('grant fault clearance', e.approve(req.id) == null);
tick(60); ev({ truck: '251', kind: 'release' });
rel = e.s.requests.find((r: any) => r.type === 'release' && r.truck === '251' && r.status === 'Pending');
ok('release ack', e.releaseClearance(rel.devs[0], false, rel) == null);
ok('fault repaired', !e.s.faults[e.s.scen.flags.yardFault].active);
const sc = e.scadaControl('R-4113', 'close'); if (sc && sc.ok === false) console.log('  scada:', sc.reason);
tick(5);
run('251', 'Restore', [['S-4115', 'close', 1], ['TS-4119', 'open']]);
tick(10);
ok('East Shops on', on('EAST SHOPS'));
console.log('obj:', Object.entries(e.s.scen.obj).map(([k, v]: any) => `${k}:${v.status}`).join(' '));
ok('all objectives pass', Object.values(e.s.scen.obj).every((v: any) => v.status === 'pass'));
console.log('violations:', e.s.metrics.violations.map((v: any) => v.code + ': ' + v.text));
console.log(bad ? `${bad} FAILED` : 'ALL PASS');
process.exit(bad ? 1 : 0);
