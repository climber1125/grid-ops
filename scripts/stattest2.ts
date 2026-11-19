import { Engine } from '../src/sim/engine';
const e = Engine.create('T', 7); e.s.paused = false; e.s.scen.flags.noRoutine = true;
const u = Object.keys(e.s.trucks)[0]; const wo = e.newWorkOrder(); console.log(e.dispatchWo(u, wo.id));
let last = '';
for (let i = 0; i < 4 * 1500; i++) { e.tick(250); if (i % 40 === 0) { const r = e.progressReport(e.s.trucks[u]); const k = r.slice(0, 20); if (k !== last || /percent/.test(r)) { console.log(Math.round(e.s.t), r); last = k; } } }
