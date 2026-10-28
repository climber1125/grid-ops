// MONITOR 4 — Radio / Communications console
import { useEffect, useRef, useState } from 'react';
import { useCtx } from './ctx';
import type { Request } from '../sim/types';

export function RadioPanel({ keyed, voiceOn, setVoiceOn, audioOn }: { keyed: string | null; voiceOn: boolean; setVoiceOn(v: boolean): void; audioOn: boolean }) {
  const { e, flash, setSel, setTab } = useCtx();
  const [unit, setUnit] = useState('');
  const [wf, setWf] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const msgs = e.s.radio.slice(-160);
  const lastId = msgs.at(-1)?.id ?? 0;
  const recent = msgs.at(-1) && e.s.t - msgs.at(-1)!.t < 3 ? msgs.at(-1)! : null;
  const lamp = keyed ? (keyed === 'SPARKS CONTROL' ? 'tx' : 'rx') : recent ? (recent.from === 'SPARKS CONTROL' ? 'tx' : 'rx') : '';
  useEffect(() => { const b = box.current; if (b && stick.current) b.scrollTop = b.scrollHeight; }, [lastId]);
  const pend = e.s.requests.filter(r => r.status === 'Pending');
  const trucks = Object.values(e.s.trucks);
  const run = (err: string | null | undefined) => { if (err) flash(err, 'warn'); };

  const reqActions = (r: Request) => {
    switch (r.type) {
      case 'close': return <><button className="btn good sm" onClick={() => run(e.approve(r.id))}>Grant</button><button className="btn sm" onClick={() => run(e.deny(r.id))}>Hold</button></>;
      case 'clearance': return <><button className="btn warn sm" onClick={() => run(e.approve(r.id))}>Issue clearance</button><button className="btn sm" onClick={() => run(e.deny(r.id))}>Defer</button></>;
      case 'release': return <button className="btn good sm" onClick={() => run(e.approve(r.id))}>Acknowledge release</button>;
      case 'pressure': return <><button className="btn danger sm" onClick={() => run(e.approve(r.id))}>Close it</button><button className="btn sm" onClick={() => run(e.deny(r.id))}>Refuse</button></>;
    }
  };

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="ph">
        <span className="mon">M4</span><span className="ttl">Radio / Communications</span>
        <span className="sp" />
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 10, color: 'var(--text2)' }}>
          <input type="checkbox" checked={voiceOn} onChange={ev => setVoiceOn(ev.target.checked)} disabled={!audioOn} /> Voice
        </label>
      </div>
      <div className="radio-head">
        <span className={`lamp ${lamp === 'tx' ? 'tx' : ''}`} title="TX" /><span className="dim" style={{ fontSize: 10 }}>TX</span>
        <span className={`lamp ${lamp === 'rx' ? 'rx' : ''}`} title="RX" /><span className="dim" style={{ fontSize: 10 }}>RX</span>
        <span className="chan">OPS-1 DISTRIBUTION DISPATCH</span>
        <span style={{ flex: 1 }} />
        <span className="mono dim" style={{ fontSize: 10 }}>{keyed ? `▶ ${keyed}` : ''}</span>
      </div>
      {pend.length > 0 && (
        <div className="reqs">
          {pend.map(r => (
            <div key={r.id} className={`req ${r.type}`}>
              <div className="rt"><b>{r.truck === '249' ? 'SUP 249' : `TRUCK ${r.truck}`}</b> <span className="mono dim">{e.hhmm(r.t)}</span> — {r.text}
                {r.type === 'clearance' && <div className="dim" style={{ fontSize: 10 }}>Issuing applies HOLD tags to all isolation points. The engine verifies they are open and the section is dead.</div>}
              </div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {reqActions(r)}
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
            <span className="who">{m.from}</span>
            <span className="msg">{m.text}</span>
          </div>
        ))}
      </div>
      <div className="unitbar">
        <span className="dim" style={{ fontSize: 10 }}>UNIT</span>
        {trucks.map(t => <button key={t.id} className={`btn sm ${unit === t.id ? 'on' : ''}`} style={!t.comm ? { borderColor: 'var(--red)', color: '#ff9b9b' } : undefined} onClick={() => setUnit(unit === t.id ? '' : t.id)}>{t.id}</button>)}
        {unit && <>
          <span style={{ width: 6 }} />
          <button className="btn sm" onClick={() => e.statusCheck(unit)}>Status check</button>
          <button className="btn sm" onClick={() => e.cellCall(unit)}>Cell</button>
          <button className="btn sm" onClick={() => run(e.recall(unit))}>Recall</button>
          <button className="btn sm" onClick={() => setSel({ kind: 'truck', id: unit })}>Details</button>
          {!e.s.trucks[unit]?.comm && <>
            <select value={wf} onChange={ev => setWf(ev.target.value)} style={{ fontSize: 10 }}>
              <option value="">welfare by…</option>
              {trucks.filter(t => t.id !== unit && t.comm).map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
            </select>
            <button className="btn warn sm" disabled={!wf} onClick={() => run(e.welfareCheck(wf, unit))}>Send welfare check</button>
          </>}
        </>}
      </div>
    </div>
  );
}
