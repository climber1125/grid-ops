import { Engine } from '../src/sim/engine';
const e = Engine.create('A', 1001); e.s.paused = false; e.s.scen.flags.noRoutine = true;
for (let i = 0; i < 40; i++) e.tick(250);
const u = Object.keys(e.s.trucks)[0];
for (const ph of ['understood', 'copy', '10.4', 'where are you at', 'status report', 'what is your twenty', '10.20', 'call my phone', 'give me a call', 'call me on my cell', '10.21', 'return to the service center', 'head back to the shop', '10.19', 'standby', 'stand by', '10.12', 'ten four']) {
  const b = e.s.radio.length; const r = e.voiceTx(`${u} ${ph}`); for (let i = 0; i < 60; i++) e.tick(250);
  console.log(ph.padEnd(30), '| err:', r, '|', e.s.radio.slice(b).filter(m => m.kind !== 'operator').map(m => m.text.slice(0, 60)).join(' / '));
}
