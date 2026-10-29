// Headless test: rescue scenario, operator lockout / non-reclose, and voice-radio command handling.
import { Engine } from '../src/sim/engine';
const run = (e: Engine, secs: number) => { for (let i = 0; i < secs * 2; i++) e.advance(0.5); };
const until = (e: Engine, pred: () => boolean, max = 7200, label = '') => { let t = 0; while (!pred() && t < max) { e.advance(1); t++; } if (!pred()) throw new Error('timeout ' + label); };
const lastRadio = (e: Engine, n = 3) => e.s.radio.slice(-n).map(m => `${m.from}: ${m.text}`).join('\n    ');
const say = (e: Engine, text: string) => { const r = e.voiceTx(text); run(e, 12); console.log(`  OP> "${text}"${r ? '  [' + r + ']' : ''}\n    ${lastRadio(e, 2)}`); };

// ── Rescue, done right, by voice
{
  const e = Engine.create('G', 11);
  e.setVoiceRadio(true);
  run(e, 30);
  console.log('[G-good] pending:', e.s.requests.filter(r => r.status === 'Pending').map(r => r.type + ' ' + r.truck));
  console.log('  NR on:', e.setNonReclose('R-2125', true));
  say(e, 'Truck two thirty three, Sparks Control, hot line tag is on recloser twenty one twenty five, you are clear for energized work');
  until(e, () => e.s.scen.flags.emT !== undefined, 600, 'mayday');
  run(e, 15);
  console.log('  R-2125 after contact:', JSON.stringify({ open: e.s.dev['R-2125'].open, lo: e.s.dev['R-2125'].lockout, ops: e.s.dev['R-2125'].ops }));
  console.log('  lockout:', e.lockoutDevice('R-2125'));
  console.log('  911:', e.notify911());
  say(e, 'All units, Sparks Control, emergency traffic only');
  const inc = Object.values(e.s.incidents).find(i => i.truthDev === 'R-2125')!;
  say(e, `Truck 238, respond to incident ${inc.id.slice(4).split('').join(' ')}`);
  say(e, 'Truck 233, R 2125 is open and locked out, the line is dead');
  until(e, () => !!e.s.requests.find(r => r.type === 'close' && r.dev === 'R-2125' && r.status === 'Pending'), 7200, 'restore req');
  console.log('  close while locked:', e.approve(e.s.requests.find(r => r.type === 'close' && r.dev === 'R-2125' && r.status === 'Pending')!.id));
  console.log('  release lockout:', e.releaseLockout('R-2125'));
  say(e, 'Truck 238, Sparks Control, permission granted to close R 2125');
  run(e, 120);
  console.log('  obj', JSON.stringify(e.s.scen.obj), 'violations', e.s.metrics.violations.map(v => v.code), 'out', e.customersOut());
}

// ── Rescue, done wrong (no non-reclose)
{
  const e = Engine.create('G', 12);
  run(e, 30);
  e.approve(e.s.requests.find(r => r.type === 'hotline')!.id);
  until(e, () => e.s.scen.flags.emT !== undefined, 600, 'mayday');
  run(e, 25);
  console.log('\n[G-bad] R-2125 ops', e.s.dev['R-2125'].ops, 'violations', e.s.metrics.violations.map(v => v.code), 'g1', e.s.scen.obj.g1.status);
}

// ── Voice radio on a normal outage (tutorial scenario)
{
  const e = Engine.create('T', 3);
  e.setVoiceRadio(true);
  until(e, () => e.openIncidents().length > 0, 600, 'outage');
  run(e, 30);
  const inc = e.openIncidents()[0];
  console.log('\n[T] incident', inc.id, inc.predDev, e.dev(inc.predDev).loc);
  say(e, 'Truck 233, Sparks Control');
  say(e, `respond to the outage at ${e.dev(inc.predDev).loc}`);
  say(e, 'Truck 230 open switch twenty one fourteen');
  say(e, 'Truck 233 what is your status');
  say(e, 'blah blah weather is nice');
  until(e, () => !!e.s.requests.find(r => r.type === 'close' && r.status === 'Pending'), 7200, 'close req');
  say(e, 'Truck 233, Sparks Control, permission granted to close');
  until(e, () => e.s.incidents[inc.id].status === 'Restored', 1200, 'restored');
  console.log('  verify', e.verifyIncident(inc.id), 'NR', e.setNonReclose('R-2118', true), e.setNonReclose('R-2118', false));
  e.setTutStep(99); run(e, 5);
  console.log('  obj', JSON.stringify(e.s.scen.obj), 'done', e.s.scen.done);
}

// ── Voice switching with repeat-back (scenario D)
{
  const e = Engine.create('D', 5);
  e.setVoiceRadio(true);
  run(e, 20);
  const oid = e.s.scen.flags.order; e.activateOrder(oid);
  console.log('\n[D] voice switching');
  say(e, 'Truck 230, Sparks Control, switching order step one, close tie switch fourteen, loop close');
  say(e, "that's correct, perform");
  until(e, () => e.s.orders[oid].cur === 1, 900, 'step1');
  say(e, 'Truck 230 step two open switch thirty one twenty six');
  console.log('  repeat-back was:', e.s.orders[oid].steps[1].rbAction, e.s.orders[oid].steps[1].rbDev);
  say(e, 'negative, step two open switch thirty one twenty six');
  say(e, 'correct');
  until(e, () => e.s.orders[oid].cur === 2, 900, 'step2');
  console.log('  caught wrong repeat:', e.s.scen.flags.caughtRepeat, 'step2 done', e.s.orders[oid].steps[1].status);
}
