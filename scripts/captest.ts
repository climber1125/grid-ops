// Capabilities: troubleman sent to a failed transformer asks for a bucket; a bucket truck relieves it and repairs.
// Read-backs: apprentice vs veteran error rate.
import { Engine } from '../src/sim/engine';
const e = Engine.create('A', 1001) as any; e.s.paused = false; e.s.speed = 10;
e.s.scen.flags.noRoutine = true; for (const k of Object.keys(e.scen.background)) { e.s.scen.flags.genOff = { ...(e.s.scen.flags.genOff ?? {}), [k]: true }; }
for (const inc of e.openIncidents()) { inc.status = 'Closed'; }
for (const f of Object.values(e.s.faults) as any[]) f.active = false;
e.rosterAdd('242', 'Vega / Nunez', 'Troubleman pickup', true);
const lid = Object.keys(e.T.loads).find((l: string) => e.T.loads[l].customers > 3)!;
e.createFault(lid, true, 'xfmr_failure', true);
let inc: any; for (let i = 0; i < 400 && !inc; i++) { e.tick(250); inc = e.openIncidents().find((x: any) => x.status === 'New'); }
console.log('incident', inc?.id, inc?.predDev);
console.log('dispatch 242:', e.dispatch('242', inc.id));
for (let i = 0; i < 4000 && e.s.trucks['242'].task?.stage !== 'needsHelp'; i++) e.tick(250);
console.log('242 stage', e.s.trucks['242'].task?.stage, 'needs', inc.needs);
console.log('  ', e.s.radio.filter((m: any) => /more than we can/.test(m.text)).map((m: any) => m.text)[0]);
const bucket = Object.values(e.s.trucks).find((t: any) => t.type.includes('bucket') && !t.task) as any ?? e.s.trucks['233'];
console.log('dispatch', bucket.id, e.dispatch(bucket.id, inc.id));
for (let i = 0; i < 4 * 60 * 200 && inc.status !== 'Closed' && inc.status !== 'Restored'; i++) e.tick(250);
console.log('result', inc.status, '242 now', e.s.trucks['242'].status, e.s.trucks['242'].task);
console.log('timeline', inc.timeline.map((x: any) => x.text).join(' | '));
// read-back error rates
for (const exp of ['Veteran', 'Journeyman', 'Apprentice']) {
  const mult = exp === 'Veteran' ? 0.4 : exp === 'Apprentice' ? 3 : 1;
  console.log(exp, 'expected error rate', (0.04 * mult * 100).toFixed(1) + '%');
}
