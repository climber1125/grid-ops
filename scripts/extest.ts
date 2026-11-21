// Switching exercise: reference orders pass the checker on every section; a full exercise runs end to end.
import { Engine } from '../src/sim/engine';
import { listSections, referenceOrder, checkOrder, buildReport, encodeExercise, decodeExercise, stepText, type ExerciseDef } from '../src/sim/exercise';
const e0 = Engine.create('A', 1001);
const secs = listSections(e0.T);
console.log('sections', secs.length);
let bad = 0;
for (const s of secs) {
  const def: ExerciseDef = { v: 1, id: 'EX-T', title: 't', feeder: s.feeder, workEl: s.el, work: 'Replace crossarm', truck: '233', minutes: 10, coach: true, by: 'instructor' };
  const ref = referenceOrder(e0, def);
  const c = checkOrder(e0, def, ref.steps, ref.holdAfter);
  if (c.verdict !== 'pass') { bad++; console.log('FAIL', s.label); for (const f of c.findings.filter(f => f.level !== 'pass')) console.log('   ', f.level, f.text); console.log('   ref:', ref.steps.map(x => `${x.action} ${x.dev}${x.loop ? 'L' : ''}`).join(', ')); }
}
console.log('reference orders failing check:', bad);

// Full run
const s = secs.find(x => x.label.startsWith('BS-3120') && x.customers > 40)!;
const def: ExerciseDef = { v: 1, id: 'EX-1', title: 'Crossarm', feeder: s.feeder, workEl: s.el, work: 'Replace broken crossarm', truck: '233', minutes: 10, coach: false, by: 'instructor' };
const code = encodeExercise(def); console.log('code length', code.length, 'roundtrip', JSON.stringify(decodeExercise(code)) === JSON.stringify(def));
const e = Engine.create('X', 4242, { exercise: def, student: 'Test Student' }) as any;
e.s.scen.flags.noRandomErrors = true; e.s.paused = false; e.s.speed = 10;
const ref = referenceOrder(e, def);
console.log('section', s.label); console.log('reference:'); ref.steps.forEach((x, i) => console.log(`  ${i + 1}. ${stepText(e, x)}${i === ref.holdAfter ? '   <-- HOLD' : ''}`));
const o = e.newOrder('Isolation for crossarm', ref.steps);
console.log('activate before submit:', e.activateOrder(o.id));
e.setHold(o.id, ref.holdAfter);
console.log('submit:', e.exSubmit(o.id), 'check:', e.s.scen.flags.ex.submissions[0].check.verdict);
console.log('activate:', e.activateOrder(o.id));
let guard = 0;
while (guard++ < 4 * 60 * 240 && !e.s.scen.flags.ex.finished) {
  e.tick(250);
  const st = o.steps[o.cur];
  const clr = Object.values(e.s.clearances)[0] as any;
  if (o.status === 'Active' && st) {
    const pastHold = o.cur > ref.holdAfter;
    if ((st.status === 'Pending') && (!pastHold || clr?.status === 'Released')) e.issueStep(o.id);
    if (st.status === 'RepeatBack') e.confirmRepeat(o.id, st.rbDev === st.dev && st.rbAction === st.action);
  }
  for (const r of e.s.requests) if (r.status === 'Pending') e.approve(r.id);
}
const rep = buildReport(e)!;
console.log('finished', e.s.scen.flags.ex.finished, 'sim min', rep.simMinutes, 'verdict', rep.verdict);
console.log('outcome', JSON.stringify(rep.outcome));
console.log('objectives', rep.objectives.map(x => `${x.status}`).join(' '));
console.log('violations', rep.violations);
console.log('step logs, step 1:', o.steps[0].log?.map((l: any) => l.ev).join(' | '));
console.log('report bytes', JSON.stringify(rep).length);
