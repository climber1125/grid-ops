// MONITOR 4 — Radio / Communications console
import { useEffect, useRef, useState } from 'react';
import { useCtx } from './ctx';
import type { Request } from '../sim/types';
import { SayOr, PttBar, TypeTx, PhraseChips, CheatSheet } from './VoiceUi';

export function RadioPanel({ keyed, voiceOn, setVoiceOn, audioOn, talkBack, setTalkBack }: {
  keyed: string | null; voiceOn: boolean; setVoiceOn(v: boolean): void; audioOn: boolean; talkBack: boolean; setTalkBack(v: boolean): void;
}) {
  const { e, flash, setSel, setTab, ptt, voiceReq } = useCtx();
  const [unit, setUnit] = useState('');
  const [wf, setWf] = useState('');
  const [typing, setTyping] = useState(false);
  const [sheet, setSheet] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const msgs = e.s.radio.slice(-160);
  const lastId = msgs.at(-1)?.id ?? 0;
  const recent = msgs.at(-1) && e.s.t - msgs.at(-1)!.t < 3 ? msgs.at(-1)! : null;
  const lamp = ptt.active ? 'tx' : keyed ? (keyed === 'SPARKS CONTROL' ? 'tx' : 'rx') : recent ? (recent.from === 'SPARKS CONTROL' ? 'tx' : 'rx') : '';
  useEffect(() => { const b = box.current; if (b && stick.current) b.scrollTop = b.scrollHeight; }, [lastId]);
  const pend = e.s.requests.filter(r => r.status === 'Pending');
  const trucks = Object.values(e.s.trucks);
  const run = (err: string | null | undefined) => { if (err) flash(err, 'warn'); };
  const F = e.s.scen.flags;
  const emergency = F.emT !== undefined && F.confT === undefined;

  const reqActions = (r: Request) => {
    const u = r.truck === '249' ? 'Supervisor 249' : `Truck ${r.truck}`;
    switch (r.type) {
      case 'close': return <><SayOr phrase={`${u}, permission granted to close ${r.dev}`}><button className="btn good sm" onClick={() => run(e.approve(r.id))}>Grant</button></SayOr><SayOr phrase={`${u}, hold, stand by`}><button className="btn sm" onClick={() => run(e.deny(r.id))}>Hold</button></SayOr></>;
      case 'clearance': return <><SayOr phrase={`${u}, clearance is issued on that section`}><button className="btn warn sm" onClick={() => run(e.approve(r.id))}>Issue clearance</button></SayOr><SayOr phrase={`${u}, unable, stand by`}><button className="btn sm" onClick={() => run(e.deny(r.id))}>Defer</button></SayOr></>;
      case 'release': return <SayOr phrase={`${u}, copy, clearance released`}><button className="btn good sm" onClick={() => run(e.approve(r.id))}>Acknowledge release</button></SayOr>;
      case 'hotline': return <><SayOr phrase={`${u}, hot-line tag is on ${r.dev}, you're clear for energized work`}><button className="btn warn sm" onClick={() => run(e.approve(r.id))}>Confirm hot-line tag</button></SayOr><SayOr phrase={`${u}, stand by`}><button className="btn sm" onClick={() => run(e.deny(r.id))}>Hold</button></SayOr></>;
      case 'pressure': return <><SayOr phrase="249, copy, will close it"><button className="btn danger sm" onClick={() => run(e.approve(r.id))}>Close it</button></SayOr><SayOr phrase="249, negative, that section stays de-energized"><button className="btn sm" onClick={() => run(e.deny(r.id))}>Refuse</button></SayOr></>;
    }
  };

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="ph">
        <span className="mon">M4</span><span className="ttl">Radio</span>
        <span className="sp" />
        <label className="aa" title="Speak crew radio traffic aloud">
          <input type="checkbox" checked={voiceOn} onChange={ev => setVoiceOn(ev.target.checked)} disabled={!audioOn} /> Crew voices
        </label>
        <label className="aa" title="Talk to crews with your own voice (push-to-talk). Radio buttons become phrases to say.">
          <input type="checkbox" checked={talkBack} onChange={ev => setTalkBack(ev.target.checked)} /> Talk-back
        </label>
      </div>
      <div className="radio-head">
        <span className={`lamp ${lamp === 'tx' ? 'tx' : ''}`} title="TX" /><span className="dim" style={{ fontSize: 10 }}>TX</span>
        <span className={`lamp ${lamp === 'rx' ? 'rx' : ''}`} title="RX" /><span className="dim" style={{ fontSize: 10 }}>RX</span>
        <span className="chan">OPS-1{F.emergencyTraffic ? <span className="badge red" style={{ marginLeft: 6 }}>EMERGENCY TRAFFIC</span> : ''}</span>
        <span style={{ flex: 1 }} />
        <SayOr phrase="All units, Sparks Control, emergency traffic only"><button className="btn danger sm" onClick={() => run(e.declareEmergency())}>Emergency traffic</button></SayOr>
        <button className="btn danger sm" title="Phone: call 911 and request EMS / fire / police" onClick={() => { run(e.notify911()); flash('911 called — EMS requested', 'alarm'); }}>☎ 911</button>
      </div>
      {emergency && (
        <div className="req emergency">
          <div className="rt"><b>EMERGENCY</b> — crew needs the line confirmed dead before rescue. Lock out the source, then tell them.</div>
          <SayOr phrase="Truck 233, R-2125 is open and locked out, the line is dead"><button className="btn danger sm" onClick={() => run(e.confirmDead())}>Confirm line dead</button></SayOr>
        </div>
      )}
      {pend.length > 0 && (
        <div className="reqs">
          {pend.map(r => (
            <div key={r.id} className={`req ${r.type}`}>
              <div className="rt"><b>{r.truck === '249' ? 'SUP 249' : `TRUCK ${r.truck}`}</b> <span className="mono dim">{e.hhmm(r.t)}</span> — {r.text}
                {r.type === 'clearance' && <div className="dim" style={{ fontSize: 10 }}>Issuing applies HOLD tags to all isolation points. The engine verifies they are open and the section is dead.</div>}
                {r.type === 'hotline' && <div className="dim" style={{ fontSize: 10 }}>Turn on non-reclose for {r.dev} first (select it → “Non-reclose (hot-line tag)”), then confirm.</div>}
              </div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                {reqActions(r)}
                {r.dev && r.type === 'hotline' && <button className="btn sm" onClick={() => setSel({ kind: 'dev', id: r.dev! })}>{r.dev}</button>}
                {r.inc && <button className="btn sm" onClick={() => setSel({ kind: 'inc', id: r.inc! })}>Inc</button>}
                {r.type === 'clearance' && <button className="btn sm" onClick={() => setTab('sw')}>Orders</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="transcript" ref={box} onScroll={ev => { const b = ev.currentTarget; stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 30; }}>
        {msgs.length === 0 && <div className="empty">Channel quiet.</div>}
        {msgs.map(m => (
          <div key={m.id} className={`tx-line ${m.from === 'SPARKS CONTROL' ? 'ctl' : ''} ${m.kind} ${e.s.t - m.t < 2 ? 'new' : ''}`}>
            <span className="tt">{e.hhmmss(m.t).slice(0, 8)}</span>
            <span className="who">{m.kind === 'operator' ? 'YOU (CONTROL)' : m.from}</span>
            <span className="msg">{m.text}</span>
          </div>
        ))}
      </div>
      {talkBack && unit && <PhraseChips unit={unit} />}
      {talkBack && <PttBar />}
      {talkBack && (typing || !ptt.supported) && <TypeTx />}
      <div className="unitbar">
        <span className="dim" style={{ fontSize: 10 }}>UNIT</span>
        {trucks.map(t => <button key={t.id} className={`btn sm ${unit === t.id ? 'on' : ''}`} style={!t.comm ? { borderColor: 'var(--red)', color: '#ff9b9b' } : undefined} onClick={() => setUnit(unit === t.id ? '' : t.id)}>{t.id}</button>)}
        {unit && <>
          <span style={{ width: 6 }} />
          <SayOr phrase={`Truck ${unit}, status?`}><button className="btn sm" onClick={() => e.statusCheck(unit)}>Status check</button></SayOr>
          <button className="btn sm" onClick={() => e.cellCall(unit)}>Cell</button>
          {!voiceReq && <button className="btn sm" onClick={() => run(e.recall(unit))}>Recall</button>}
          <button className="btn sm" onClick={() => setSel({ kind: 'truck', id: unit })}>Details</button>
          {!e.s.trucks[unit]?.comm && <>
            <select value={wf} onChange={ev => setWf(ev.target.value)} style={{ fontSize: 10 }}>
              <option value="">welfare by…</option>
              {trucks.filter(t => t.id !== unit && t.comm).map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
            </select>
            <SayOr phrase={`Truck ${wf || '###'}, check on Truck ${unit}`}><button className="btn warn sm" disabled={!wf} onClick={() => run(e.welfareCheck(wf, unit))}>Send welfare check</button></SayOr>
          </>}
        </>}
        <span style={{ flex: 1 }} />
        {talkBack && <button className="btn sm" onClick={() => setSheet(true)}>Phrases</button>}
        {talkBack && ptt.supported && <button className="btn sm" onClick={() => setTyping(!typing)}>{typing ? 'Hide keyboard' : 'Type instead'}</button>}
      </div>
      {sheet && <CheatSheet onClose={() => setSheet(false)} />}
    </div>
  );
}
