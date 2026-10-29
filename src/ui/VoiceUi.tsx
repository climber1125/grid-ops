// Voice-radio helpers: when talk-back is on, radio actions are spoken —
// buttons are replaced by the phrase to say, so the operator learns the
// phraseology. SCADA and phone actions stay as buttons.
import type { ReactNode } from 'react';
import { useCtx } from './ctx';

export function SayOr({ phrase, children }: { phrase: string; children: ReactNode }) {
  const { voiceReq } = useCtx();
  if (!voiceReq) return <>{children}</>;
  return <span className="say" title="Voice radio is on: hold Space (or the TALK button) and say this">🎙 “{phrase}”</span>;
}

export function PttBar() {
  const { ptt, voiceReq, e } = useCtx();
  if (!ptt.supported && !voiceReq) return null;
  return (
    <div className={`pttbar ${ptt.active ? 'live' : ''}`}>
      {ptt.supported ? (
        <button
          className={`btn ptt ${ptt.active ? 'on' : ''}`}
          onPointerDown={ev => { ev.preventDefault(); ptt.start(); }}
          onPointerUp={() => ptt.stop()}
          onPointerLeave={() => { if (ptt.active) ptt.stop(); }}
        >{ptt.active ? '● TRANSMITTING' : 'HOLD TO TALK'}</button>
      ) : null}
      <div className="pttline">
        {ptt.active ? <span className="interim">{ptt.interim || 'Listening…'}</span>
          : ptt.error ? <span className="c-red">{ptt.error}</span>
          : <span className="dim">Hold <b>Space</b> or the button and talk. Start with the unit: “Truck {Object.keys(e.s.trucks)[0] ?? '233'}, Sparks Control…”</span>}
      </div>
    </div>
  );
}

export function TypeTx() {
  const { ptt } = useCtx();
  return (
    <form className="typetx" onSubmit={ev => { ev.preventDefault(); const f = ev.currentTarget; const i = f.elements.namedItem('tx') as HTMLInputElement; if (i.value.trim()) { ptt.send(i.value); i.value = ''; } }}>
      <input name="tx" placeholder="Type a transmission (no mic): Truck 233, respond to INC-4102" autoComplete="off" />
      <button className="btn sm" type="submit">Send</button>
    </form>
  );
}
