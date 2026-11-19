import { Engine } from '../src/sim/engine';
function run(id: string) {
  const e = Engine.create(id, 1) as any;
  for (let i = 0; i < 60; i++) e.tick?.(1);
  // trigger a clearance-release violation path directly
  e.violation('clearance-release', 'test');
  e.violation('tag', 'test');
  return e.s.scen.flags.coachWarn;
}
const t = run('T'), a = run('A');
console.log('T warn:', t?.title);
console.log('A warn:', a);
if (!t || a) { console.error('FAIL'); process.exit(1); }
const e = Engine.create('T', 1) as any; e.violation('tag','x'); e.dismissCoach();
if (e.s.scen.flags.coachWarn) { console.error('FAIL dismiss'); process.exit(1); }
console.log('PASS');
