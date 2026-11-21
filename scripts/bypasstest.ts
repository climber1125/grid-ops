// Recloser bypass and load-break rules.
import { Engine } from '../src/sim/engine';
const e = Engine.create('A', 1001) as any; e.s.scen.flags.noRandomErrors = true;
const op = (id: string, a: 'open' | 'close', loopOk = false) => { const v = e.s.metrics.violations.length; const r = e.operate(id, a, { by: 'SCADA_TEST', loopOk }); const nv = e.s.metrics.violations.slice(v).map((x: any) => x.text); const dec = e.s.metrics.decisions.at(-1)?.text; return `${a} ${id}: ${r.ok ? 'ok' : r.reason}${nv.length ? '  VIOLATION: ' + nv.join('; ') : ''}`; };
console.log('-- correct bypass of R-1215');
console.log(op('BP-1215', 'close')); console.log('loops', e.net.loops.length);
console.log(op('R-1215', 'open')); console.log(op('D-1215A', 'open')); console.log(op('D-1215B', 'open'));
console.log('customers out', e.T.loadIds.filter((l: string) => !e.net.en.has(e.T.loads[l].node)).length);
console.log('-- return to normal');
console.log(op('D-1215B', 'close')); console.log(op('D-1215A', 'close')); console.log(op('R-1215', 'close')); console.log(op('BP-1215', 'open'));
console.log('-- mistakes');
console.log(op('D-1225A', 'open'));
console.log(op('D-1225A', 'close'));
console.log(op('R-2125', 'open')); console.log(op('BP-2125', 'close'));
