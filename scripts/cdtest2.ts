import { Engine } from '../src/sim/engine';
const e = Engine.create('B', 1001); e.scheduleDrill(300); e.s.paused = false;
for (let i = 0; i < 4 * 290; i++) e.tick(250);
console.log('before', e.s.scen.flags.cdUnit);
for (let i = 0; i < 4 * 40; i++) e.tick(250);
console.log('after', e.s.scen.flags.cdUnit, e.s.alarms.some(a => a.key === 'mayday-cd'));
