// Crew pace: same job for a fast vs slow crew; checks travel, job time and the ETR-overrun call.
import { Engine } from '../src/sim/engine';
const T = (sec: number) => `${(sec / 60).toFixed(1)}m`;
function run(drive: number, work: number) {
  const e = Engine.create('A', 1001);
  const tr = Object.values(e.s.trucks)[0]; tr.drive = drive; tr.work = work;
  const wo = e.newWorkOrder();
  const travel = e.startRoute(tr, wo.pos, 'test');
  let job = 0; for (let i = 0; i < 200; i++) job += e.workSec(tr, 1200); job /= 200;
  return `drive ${drive} work ${work}: travel ${T(travel)}  20-min job takes ${T(job)}`;
}
console.log(run(0.8, 0.8)); console.log(run(1, 1)); console.log(run(1.3, 1.3));
// ETR overrun: very slow crew on a fuse repair should radio for more time.
const e = Engine.create('A', 1001) as any; e.s.paused = false; e.s.speed = 10;
for (const tr of Object.values(e.s.trucks) as any[]) { tr.work = 1.3; }
let found = false;
for (let i = 0; i < 4 * 60 * 120 && !found; i++) { e.tick(250); found = e.s.radio.some((m: any) => /running long/.test(m.text)); for (const inc of e.openIncidents()) if (inc.status === 'New') { const free = (Object.values(e.s.trucks) as any[]).find(t => t.status === 'Available'); if (free) e.dispatch(inc.id, free.id); } }
const msg = e.s.radio.find((m: any) => /running long/.test(m.text));
console.log('ETR overrun call:', found ? `${msg.from}: ${msg.text}` : 'none');
