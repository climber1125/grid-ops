// New-equipment and company-rule mistakes: each should be caught by the check, and by the engine when executed.
import { Engine } from '../src/sim/engine';
import { listSections, checkOrder, RULE_PRESETS, type ExerciseDef } from '../src/sim/exercise';
const e = Engine.create('A', 1001) as any;
const secs = listSections(e.T);
const S = (dev: string, action: any, loop = false, exec = '233') => ({ dev, action, exec, loop });
const D = (o: Partial<ExerciseDef>): ExerciseDef => ({ v: 1, id: 'EX', title: 't', kind: 'isolate', feeder: '', workEl: '', work: 'w', truck: '233', minutes: 10, coach: true, by: 'instructor', ...o } as ExerciseDef);
const show = (name: string, def: ExerciseDef, steps: any[], hold?: number) => {
  const c = checkOrder(e, def, steps, hold);
  console.log(`\n${name}: ${c.verdict.toUpperCase()}`);
  for (const f of c.findings) if (f.level === 'fail' || f.level === 'warn') console.log(`   ${f.level}: ${f.text}`);
};
const reg = D({ kind: 'bypass', feeder: 'BS-3110', workEl: 'VR-3117' });
show('Regulator bypassed without running to neutral', reg, [S('VR-3117', 'manual'), S('BP-3117', 'close'), S('D-3117L', 'open'), S('D-3117S', 'open')], 3);
show('Regulator bypassed with control left in AUTO', reg, [S('BP-3117', 'close'), S('D-3117L', 'open'), S('D-3117S', 'open')], 2);
show('Neutral while still in AUTO', reg, [S('VR-3117', 'neutral'), S('BP-3117', 'close'), S('D-3117L', 'open'), S('D-3117S', 'open')], 3);
const sX = secs.find((x: any) => x.label.startsWith('BS-3120: between S-3122 and CB-3120'))!;
const mbb = [S('TS-14', 'close', true), S('S-3122', 'open'), S('CB-3120', 'open', false, 'SCADA'), S('D-3120L', 'open')];
show('STRICT: make-before-break across substations', D({ feeder: sX.feeder, workEl: sX.el, rules: RULE_PRESETS.strict.rules }), mbb, 3);
show('STANDARD: same order', D({ feeder: sX.feeder, workEl: sX.el, rules: RULE_PRESETS.standard.rules }), mbb, 3);
show('PERMISSIVE: same order', D({ feeder: sX.feeder, workEl: sX.el, rules: RULE_PRESETS.permissive.rules }), mbb, 3);
const sCap = secs.find((x: any) => x.feeder === 'CH-1220' && x.label.includes('S-1226') && x.label.includes('R-1225'))!;
show('STRICT: cap bank left on line', D({ feeder: sCap.feeder, workEl: sCap.el, rules: RULE_PRESETS.strict.rules }),
  [S('CB-1220', 'nr-on', false, 'SCADA'), S('CB-3110', 'nr-on', false, 'SCADA'), S('VR-3117', 'manual'), S('TS-13', 'close', true, 'SCADA'), S('S-1226', 'open', false, 'SCADA'), S('R-1225', 'open', false, 'SCADA'), S('D-1225B', 'open')], 6);

console.log('\n--- Live execution ---');
const v0 = e.s.metrics.violations.length;
e.devAction('VR-3117', 'manual', { by: '233' });
e.operate('BP-3117', 'close', { by: '233' });
console.log('BP-3117 closed with tap', e.s.dev['VR-3117'].tap, '->', e.s.metrics.violations.slice(v0).map((v: any) => v.text));
// Cap: de-energize the section with the bank on line, then re-energize 2 minutes later
const e2 = Engine.create('A', 1001) as any; e2.s.paused = false;
for (let i = 0; i < 40; i++) e2.tick(250);
console.log('CAP-1224 at start: open', e2.s.dev['CAP-1224'].open, 'ctl', e2.s.dev['CAP-1224'].ctl, 'hour', e2.hourOfDay().toFixed(2));
e2.operate('TS-13', 'close', { by: 'SCADA', loopOk: true }); e2.operate('S-1226', 'open', { by: 'SCADA' }); e2.operate('R-1225', 'open', { by: 'SCADA' });
for (let i = 0; i < 8; i++) e2.tick(250);
console.log('section dead, capDead', e2.s.dev['CAP-1224'].capDead !== null);
e2.s.speed = 10; for (let i = 0; i < 48; i++) e2.tick(250); // ~2 min
const v1 = e2.s.metrics.violations.length;
e2.operate('R-1225', 'close', { by: 'SCADA' });
for (let i = 0; i < 4; i++) e2.tick(250);
console.log('re-energized after ~2 min ->', e2.s.metrics.violations.slice(v1).map((v: any) => v.text));
