// Switching exercises: reference orders pass the checker on every section under every rule preset,
// equipment bypasses work, and full exercises run end to end.
import { Engine } from '../src/sim/engine';
import { listSections, listBypassable, referenceOrder, checkOrder, buildReport, encodeExercise, decodeExercise, stepText, RULE_PRESETS, type ExerciseDef } from '../src/sim/exercise';
const e0 = Engine.create('A', 1001);
const secs = listSections(e0.T), eq = listBypassable(e0.T);
console.log('sections', secs.length, 'bypassable', eq.map(x => x.id).join(' '));
let bad = 0;
for (const [pk, p] of Object.entries(RULE_PRESETS)) {
  const defs: ExerciseDef[] = [
    ...secs.map(s => ({ v: 1, id: 'EX-T', title: 't', kind: 'isolate', feeder: s.feeder, workEl: s.el, work: 'w', truck: '233', minutes: 10, coach: true, by: 'instructor', rules: p.rules } as ExerciseDef)),
    ...eq.map(x => ({ v: 1, id: 'EX-B', title: 'b', kind: 'bypass', feeder: x.feeder, workEl: x.id, work: 'w', truck: '233', minutes: 10, coach: true, by: 'instructor', rules: p.rules } as ExerciseDef)),
  ];
  let pb = 0;
  for (const def of defs) {
    const ref = referenceOrder(e0, def);
    const c = checkOrder(e0, def, ref.steps, ref.holdAfter);
    if (c.verdict !== 'pass') { pb++; console.log(`FAIL [${pk}]`, def.kind, def.workEl, def.feeder); for (const f of c.findings.filter(f => f.level === 'fail')) console.log('   ', f.text); }
  }
  bad += pb; console.log(`preset ${pk}: ${defs.length - pb}/${defs.length} reference orders pass`);
}
console.log('reference orders failing check:', bad);

function run(def: ExerciseDef, label: string) {
  const e = Engine.create('X', 4242, { exercise: def, student: 'Test Student' }) as any;
  e.s.scen.flags.noRandomErrors = true; e.s.paused = false; e.s.speed = 10;
  const ref = referenceOrder(e, def);
  console.log(`\n== ${label}`); ref.steps.forEach((x, i) => console.log(`  ${i + 1}. ${stepText(e, x)}${i === ref.holdAfter ? '   <-- HOLD' : ''}`));
  const o = e.newOrder(label, ref.steps);
  e.setHold(o.id, ref.holdAfter);
  e.exSubmit(o.id);
  console.log('  check at submit:', e.s.scen.flags.ex.submissions[0].check.verdict, '| activate:', e.activateOrder(o.id) ?? 'ok');
  let guard = 0;
  while (guard++ < 4 * 60 * 300 && !e.s.scen.flags.ex.finished) {
    e.tick(250);
    const st = o.steps[o.cur];
    const clr = Object.values(e.s.clearances)[0] as any;
    if (o.status === 'Active' && st) {
      if (st.status === 'Pending' && (o.cur <= ref.holdAfter || clr?.status === 'Released')) e.issueStep(o.id);
      if (st.status === 'RepeatBack') e.confirmRepeat(o.id, st.rbDev === st.dev && st.rbAction === st.action);
      if (st.status === 'Failed') { console.log('  STEP FAILED', o.cur + 1, st.note); break; }
    }
    for (const r of e.s.requests) if (r.status === 'Pending') e.approve(r.id);
  }
  const rep = buildReport(e)!;
  console.log('  finished', e.s.scen.flags.ex.finished, '| sim min', rep.simMinutes, '| verdict', rep.verdict, '| outside hit', rep.unplanned.customers);
  console.log('  outcome', JSON.stringify(rep.outcome));
  if (rep.violations.length) console.log('  violations', rep.violations.map(v => v.text));
  const radio = e.s.radio.filter((m: any) => /discharge|neutral/i.test(m.text)).map((m: any) => `${m.from}: ${m.text}`);
  if (radio.length) console.log('  radio:', radio.slice(0, 3).join(' || '));
  return rep;
}
const sCap = secs.find(x => x.feeder === 'CH-1220' && x.label.includes('S-1226') && x.label.includes('R-1225'))!;
const sReg = secs.find(x => x.feeder === 'BS-3110' && x.label.includes('S-3116') && x.label.includes('S-3118'))!;
const sX = secs.find(x => x.label.startsWith('BS-3120: between S-3122 and CB-3120'))!;
const D = (o: Partial<ExerciseDef>): ExerciseDef => ({ v: 1, id: 'EX-1', title: 't', kind: 'isolate', feeder: '', workEl: '', work: 'Replace broken crossarm', truck: '233', minutes: 10, coach: false, by: 'instructor', ...o } as ExerciseDef);
const code = encodeExercise(D({ feeder: sX.feeder, workEl: sX.el }));
console.log('\ncode roundtrip', JSON.stringify(decodeExercise(code)) === JSON.stringify(D({ feeder: sX.feeder, workEl: sX.el })));
run(D({ feeder: sCap.feeder, workEl: sCap.el, rules: RULE_PRESETS.standard.rules }), `Isolate section with cap bank (${sCap.label})`);
run(D({ feeder: sReg.feeder, workEl: sReg.el, rules: RULE_PRESETS.standard.rules }), `Isolate section containing the regulator (${sReg.label})`);
run(D({ feeder: sX.feeder, workEl: sX.el, rules: RULE_PRESETS.strict.rules }), `STRICT rules, cross-sub tie (${sX.label})`);
run(D({ kind: 'bypass', feeder: 'BS-3110', workEl: 'VR-3117', work: 'Regulator maintenance' }), 'Bypass regulator VR-3117');
run(D({ kind: 'bypass', feeder: 'CH-1210', workEl: 'R-1215', work: 'Recloser change-out' }), 'Bypass recloser R-1215');
