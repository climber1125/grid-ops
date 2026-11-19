import { Engine } from '../src/sim/engine';
import { parseRadio } from '../src/sim/voice';
const e = Engine.create('A', 1001); e.s.paused = false; e.s.scen.flags.noRoutine = true;
for (let i = 0; i < 40; i++) e.tick(250);
const u = Object.keys(e.s.trucks)[0];
const kd = (id: string) => !!e.T.els[id];
for (const t of ['230 ten twenty', '230 10-20', '230, 10.20', '230 ten four', '230 ten dash twenty', 'truck 230 ten code nineteen', 'switch ten twenty', 'work order 1020 for 230', '230 go to ten minutes out', '230 ten ninety seven', 'ten thirty six 230'])
  console.log(JSON.stringify(t), '→', JSON.stringify(parseRadio(t, Object.keys(e.s.trucks), kd).codes), parseRadio(t, Object.keys(e.s.trucks), kd).units);
for (const phrase of [`${u} 10-20`, `${u} ten four`, `${u} ten thirty six`, `${u} ten twelve`, `${u} ten twenty one`, `${u} ten fifty`, `${u} ten nineteen`]) {
  const b = e.s.radio.length; const r = e.voiceTx(phrase); for (let i = 0; i < 60; i++) e.tick(250);
  console.log(phrase, '| err:', r, '|', e.s.radio.slice(b).filter(m => m.kind !== 'operator').map(m => m.text.slice(0, 70)));
}
