// Common student mistakes should each be caught by the order check.
import { Engine } from '../src/sim/engine';
import { listSections, checkOrder, type ExerciseDef } from '../src/sim/exercise';
const e = Engine.create('A', 1001);
const s = listSections(e.T).find(x => x.label.startsWith('BS-3120: between S-3122 and CB-3120'))!;
const def: ExerciseDef = { v: 1, id: 'EX', title: 't', feeder: s.feeder, workEl: s.el, work: 'w', truck: '233', minutes: 10, coach: true, by: 'instructor' };
const S = (dev: string, action: 'open' | 'close', loop = false, exec = '233') => ({ dev, action, exec, loop });
const cases: [string, any[], number | undefined][] = [
  ['Opens the getaway disconnect under load', [S('TS-14', 'close', true), S('S-3122', 'open'), S('D-3120L', 'open'), S('CB-3120', 'open', false, 'SCADA')], 3],
  ['Closes tie without LOOP', [S('TS-14', 'close'), S('S-3122', 'open'), S('CB-3120', 'open', false, 'SCADA'), S('D-3120L', 'open')], 3],
  ['Never picks up downstream load', [S('S-3122', 'open'), S('CB-3120', 'open', false, 'SCADA'), S('D-3120L', 'open')], 2],
  ['Break-before-make (momentary)', [S('S-3122', 'open'), S('TS-14', 'close'), S('CB-3120', 'open', false, 'SCADA'), S('D-3120L', 'open')], 3],
  ['Forgets the visible open', [S('TS-14', 'close', true), S('S-3122', 'open'), S('CB-3120', 'open', false, 'SCADA')], 2],
  ['No hold point', [S('TS-14', 'close', true), S('S-3122', 'open'), S('CB-3120', 'open', false, 'SCADA'), S('D-3120L', 'open')], undefined],
  ['SCADA on a manual switch', [S('TS-14', 'close', true, 'SCADA'), S('S-3122', 'open'), S('CB-3120', 'open', false, 'SCADA'), S('D-3120L', 'open')], 3],
];
for (const [name, steps, hold] of cases) {
  const c = checkOrder(e, def, steps, hold);
  console.log(`\n${name}: ${c.verdict.toUpperCase()}`);
  for (const f of c.findings) if (f.level === 'fail' || f.level === 'warn') console.log(`   ${f.level}: ${f.text}`);
}
