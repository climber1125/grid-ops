// Console field radio: hold-to-talk voice clips and text to the real crews' phones,
// and their clips back. Lives at the top of the Radio panel during a field session
// and in the Field tab.
import { useRef, useState } from 'react';
import { useCtx } from './ctx';
import { canRecord, playClip, startRec, MAX_SEC, type Rec } from '../field/fieldRadio';
import { sendRadio, useRadio, autoPlay, setAutoPlay } from '../field/radioStore';

export function FieldRadio({ compact = false }: { compact?: boolean }) {
  const { e, flash } = useCtx();
  const items = useRadio();
  const crews = Object.values(e.s.trucks).filter(t => t.field).map(t => t.id).sort();
  const [to, setTo] = useState('ALL');
  const [txt, setTxt] = useState('');
  const [rec, setRec] = useState<Rec | null>(null);
  const [busy, setBusy] = useState(false);
  const t0 = useRef(0);
  const [, setTick] = useState(0);
  const tick = useRef<number | null>(null);
  if (!e.s.field?.code) return null;
  const target = to === 'ALL' || crews.includes(to) ? to : 'ALL';

  const send = async (m: Parameters<typeof sendRadio>[2]) => {
    setBusy(true);
    try { await sendRadio(e, target, m); } catch (err: any) { flash(err?.message ?? String(err), 'warn'); } finally { setBusy(false); }
  };
  const down = async () => {
    if (rec || busy) return;
    try {
      const r = await startRec(c => { setRec(null); if (c) send(c); });
      t0.current = Date.now(); setRec(r);
      tick.current = window.setInterval(() => setTick(n => n + 1), 200);
    } catch { flash('Microphone blocked — allow the mic for this site (padlock in the address bar).', 'warn'); }
  };
  const up = async () => {
    if (!rec) return;
    if (tick.current) clearInterval(tick.current);
    const r = rec; setRec(null);
    const c = await r.stop();
    if (c) send(c);
  };
  const secs = rec ? ((Date.now() - t0.current) / 1000).toFixed(1) : '';
  const list = items.slice(compact ? -6 : -40).reverse();

  return (
    <div className="fradio">
      <div className="form-row" style={{ margin: 0, alignItems: 'center' }}>
        <b className="c-amber" style={{ fontSize: 11, letterSpacing: '.06em' }}>FIELD RADIO</b>
        <select value={target} onChange={ev => setTo(ev.target.value)}>
          <option value="ALL">All field crews</option>
          {crews.map(c => <option key={c} value={c}>Truck {c}</option>)}
        </select>
        <label className="chk" style={{ fontSize: 11 }}><input type="checkbox" checked={autoPlay} onChange={ev => setAutoPlay(ev.target.checked)} /> Auto-play</label>
      </div>
      {canRecord() ? (
        <button className={`btn ptt fptt ${rec ? 'on' : ''}`} disabled={busy}
          onPointerDown={ev => { ev.preventDefault(); down(); }} onPointerUp={up} onPointerLeave={() => rec && up()} onPointerCancel={() => { rec?.cancel(); setRec(null); }}>
          {rec ? `● TRANSMITTING to ${target === 'ALL' ? 'all crews' : `Truck ${target}`} — ${secs}s / ${MAX_SEC}s` : busy ? 'Sending…' : `HOLD TO TALK — ${target === 'ALL' ? 'all field crews' : `Truck ${target}`}`}
        </button>
      ) : <div className="dim">This browser can't record audio — use text.</div>}
      <form className="form-row" style={{ margin: 0 }} onSubmit={ev => { ev.preventDefault(); if (txt.trim()) { send({ text: txt.trim() }); setTxt(''); } }}>
        <input value={txt} onChange={ev => setTxt(ev.target.value)} placeholder={`Text to ${target === 'ALL' ? 'all field crews' : `Truck ${target}`}`} style={{ flex: 1 }} />
        <button className="btn sm" disabled={!txt.trim() || busy}>Send</button>
      </form>
      <div className="fr-log" style={compact ? { maxHeight: 150 } : undefined}>
        {list.length ? list.map(it => (
          <div key={it.id} className={`fr-item ${it.from === 'OPS' ? 'out' : 'in'}`}>
            <span className="mono dim">{it.clock}</span>
            <b className="mono">{it.from === 'OPS' ? `OPS → ${it.to === 'ALL' ? 'ALL' : it.to}` : `${it.from} → OPS`}</b>
            {it.audio && <button className="btn sm" onClick={() => playClip(it.audio!)}>▶ {Math.round(it.dur ?? 0)}s</button>}
            {it.text && <span>"{it.text}"</span>}
          </div>
        )) : <div className="dim">No field radio traffic yet.</div>}
      </div>
    </div>
  );
}
