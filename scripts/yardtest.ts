// Yard editor model: apply an edited yard BEFORE the network is built, then check the network.
import { defaultYardDoc, applyYardDoc, checkYardDoc, YARD_FEEDERS, YARD_TIES, JOB_POLES, ALL_POLES } from '../src/sim/texasYard';
let bad = 0; const ok = (l: string, c: boolean) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) bad++; };
const d = defaultYardDoc();
ok('built-in yard is valid', checkYardDoc(d).length === 0);
// edits: new line pole L37 off L22 with a switch, a new work pole, delete a work pole, job tag toggle, new load
d.poles.L37 = { xy: [300, 290], area: 'LINE' };
d.links.push({ a: 'L22', b: 'L37', dev: { type: 'switch', id: 'S-4140', at: 'L37' } });
d.loads.L37 = { name: 'NEW CLASSROOM', kw: 30 };
d.poles['A1-21'] = { xy: [100, 300], area: 'A1', job: true };
delete d.poles['A2-20'];
d.poles['A1-03'].job = false;
ok('edited yard is valid', checkYardDoc(d).length === 0);
const bad1 = JSON.parse(JSON.stringify(d)); bad1.links.push({ a: 'L1', b: 'A1-01' });
ok('span to a work pole rejected', checkYardDoc(bad1).length > 0);
ok('apply', applyYardDoc(d));
ok('L37 fed from TX-4110 with S-4140', YARD_FEEDERS[0].spans.some(s => s[1] === 'L37') && YARD_FEEDERS[0].devs.L37?.id === 'S-4140');
ok('ties still there', YARD_TIES.map(t => t.id).sort().join() === 'TS-4119,TS-4129');
ok('job poles updated', JOB_POLES.includes('A1-21') && !JOB_POLES.includes('A1-03'));
ok('pole list updated', !!ALL_POLES['A1-21'] && !ALL_POLES['A2-20']);
const { TOPO } = await import('../src/sim/topology');
ok('network has S-4140', !!TOPO.els['S-4140']);
ok('network has NEW CLASSROOM load', TOPO.loadIds.some(l => TOPO.loads[l].name === 'NEW CLASSROOM'));
const { Engine } = await import('../src/sim/engine');
const e = Engine.create('Z', 7) as any;
ok('NEW CLASSROOM on at start', e.loadEn(TOPO.loadIds.find(l => TOPO.loads[l].name === 'NEW CLASSROOM')!));
e.operate('S-4140', 'open', { by: 'TEST' });
ok('opening S-4140 drops it', !e.loadEn(TOPO.loadIds.find(l => TOPO.loads[l].name === 'NEW CLASSROOM')!));
console.log(bad ? `${bad} FAILED` : 'ALL PASS'); process.exit(bad ? 1 : 0);
