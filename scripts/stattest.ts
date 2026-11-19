import { Engine } from '../src/sim/engine';
const e = Engine.create('A', 1001); e.s.paused = false;
const seen = new Set<string>();
const u = Object.keys(e.s.trucks)[0];
for (let i = 0; i < 4 * 3000; i++) {
  e.tick(250);
  if (i % 4 * 1 === 0 && i % 80 === 0) {
    const tr = e.s.trucks[u]; const key = (tr.task?.kind ?? 'none') + ':' + ((tr.task as any)?.stage ?? '') + ':' + tr.status;
    if (!seen.has(key)) { seen.add(key); console.log(`[${Math.round(e.s.t)}s ${key}] ${e.progressReport(tr)}`); }
  }
}
// also woi
const e2 = Engine.create('A', 1001); e2.s.paused = false; e2.s.scen.flags.noRoutine = true; for (let i = 0; i < 40; i++) e2.tick(250);
const wo = e2.newWorkOrder(); e2.dispatchWo(u, wo.id);
for (const s of [30, 60, 200, 100]) { for (let i = 0; i < 4 * s; i++) e2.tick(250); console.log(`WO +${s}s:`, e2.progressReport(e2.s.trucks[u])); }
e2.voiceTx(`${u} status`); for (let i = 0; i < 80; i++) e2.tick(250); console.log(e2.s.radio.slice(-3).map(m => m.from + ': ' + m.text));
