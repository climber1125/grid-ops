import { Engine } from '../src/sim/engine';
const e = Engine.create('A', 1001); e.s.paused = false; e.s.scen.flags.noRoutine = true;
for (let i = 0; i < 40; i++) e.tick(250);
const wo = e.newWorkOrder();
const unit = Object.keys(e.s.trucks)[0];
console.log('wo', wo.id, 'unit', unit);
for (const phrase of [`${unit}, can you respond to work order ${wo.id.slice(3)}`, `Truck ${unit} go to W O ${wo.id.slice(3)}`, `${unit}, respond to work order 9999`, `${unit}, work order`]) {
  const before = e.s.radio.length;
  const r = e.voiceTx(phrase);
  for (let i = 0; i < 60; i++) e.tick(250);
  console.log(JSON.stringify(phrase), '→ err:', r, '| state:', e.s.workorders[wo.id].status, e.s.workorders[wo.id].truck, e.s.trucks[unit].task);
  console.log('  ', e.s.radio.slice(before).filter(m => m.kind !== 'operator').map(m => m.from + ': ' + m.text.slice(0, 80)));
}
for (let i = 0; i < 4 * 600; i++) e.tick(250);
console.log('later', e.s.workorders[wo.id].status, e.s.trucks[unit].status);
const e2 = Engine.create('A', 1001); e2.s.paused = false; e2.s.scen.flags.noRoutine = true;
for (let i = 0; i < 40; i++) e2.tick(250);
const w2 = e2.newWorkOrder(); const u2 = Object.keys(e2.s.trucks)[0];
e2.voiceTx(`${u2} respond to work order ${w2.id.slice(3)}`);
let last = '';
for (let i = 0; i < 4 * 1500; i++) { e2.tick(250); const k = `${e2.s.workorders[w2.id].status}/${e2.s.trucks[u2].status}`; if (k !== last) { console.log(Math.round(e2.s.t), k); last = k; } }
