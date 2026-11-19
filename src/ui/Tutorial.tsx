// Tutorial coach panel — shown during scenario T. Highlights the exact control for each step.
import { useEffect } from 'react';
import { useCtx } from './ctx';
import type { Engine } from '../sim/engine';

interface Ctx { e: Engine; inc?: string; fz: string; truck: string; voice: boolean }
interface Step {
  title: string; body: string;
  /** Groups of data-tut keys; the first group with any element on screen is highlighted. */
  hl?: string[][];
  say?: (c: Ctx) => string;
  todo?: (c: Ctx) => string;
  done?: (c: Ctx) => boolean;
}
const obj = (c: Ctx, id: string) => c.e.s.scen.obj[id]?.status === 'pass';

const STEPS: Step[] = [
  { title: 'Welcome to your first shift', body: 'You are the system operator at Sparks Municipal Electric. Everything here is simulated, so nothing you do can hurt anyone. Yellow pulsing outlines show you exactly what to click.',
    hl: [['audio'], ['pause']], todo: () => 'Click the pulsing Enable audio button (top right) so you can hear the radio. Then press Next.' },
  { title: 'Read the map', body: 'The map shows the feeders in different colors. Solid lines have power; dark lines are dead. Circles and squares are devices (switches, breakers, reclosers, fuses).',
    hl: [['focus']], todo: () => 'Click any circle or square on the map to see its status in the Inspector. Map focus makes the map bigger.' },
  { title: 'Wait for the call', body: 'In about 45 seconds a customer will call in an outage. Calls roll up into an incident in the OMS panel.',
    hl: [['inc-row']], todo: c => c.inc ? 'An incident appeared. Click the highlighted row to select it.' : 'Waiting for the first call… (up to 45 seconds)', done: c => !!c.inc },
  { title: 'Dispatch a crew', body: 'Send the closest truck to the incident. You can click, or use your voice on the radio.',
    hl: [['unit-select', 'dispatch'], ['inc-row']], say: c => `Truck ${c.truck}, Sparks Control, respond to ${c.inc ?? 'the incident'}`,
    todo: c => `1) Click the incident row. 2) In "assign unit" pick Truck ${c.truck}. 3) ${c.voice ? 'Hold Space (or the HOLD TO TALK button) and say the phrase below.' : 'Click Dispatch.'}`, done: c => obj(c, 't1') },
  { title: 'Crew patrols and reports', body: 'The truck drives to the scene and reports what it found. Listen to the radio traffic; each truck has its own voice.',
    todo: () => 'Nothing to click. Wait for the crew to arrive and ask permission to close the fuse.', done: c => c.e.s.requests.some(r => r.type === 'close' && r.dev === c.fz) },
  { title: 'Permit the repair', body: 'The crew will not close anything until you say so. Answer their request.',
    hl: [['grant']], say: c => `Truck ${c.truck}, permission granted to close ${c.fz}`, todo: c => c.voice ? 'Hold Space (or the HOLD TO TALK button), say the phrase below, then let go.' : 'Click the pulsing Grant button in the Radio panel.', done: c => obj(c, 't2') },
  { title: 'Verify restoration', body: 'Check that customers are back. Watch SAIDI at the top: every minute of outage counts.',
    hl: [['verify'], ['inc-row']], todo: () => 'Click the incident, then click Verify & Close (it appears once customers are restored).', done: c => obj(c, 't3') },
  { title: 'Hot-line tag (non-reclose)', body: 'This stops a recloser from re-energizing a line while a crew works on it live. It is required for the rescue scenario.',
    hl: [['nr']], todo: () => 'Click any recloser on the map (R-numbers), click Non-reclose (hot-line tag) to turn it ON, then click it again to turn it OFF.', done: c => obj(c, 't4') },
  { title: 'Lockout and emergencies', body: 'LOCK OUT opens a device and holds it open with a tag so nobody can close it. In an emergency: declare emergency traffic, call 911, lock out the source, tell the crew the line is dead.',
    hl: [['lockout'], ['emg', '911']], say: () => 'All units, Sparks Control, emergency traffic only',
    todo: () => 'Just look for now: select a feeder breaker or recloser to see LOCK OUT; the Radio panel has Emergency traffic and ☎ 911. Do not click them unless you want to try.' },
  { title: 'You are ready', body: 'Finish the objectives, then press Finish tutorial. Next try Scenario A, then G (Rescue).', hl: [['finish']] },
];

export function TutorialCoach() {
  const { e, flash, voiceReq } = useCtx();
  const n = Math.min(e.s.scen.flags.tutStep ?? 0, STEPS.length - 1);
  const done = (e.s.scen.flags.tutStep ?? 0) >= 99;
  const st = STEPS[n];
  const fz: string = e.s.scen.flags.tutFuse;
  const incO = Object.values(e.s.incidents).find(i => i.truthDev === fz);
  const c: Ctx = { e, inc: incO?.id, fz, truck: '233', voice: !!voiceReq };
  const ok = !!st.done?.(c);
  const complete = (e.s.scen.flags.tutStep ?? 0) >= 99;
  const groupKey = JSON.stringify(st.hl) + (st.say ? 'p' : '') + ok;
  useEffect(() => {
    if (complete) return;
    const find = (k: string) => Array.from(document.querySelectorAll(`[data-tut="${k}"]`));
    const picked: Element[] = [];
    // The Next button pulses once the step is done; otherwise highlight the step's control.
    if (ok) picked.push(...find('next'));
    else {
      for (const g of st.hl ?? []) { const els = g.flatMap(find); if (els.length) { picked.push(...els); break; } }
      if (st.say) picked.push(...find('ptt'));
    }
    picked.forEach(x => x.classList.add('tut-hl'));
    return () => picked.forEach(x => x.classList.remove('tut-hl'));
  });
  void groupKey;
  if (done) return null;
  const last = n === STEPS.length - 1;
  return (
    <div className="coach">
      <div className="ch"><span className="badge cyan">TUTORIAL {n + 1}/{STEPS.length}</span><b>{st.title}</b></div>
      <div className="cb">{st.body}</div>
      {st.todo && <div className={`ctodo ${ok ? 'ok' : ''}`}>{ok ? '✔ Done! Press Next.' : '👉 ' + st.todo(c)}</div>}
      {st.say && !ok && <div className="csay"><span>🎤 SAY (hold Space):</span><b>“{st.say(c)}”</b></div>}
      <div className="cf">
        <button className="btn sm" disabled={n === 0} onClick={() => e.setTutStep(n - 1)}>Back</button>
        {last
          ? <button data-tut="finish" className="btn pri sm" onClick={() => { e.setTutStep(99); flash('Tutorial complete', 'good'); }}>Finish tutorial</button>
          : <button data-tut="next" className="btn pri sm" onClick={() => e.setTutStep(n + 1)}>Next</button>}
        <button className="btn sm" onClick={() => e.setTutStep(99)}>Skip tutorial</button>
      </div>
    </div>
  );
}

/** Tutorial-only mistake warning: what went wrong and how to fix it. */
export function TutorialWarn() {
  const { e } = useCtx();
  const w = e.s.scen.flags.coachWarn as { id: number; title: string; fix: string } | undefined;
  if (!w) return null;
  return (
    <div className="coachwarn" role="alert">
      <div className="ch"><span className="badge red">MISTAKE</span><b>{w.title}</b></div>
      <div className="cb"><b>How to fix it:</b> {w.fix}</div>
      <div className="cf"><button className="btn pri sm" onClick={() => e.dismissCoach()}>Got it</button></div>
    </div>
  );
}
