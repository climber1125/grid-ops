// Field crews: join, status, switching steps confirmed from the phone, mistakes, clearance and release.
import { Engine } from '../src/sim/engine';
import { fieldInit, fieldApply, fieldDispatch, fieldState, fieldManualDone, yardSnapshot } from '../src/sim/field';
const e = Engine.create('A', 1001) as any;
e.s.scen.flags.noRandomErrors = true;
fieldInit(e, 'TEST01', 'local');
let n = 0;
const ev = (o: any) => fieldApply(e, { id: `ev${++n}`, t: e.s.t, ...o });
const out = () => { const f = fieldState(e); const m = f.outbox.splice(0); return m.map((x: any) => `[${x.truck} ${x.kind}/${x.state}] ${x.text}`); };
const tick = (sec: number) => { for (let i = 0; i < sec * 4; i++) e.tick(250); };
console.log('join 250:', ev({ truck: '250', kind: 'join', foreman: 'J. Ruiz', members: ['A. Lee', 'M. Cho'] }));
console.log('join 233 (sim truck):', ev({ truck: '233', kind: 'join', foreman: 'X' }));
console.log(out());
const tr = e.s.trucks['250'];
console.log('250 status', tr.status, 'crew', tr.crew, 'pos', tr.pos.map((v: number) => v.toFixed(5)).join(','));
console.log('dispatch to incident refused:', e.dispatch('250', Object.keys(e.s.incidents)[0] ?? 'none'));
console.log('send to device:', fieldDispatch(e, '250', 'S-4123', 'planned switching'), out());
ev({ truck: '250', kind: 'status', status: 'En route', dest: 'S-4123' });
ev({ truck: '250', kind: 'status', status: 'On site', at: 'S-4123' });
console.log('after on site:', tr.status, out());
// Order: isolate TX-4120 beyond S-4123 (cap bank there)
const o = e.newOrder('Isolate TX-4120 end', [
  { dev: 'CAP-4124', action: 'manual', exec: '250', loop: false },
  { dev: 'CAP-4124', action: 'open', exec: '250', loop: false },
  { dev: 'S-4123', action: 'open', exec: '250', loop: false },
]);
console.log('activate', e.activateOrder(o.id) ?? 'ok');
for (let i = 0; i < 3; i++) {
  console.log(`issue step ${i + 1}:`, e.issueStep(o.id) ?? 'ok', o.steps[o.cur].status);
  if (i === 0) { console.log('  negative:', e.confirmRepeat(o.id, false) ?? 'ok', o.steps[o.cur].status); }
  console.log('  confirm:', e.confirmRepeat(o.id, true) ?? 'ok', o.steps[o.cur].status);
  const st = o.steps[o.cur];
  if (i === 1) { console.log('  wrong device tap:', ev({ truck: '250', kind: 'operate', dev: 'S-4121', action: 'open', verified: true, tag: 'nfc' })); e.operate('S-4121', 'close', { by: 'SCADA_FIX', loopOk: true }); }
  console.log('  tap:', ev({ truck: '250', kind: 'operate', dev: st.dev, action: st.action, verified: true, tag: 'nfc' }));
  tick(2);
}
console.log('order', o.status, 'S-4123 open', e.s.dev['S-4123'].open, 'CAP open', e.s.dev['CAP-4124'].open, 'ctl', e.s.dev['CAP-4124'].ctl);
console.log('step logs:', o.steps.map((s: any) => s.log.map((l: any) => l.ev).join(' | ')));
console.log(out());
e.s.dev['CAP-4124'].capDead = e.s.t - 600;
console.log('clearance req:', ev({ truck: '250', kind: 'clearance', text: 'replace insulator' }));
const req = e.s.requests.find((r: any) => r.type === 'clearance' && r.truck === '250');
console.log('request', req?.text, 'devs', req?.devs);
console.log('grant:', e.approve(req.id) ?? 'ok', 'truck clearance', tr.clearance, tr.status, out());
console.log('release:', ev({ truck: '250', kind: 'release' }));
const rel = e.s.requests.find((r: any) => r.type === 'release' && r.truck === '250');
console.log('ack:', e.releaseClearance(rel.devs[0], false, rel) ?? 'ok', tr.status, out());
console.log('violations:', e.s.metrics.violations.map((v: any) => v.text));
console.log('radio lines from 250 (should be none):', e.s.radio.filter((m: any) => m.from === '250' || m.from === 'TRUCK 250').length);
console.log('snapshot devices:', Object.keys(yardSnapshot(e).dev).length);
console.log('manual fallback (no step):', fieldManualDone(e, o.id));
tick(30); console.log('250 still at', tr.pos.map((v: number) => v.toFixed(5)).join(','), 'route', tr.route);
