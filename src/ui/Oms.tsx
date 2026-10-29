// MONITOR 3 — Outage Management System
import { useState, useEffect } from 'react';
import { useCtx, age } from './ctx';
import type { DevEl, Incident } from '../sim/types';
import { dist } from '../sim/geo';
import { route } from '../sim/roads';
import { SayOr } from './VoiceUi';

export function OmsPanel() {
  const { e, sel, setSel, flyTo, flash } = useCtx();
  const [tab, setTab] = useState<'inc' | 'calls' | 'hist'>('inc');
  const [truck, setTruck] = useState('');
  const selInc = sel?.kind === 'inc' ? e.s.incidents[sel.id] : undefined;
  useEffect(() => { setTruck(''); }, [sel?.id]);

  const all = Object.values(e.s.incidents);
  const open = all.filter(i => i.status !== 'Closed').sort((a, b) => a.priority - b.priority || (a.status === 'Restored' ? 1 : 0) - (b.status === 'Restored' ? 1 : 0) || a.t - b.t);
  const hist = all.filter(i => i.status === 'Closed').sort((a, b) => (b.closedT ?? 0) - (a.closedT ?? 0));
  const calls = e.s.callOrder.slice(-150).reverse().map(c => e.s.calls[c]).filter(Boolean);
  const out = e.customersOut();
  const pos = (i: Incident) => i.kind === 'single' ? e.T.loads[i.loadId!].pos : (e.T.els[i.predDev] as DevEl).pos;

  const Row = (i: Incident) => (
    <tr key={i.id} className={`row ${sel?.kind === 'inc' && sel.id === i.id ? 'sel' : ''}`} onClick={() => { setSel({ kind: 'inc', id: i.id }); flyTo(pos(i)); }}>
      <td><span className={`badge p${i.priority}`}>P{i.priority}</span>{i.hazard ? <span className="badge red" style={{ marginLeft: 2 }}>⚠</span> : null}{i.critical ? <span className="badge red" style={{ marginLeft: 2 }}>CRIT</span> : null}</td>
      <td className="mono">{i.id}</td>
      <td className="mono">{i.kind === 'single' ? 'SINGLE' : i.predDev}</td>
      <td className="mono dim">{i.feeder}</td>
      <td className={`num ${i.custOut ? 'c-red' : 'c-green'}`}>{i.custOut}</td>
      <td className="num">{i.calls.length}</td>
      <td>{i.status === 'Restored' ? <span className="c-green">Restored ✓?</span> : i.status}</td>
      <td className="mono">{i.crew ?? <span className="c-amber">—</span>}</td>
      <td className="mono">{i.etr ? e.hhmm(i.etr) : <span className="dim">assess</span>}</td>
      <td className="num dim">{age(e.s.t - i.t)}</td>
    </tr>
  );

  return (
    <div className="panel" style={{ flex: 1.15 }}>
      <div className="ph">
        <span className="mon">M3</span><span className="ttl">OMS</span>
        <div className="tabs" style={{ marginLeft: 6 }}>
          <button className={`tab ${tab === 'inc' ? 'on' : ''}`} onClick={() => setTab('inc')}>Incidents<span className="badge">{open.length}</span></button>
          <button className={`tab ${tab === 'calls' ? 'on' : ''}`} onClick={() => setTab('calls')}>Calls<span className="badge">{e.s.callOrder.length}</span></button>
          <button className={`tab ${tab === 'hist' ? 'on' : ''}`} onClick={() => setTab('hist')}>History</button>
        </div>
        <span className="sp" />
        <span className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>OUT <b className={out ? 'c-red' : 'c-green'}>{out.toLocaleString()}</b></span>
      </div>
      <div className="pb">
        {tab === 'inc' && (open.length ? <table className="grid"><thead><tr><th>Pri</th><th>Incident</th><th>Device</th><th>Fdr</th><th>Out</th><th>Calls</th><th>Status</th><th>Crew</th><th>ETR</th><th>Age</th></tr></thead><tbody>{open.map(Row)}</tbody></table> : <div className="empty">No open incidents. System normal.</div>)}
        {tab === 'hist' && (hist.length ? <table className="grid"><thead><tr><th>Pri</th><th>Incident</th><th>Device</th><th>Fdr</th><th>Peak</th><th>Calls</th><th>Cause</th><th>Crew</th><th>Resp</th><th>Restore</th><th>Cust-min</th></tr></thead><tbody>
          {hist.map(i => <tr key={i.id} className="row" onClick={() => setSel({ kind: 'inc', id: i.id })}><td><span className={`badge p${i.priority}`}>P{i.priority}</span></td><td className="mono">{i.id}</td><td className="mono">{i.predDev}</td><td className="mono dim">{i.feeder}</td><td className="num">{i.peak}</td><td className="num">{i.calls.length}</td><td>{i.cause ?? '—'}</td><td className="mono">{i.crewHistory.join(',') || '—'}</td><td className="num">{i.onSceneT != null ? age(i.onSceneT - i.t) : '—'}</td><td className="num">{age((i.restoredT ?? i.closedT ?? e.s.t) - i.t)}</td><td className="num">{Math.round(i.cmi ?? 0).toLocaleString()}</td></tr>)}
        </tbody></table> : <div className="empty">No closed incidents this shift.</div>)}
        {tab === 'calls' && <table className="grid"><thead><tr><th>Time</th><th>Call</th><th>Address</th><th>Remark</th><th>Inc</th></tr></thead><tbody>
          {calls.map(c => <tr key={c.id} className="row" onClick={() => { if (c.incident) setSel({ kind: 'inc', id: c.incident }); flyTo(c.pos, 16.5); }}>
            <td className="mono dim">{e.hhmm(c.t)}</td><td className="mono">{c.id}</td><td>{c.addr}</td>
            <td className={c.hazard ? 'c-red' : c.kind === 'momentary' ? 'dim' : ''} style={{ whiteSpace: 'normal' }}>{c.remark}</td>
            <td className="mono">{c.incident ?? (c.kind === 'momentary' ? 'MOM' : '—')}</td></tr>)}
        </tbody></table>}
      </div>
      {selInc && tab !== 'calls' && (
        <div className="oms-detail">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <b className="mono">{selInc.id}</b>
            <span className={`badge p${selInc.priority}`}>P{selInc.priority}</span>
            <span className="dim">{selInc.source} · {selInc.kind === 'single' ? 'single customer' : `${e.T.devCust[selInc.predDev] ?? 0} cust under ${selInc.predDev}`}</span>
            <span style={{ flex: 1 }} />
            <button className="btn sm" onClick={() => setSel(null)}>✕</button>
          </div>
          <div className="kv" style={{ gridTemplateColumns: '90px 1fr 90px 1fr' }}>
            <span className="k">Status</span><span className="v">{selInc.status} / {selInc.stage}</span>
            <span className="k">Out / Peak</span><span className="v">{selInc.custOut} / {selInc.peak}</span>
            <span className="k">Location</span><span className="v">{selInc.kind === 'single' ? e.T.loads[selInc.loadId!].addr : (e.T.els[selInc.predDev] as DevEl).loc}</span>
            <span className="k">ETR</span><span className="v">{selInc.etr ? e.hhmm(selInc.etr) : 'Assessing'}</span>
            <span className="k">Cause</span><span className="v">{selInc.cause ?? 'Unknown'}</span>
            <span className="k">Crew</span><span className="v">{selInc.crew ?? '—'}</span>
            {selInc.isolation.length > 0 && <><span className="k">Isolate at</span><span className="v" style={{ gridColumn: 'span 3' }}>{selInc.isolation.join(', ')}</span></>}
          </div>
          {selInc.status !== 'Closed' && selInc.status !== 'Restored' && (
            <div className="form-row">
              <select value={truck} onChange={ev => setTruck(ev.target.value)} style={{ flex: 1 }}>
                <option value="">— assign unit —</option>
                {Object.values(e.s.trucks).sort((a, b) => dist(a.pos, pos(selInc)) - dist(b.pos, pos(selInc))).map(t => {
                  const mins = Math.round(route(t.pos, pos(selInc)).total / 60);
                  return <option key={t.id} value={t.id} disabled={!!t.clearance || !!t.sw}>{t.id} · {t.status}{t.task ? ` (${t.task.kind})` : ''} · ~{mins} min</option>;
                })}
              </select>
              <SayOr phrase={`Truck ${truck || '###'}, Sparks Control, respond to ${selInc.id}`}><button className="btn pri" disabled={!truck} onClick={() => { const err = e.dispatch(truck, selInc.id); if (err) flash(err, 'warn'); }}>Dispatch</button></SayOr>
            </div>
          )}
          {selInc.status === 'Restored' && <div className="form-row"><span className="c-green">All customers restored. Verify by AMI ping/callback before closing.</span><button className="btn good" onClick={() => { const err = e.verifyIncident(selInc.id); if (err) flash(err, 'warn'); }}>Verify &amp; Close</button></div>}
          <div className="timeline">
            {selInc.timeline.slice().reverse().map((x, k) => <div key={k}><span className="tt">{e.hhmm(x.t)}</span>{x.text}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
