// Equipment / unit / incident inspector — floats over the active monitor.
import { useState, Fragment } from 'react';
import { useCtx, age } from './ctx';
import type { DevEl, LineEl } from '../sim/types';
import { sectionAround } from '../sim/network';
import { devWord } from '../sim/radio';
import { SUB_SPECS } from '../sim/topology';

export function Inspector() {
  const { e, sel, setSel } = useCtx();
  if (!sel) return null;
  return (
    <div className="inspector">
      <div className="ih">
        <span className="id">{title(sel.kind, sel.id, e)}</span>
        <span className="dim" style={{ fontSize: 10, textTransform: 'uppercase' }}>{sub(sel.kind, sel.id, e)}</span>
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => setSel(null)}>✕</button>
      </div>
      <div className="ib">
        {sel.kind === 'dev' && <DevView id={sel.id} />}
        {sel.kind === 'load' && <LoadView id={sel.id} />}
        {sel.kind === 'truck' && <TruckView id={sel.id} />}
        {sel.kind === 'inc' && <IncView id={sel.id} />}
        {sel.kind === 'line' && <LineView id={sel.id} />}
        {sel.kind === 'sub' && <SubView id={sel.id} />}
      </div>
    </div>
  );
}

function title(k: string, id: string, e: any) { if (k === 'truck') return `TRUCK ${id}`; if (k === 'sub') return SUB_SPECS.find(s => s.id === id)?.name + ' SUB'; void e; return id; }
function sub(k: string, id: string, e: any) {
  if (k === 'dev') { const d = e.T.els[id] as DevEl; return `${devWord(d)} · ${d.feeder}`; }
  if (k === 'load') return e.T.loads[id].cls === 'critical' ? 'critical customer' : 'service transformer';
  if (k === 'line') return 'line section';
  if (k === 'inc') return 'OMS incident';
  return '';
}

function DevView({ id }: { id: string }) {
  const { e, openSbo, setTab, setSwPrefill, flyTo } = useCtx();
  const d = e.T.els[id] as DevEl;
  const st = e.s.dev[id];
  const en = e.nodeEn(d.from) || e.nodeEn(d.to);
  const outUnder = e.T.devLoads[id].filter(l => !e.loadEn(l)).reduce((a, l) => a + e.T.loads[l].customers, 0);
  const lastSoe = e.s.soe.filter(x => x.dev === id).slice(-5).reverse();
  return (
    <>
      <div className="kv">
        <span className="k">Status</span>
        <span className="v">
          <span className={`state ${st.lockout ? 'lockout' : st.open ? 'open' : 'closed'}`}>{st.lockout ? 'LOCKOUT' : st.open ? 'OPEN' : 'CLOSED'}</span>
          {st.tags.map(t => <span key={t} className="badge amber" style={{ marginLeft: 4 }}>HOLD {t}</span>)}
        </span>
        <span className="k">Normal</span><span className="v">{d.normalOpen ? 'Normally OPEN' : 'Normally CLOSED'}{st.open !== d.normalOpen ? <span className="c-amber"> · ABNORMAL</span> : null}</span>
        <span className="k">Location</span><span className="v">{d.loc}</span>
        <span className="k">Control</span><span className="v">{d.scada ? (st.comm ? <span className="c-green">SCADA · comm OK</span> : <span className="c-amber">SCADA · COMM FAIL</span>) : 'Manual (field crew)'}</span>
        {d.scada && <><span className="k">Load (est.)</span><span className="v">{en && !st.open ? `${e.devAmps(id).toFixed(0)} A` : '0 A'}</span></>}
        <span className="k">Downstream</span><span className="v">{e.T.devCust[id].toLocaleString()} cust (normal)</span>
        <span className="k">Out under it</span><span className={`v ${outUnder ? 'c-red' : ''}`}>{outUnder}</span>
        <span className="k">Operations</span><span className="v">{st.ops}</span>
      </div>
      <div className="acts">
        {d.scada && d.type !== 'fuse' && <>
          <button className="btn danger" disabled={st.open} onClick={() => openSbo({ dev: id, action: 'open' })}>SCADA OPEN</button>
          <button className="btn good" disabled={!st.open} onClick={() => openSbo({ dev: id, action: 'close' })}>SCADA CLOSE</button>
        </>}
        {d.type !== 'fuse' && <button className="btn" onClick={() => { setSwPrefill({ dev: id, action: st.open ? 'close' : 'open' }); setTab('sw'); }}>Add to switching order</button>}
        <button className="btn" onClick={() => flyTo(d.pos, 16.5)}>Zoom</button>
      </div>
      {lastSoe.length > 0 && <><div className="sec-t">Recent events</div>
        {lastSoe.map((x, i) => <div key={i} style={{ fontSize: 10.5 }}><span className="mono dim">{e.hhmmss(x.t)}</span> {x.text}</div>)}</>}
    </>
  );
}

function LoadView({ id }: { id: string }) {
  const { e, flyTo } = useCtx();
  const L = e.T.loads[id];
  const en = e.loadEn(id);
  const calls = e.s.callOrder.filter(c => e.s.calls[c]?.load === id).length;
  const src = e.net.src.get(L.node);
  return (
    <>
      <div className="kv">
        <span className="k">Service</span><span className="v">{en ? <span className="c-green">ENERGIZED</span> : <span className="c-red">OUT {e.s.loadOutSince[id] !== undefined ? age(e.s.t - e.s.loadOutSince[id]) : ''}</span>}{e.s.planned[id] ? <span className="c-amber"> · planned</span> : null}</span>
        <span className="k">Address</span><span className="v">{L.name ?? L.addr}</span>
        <span className="k">Class</span><span className="v">{L.cls}</span>
        <span className="k">Customers</span><span className="v">{L.customers}</span>
        <span className="k">Transformer</span><span className="v">{L.id} · {L.kva} kVA</span>
        <span className="k">Feeder</span><span className="v">{L.feeder}{src && src !== L.feeder ? <span className="c-amber"> (fed from {src})</span> : null}</span>
        {L.lateral && <><span className="k">Lateral fuse</span><span className="v">{L.lateral}</span></>}
        <span className="k">Protection path</span><span className="v" style={{ whiteSpace: 'normal' }}>{e.T.loadAnc[id].slice(0, 5).join(' → ')}</span>
        <span className="k">Calls</span><span className="v">{calls}</span>
      </div>
      <div className="acts"><button className="btn" onClick={() => flyTo(L.pos, 17)}>Zoom</button></div>
    </>
  );
}

function LineView({ id }: { id: string }) {
  const { e, setSel } = useCtx();
  const el = e.T.els[id] as LineEl;
  const en = e.elEnergized(id);
  const sec = sectionAround(e.T, id);
  const src = e.net.src.get(el.to) || e.net.src.get(el.from);
  return (
    <>
      <div className="kv">
        <span className="k">State</span><span className="v">{en ? <span className="c-green">ENERGIZED</span> : <span className="c-red">DE-ENERGIZED</span>}</span>
        <span className="k">Feeder</span><span className="v">{el.feeder}{src && src !== el.feeder ? <span className="c-amber"> (fed from {src})</span> : null}</span>
        <span className="k">Construction</span><span className="v">{el.ug ? 'Underground' : 'Overhead'} · {el.lateral ? '1φ lateral' : el.tie ? '3φ tie' : '3φ mainline'}</span>
        <span className="k">Length</span><span className="v">{Math.round(el.len)} m</span>
        <span className="k">Section bounds</span><span className="v" style={{ whiteSpace: 'normal' }}>{sec.bounds.map(b => <a key={b} style={{ color: 'var(--cyan)', cursor: 'pointer', marginRight: 6 }} onClick={() => setSel({ kind: 'dev', id: b })}>{b}</a>)}</span>
      </div>
    </>
  );
}

function SubView({ id }: { id: string }) {
  const { e, setTab } = useCtx();
  const s = e.T.subs[id];
  const mw = s.feeders.reduce((a, f) => a + e.readings[f].kw, 0) / 1000;
  return (
    <>
      <div className="kv">
        <span className="k">Transformer</span><span className="v">138/12.47 kV · {s.mva} MVA</span>
        <span className="k">Load (est.)</span><span className="v">{mw.toFixed(2)} MW · {Math.round(mw / 0.95 / s.mva * 100)}%</span>
        {s.feeders.map(f => <Fragment key={f}><span className="k">{f}</span><span className="v">{e.readings[f].amps.toFixed(0)} A · {Math.round(e.readings[f].pct * 100)}%</span></Fragment>)}
      </div>
      <div className="acts"><button className="btn pri" onClick={() => setTab('scada')}>Open SCADA one-line</button></div>
    </>
  );
}

export function TruckView({ id }: { id: string }) {
  const { e, flyTo, flash } = useCtx();
  const tr = e.s.trucks[id];
  const [inc, setInc] = useState('');
  const [wf, setWf] = useState('');
  if (!tr) return <div className="empty">Unit not on duty</div>;
  const eta = e.eta(tr);
  const task = tr.task?.kind === 'incident' ? `${tr.task.id} (${tr.task.stage})` : tr.task?.kind === 'workorder' ? `${tr.task.id} — ${e.s.workorders[tr.task.id]?.type}` : tr.task?.kind === 'planned' ? `Planned job ${tr.task.id}` : tr.task?.kind === 'welfare' ? `Welfare check on ${tr.task.target}` : tr.task?.kind === 'home' ? 'Returning to service center' : '—';
  const openIncs = e.openIncidents().filter(i => i.status !== 'Restored');
  const others = Object.values(e.s.trucks).filter(t => t.id !== id && t.comm);
  const run = (err: string | null | undefined) => { if (err) flash(err, 'warn'); };
  return (
    <>
      <div className="kv">
        <span className="k">Status</span><span className="v"><span className={`chip ${tr.status.replace(/\s+/g, '')}`}>{tr.status}</span></span>
        <span className="k">Crew</span><span className="v">{tr.crew}</span>
        <span className="k">Equipment</span><span className="v">{tr.type}</span>
        <span className="k">Assignment</span><span className="v" style={{ whiteSpace: 'normal' }}>{task}</span>
        {tr.sw && <><span className="k">Switching</span><span className="v">{tr.sw.order} step {tr.sw.idx + 1}</span></>}
        {tr.clearance && <><span className="k">Clearance</span><span className="v c-amber">{tr.clearance}</span></>}
        <span className="k">Location</span><span className="v">{e.locOf(tr.pos)}</span>
        <span className="k">GPS</span><span className="v">{tr.pos[0].toFixed(5)}, {tr.pos[1].toFixed(5)}</span>
        <span className="k">ETA</span><span className="v">{eta ? `${e.hhmm(eta)} (${age(eta - e.s.t)})` : '—'}</span>
        <span className="k">Radio</span><span className="v">{tr.comm ? <span className="c-green">OK</span> : <span className="c-red">NO CONTACT</span>}</span>
      </div>
      <div className="acts">
        <button className="btn" onClick={() => e.statusCheck(id)}>Radio status check</button>
        <button className="btn" onClick={() => e.cellCall(id)}>Call cell</button>
        <button className="btn" onClick={() => run(e.recall(id))}>Recall</button>
        <button className="btn" onClick={() => flyTo(tr.pos, 16)}>Zoom</button>
      </div>
      <div className="sec-t">Dispatch to incident</div>
      <div className="form-row">
        <select value={inc} onChange={ev => setInc(ev.target.value)} style={{ flex: 1 }}>
          <option value="">— select incident —</option>
          {openIncs.map(i => <option key={i.id} value={i.id}>P{i.priority} {i.id} {i.predDev} ({i.custOut})</option>)}
        </select>
        <button className="btn pri" disabled={!inc} onClick={() => run(e.dispatch(id, inc))}>Dispatch</button>
      </div>
      {!tr.comm && <>
        <div className="sec-t">Welfare check</div>
        <div className="form-row">
          <select value={wf} onChange={ev => setWf(ev.target.value)} style={{ flex: 1 }}>
            <option value="">— send unit —</option>
            {others.map(t => <option key={t.id} value={t.id}>{t.id} · {t.status}</option>)}
          </select>
          <button className="btn warn" disabled={!wf} onClick={() => run(e.welfareCheck(wf, id))}>Send</button>
        </div>
      </>}
    </>
  );
}

function IncView({ id }: { id: string }) {
  const { e } = useCtx();
  const inc = e.s.incidents[id];
  if (!inc) return null;
  return (
    <div className="kv">
      <span className="k">Priority</span><span className="v"><span className={`badge p${inc.priority}`}>P{inc.priority}</span> {inc.critical ? 'CRITICAL' : ''} {inc.hazard ? 'HAZARD' : ''}</span>
      <span className="k">Status</span><span className="v">{inc.status} · {inc.stage}</span>
      <span className="k">Device</span><span className="v">{inc.predDev}</span>
      <span className="k">Customers out</span><span className="v">{inc.custOut} (peak {inc.peak})</span>
      <span className="k">Crew</span><span className="v">{inc.crew ?? '—'}</span>
      <span className="k">ETR</span><span className="v">{inc.etr ? e.hhmm(inc.etr) : 'Assessing'}</span>
      <span className="k">Detail</span><span className="v">see OMS panel</span>
    </div>
  );
}
