// Crew roster, reliability indices, and the big-screen status wall.
import { useState } from 'react';
import { useCtx, age } from './ctx';
import type { Engine } from '../sim/engine';

// ── Roster preferences (persist your own trucks across scenarios) ──
export interface RosterPrefs { extra: { id: string; crew: string; type: string }[]; removed: string[]; names: Record<string, { crew: string; type: string }>; }
const KEY = 'gridops-roster';
export function loadRoster(): RosterPrefs {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.extra)) return { extra: v.extra, removed: v.removed ?? [], names: v.names ?? {} }; } catch { /* none */ }
  return { extra: [], removed: [], names: {} };
}
function saveRoster(p: RosterPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* none */ } }

/** Apply saved roster to a freshly created scenario (main console only). Quiet: no radio check-ins. */
export function applyRoster(e: Engine) {
  const p = loadRoster();
  for (const id of p.removed) if (e.s.trucks[id]) e.rosterRemove(id);
  for (const [id, n] of Object.entries(p.names)) if (e.s.trucks[id]) e.rosterEdit(id, n.crew, n.type);
  for (const t of p.extra) if (!e.s.trucks[t.id]) e.rosterAdd(t.id, t.crew, t.type, true);
}

const TYPES = ['45 ft bucket', '55 ft bucket', 'Digger derrick', 'Troubleman pickup', 'Material truck', 'Tree crew'];

export function RosterPanel() {
  const { e, flash } = useCtx();
  const [id, setId] = useState('');
  const [crew, setCrew] = useState('');
  const [type, setType] = useState(TYPES[0]);
  const [edit, setEdit] = useState<string | null>(null);
  const [eCrew, setECrew] = useState('');
  const [eType, setEType] = useState('');
  const trucks = Object.values(e.s.trucks).sort((a, b) => a.id.localeCompare(b.id));
  const pre = (err: string | null) => { if (err) { flash(err, 'warn'); return false; } return true; };
  const add = () => {
    const tid = id.trim();
    if (e.s.trucks[tid]) { flash(`Truck ${tid} is already on the roster`, 'warn'); return; }
    if (!/^\d{2,4}$/.test(tid)) { flash('Truck number must be 2–4 digits', 'warn'); return; }
    e.rosterAdd(tid, crew, type);
    const p = loadRoster();
    p.removed = p.removed.filter(x => x !== tid);
    if (!p.extra.some(x => x.id === tid)) p.extra.push({ id: tid, crew: crew.trim() || 'Crew', type });
    saveRoster(p);
    setId(''); setCrew('');
  };
  const remove = (tid: string) => {
    const tr = e.s.trucks[tid];
    if (tr?.clearance) return pre(`Truck ${tid} holds clearance ${tr.clearance} — release it first`);
    if (tr?.sw) return pre(`Truck ${tid} is in the middle of switching`);
    if (tr?.task?.kind === 'planned') return pre(`Truck ${tid} is assigned to a planned job`);
    if (!confirm(`Take Truck ${tid} off the roster? Any incident it's on goes back to unassigned.`)) return;
    e.rosterRemove(tid);
    const p = loadRoster();
    const wasExtra = p.extra.some(x => x.id === tid);
    p.extra = p.extra.filter(x => x.id !== tid);
    if (!wasExtra && !p.removed.includes(tid)) p.removed.push(tid);
    delete p.names[tid];
    saveRoster(p);
  };
  const saveEdit = () => {
    if (!edit) return;
    e.rosterEdit(edit, eCrew, eType);
    const p = loadRoster();
    const ex = p.extra.find(x => x.id === edit);
    if (ex) { ex.crew = eCrew || ex.crew; ex.type = eType || ex.type; } else p.names[edit] = { crew: eCrew, type: eType };
    saveRoster(p); setEdit(null);
  };
  return (
    <div style={{ padding: 8 }}>
      <div className="form-row">
        <input placeholder="Truck #" value={id} onChange={ev => setId(ev.target.value.replace(/\D/g, '').slice(0, 4))} style={{ width: 70 }} className="mono" />
        <input placeholder="Crew (e.g. Smith / Jones)" value={crew} onChange={ev => setCrew(ev.target.value)} style={{ flex: 1, minWidth: 140 }} />
        <select value={type} onChange={ev => setType(ev.target.value)}>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
        <button className="btn pri" disabled={!id} onClick={add}>Add truck</button>
      </div>
      <table className="grid" style={{ marginTop: 4 }}>
        <thead><tr><th>Unit</th><th>Crew</th><th>Equipment</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {trucks.map(t => edit === t.id ? (
            <tr key={t.id}>
              <td className="mono"><b>{t.id}</b></td>
              <td><input value={eCrew} onChange={ev => setECrew(ev.target.value)} style={{ width: '100%' }} /></td>
              <td><select value={eType} onChange={ev => setEType(ev.target.value)}>{[...new Set([eType, ...TYPES])].map(x => <option key={x}>{x}</option>)}</select></td>
              <td />
              <td><button className="btn good sm" onClick={saveEdit}>Save</button> <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button></td>
            </tr>
          ) : (
            <tr key={t.id}>
              <td className="mono"><b>{t.id}</b></td>
              <td>{t.crew}</td>
              <td className="dim">{t.type}</td>
              <td><span className={`chip ${t.status.replace(/\s+/g, '')}`}>{t.status}</span></td>
              <td><button className="btn sm" onClick={() => { setEdit(t.id); setECrew(t.crew); setEType(t.type); }}>Edit</button> <button className="btn danger sm" onClick={() => remove(t.id)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dim" style={{ fontSize: 10.5, marginTop: 6 }}>
        Trucks you add, remove or rename are remembered and applied to every new scenario. Trucks holding a clearance, switching, or on a planned job can't be removed until they're clear.
        <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => { saveRoster({ extra: [], removed: [], names: {} }); flash('Saved roster cleared — next scenario uses default trucks', 'good'); }}>Reset to defaults</button>
      </div>
    </div>
  );
}

// ── Reliability ──────────────────────────────────────────────
const mins = (sec: number | null) => (sec == null ? '—' : `${(sec / 60).toFixed(1)}m`);

export function ReliabilityPanel() {
  const { e, setSel } = useCtx();
  const r = e.reliability();
  const incs = Object.values(e.s.incidents).sort((a, b) => b.t - a.t);
  return (
    <div style={{ padding: 8 }}>
      <div className="relgrid">
        <div className="metric"><div className="k">SAIDI</div><div className="v">{r.saidi.toFixed(2)}<small> min</small></div><div className="h">cust-min ÷ cust served</div></div>
        <div className="metric"><div className="k">SAIFI</div><div className="v">{r.saifi.toFixed(3)}</div><div className="h">cust interrupted ÷ served</div></div>
        <div className="metric"><div className="k">CAIDI</div><div className="v">{r.caidi.toFixed(1)}<small> min</small></div><div className="h">avg restore per cust</div></div>
        <div className="metric"><div className="k">MAIFI</div><div className="v">{r.maifi.toFixed(3)}</div><div className="h">momentaries ÷ served</div></div>
        <div className="metric"><div className="k">Avg dispatch</div><div className="v">{mins(r.avgDispatch)}</div><div className="h">report → crew assigned</div></div>
        <div className="metric"><div className="k">Avg response</div><div className="v">{mins(r.avgResp)}</div><div className="h">report → crew on scene</div></div>
        <div className="metric"><div className="k">Avg restore</div><div className="v">{mins(r.avgRestore)}</div><div className="h">report → power on</div></div>
        <div className="metric"><div className="k">Cust-minutes</div><div className="v">{Math.round(r.cmi).toLocaleString()}</div><div className="h">{r.ci.toLocaleString()} cust interrupted · {r.mom.toLocaleString()} momentary</div></div>
      </div>
      <table className="grid" style={{ marginTop: 8 }}>
        <thead><tr><th>Incident</th><th>Device</th><th>Peak</th><th>Dispatch</th><th>Response</th><th>Restore</th><th>Cust-min</th><th>Status</th></tr></thead>
        <tbody>
          {incs.map(i => (
            <tr key={i.id} className="row" onClick={() => setSel({ kind: 'inc', id: i.id })}>
              <td className="mono">{i.id}</td>
              <td className="mono">{i.kind === 'single' ? 'SINGLE' : i.predDev}</td>
              <td className="num">{i.peak}</td>
              <td className="num">{i.firstDispatchT != null ? mins(i.firstDispatchT - i.t) : <span className="c-amber">{age(e.s.t - i.t)}…</span>}</td>
              <td className="num">{i.onSceneT != null ? mins(i.onSceneT - i.t) : '—'}</td>
              <td className="num">{i.restoredT != null ? mins(i.restoredT - i.t) : '—'}</td>
              <td className="num">{Math.round(i.cmi ?? 0).toLocaleString()}</td>
              <td>{i.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dim" style={{ fontSize: 10.5, marginTop: 6 }}>Indices cover this exercise only, over {r.N.toLocaleString()} customers served. Every interruption is counted as sustained; momentaries are recloser operations that cleared.</div>
    </div>
  );
}

// ── Status wall (big screen / projector) ─────────────────────
export function StatusWall() {
  const { e } = useCtx();
  const s = e.s;
  const r = e.reliability();
  const out = e.customersOut();
  const N = e.T.totalCustomers;
  const open = e.openIncidents().filter(i => i.status !== 'Restored').sort((a, b) => a.priority - b.priority || b.custOut - a.custOut);
  const p1 = open.filter(i => i.priority === 1).length;
  const unack = s.alarms.filter(a => !a.acked);
  const lastP1 = s.alarms.filter(a => a.active && a.pri === 1).at(-1);
  const trucks = Object.values(s.trucks).sort((a, b) => a.id.localeCompare(b.id));
  const lastRadio = s.radio.slice(-3);
  return (
    <div className="wall">
      <div className="wall-hero">
        <div className="wtile big">
          <div className="k">Customers out</div>
          <div className={`v ${out ? 'c-red' : 'c-green'}`}>{out.toLocaleString()}</div>
          <div className="sub">{(((N - out) / N) * 100).toFixed(2)}% of {N.toLocaleString()} served</div>
        </div>
        <div className="wtile"><div className="k">Open incidents</div><div className={`v ${open.length ? 'c-amber' : ''}`}>{open.length}</div><div className="sub">{p1 ? <span className="c-red">{p1} priority 1</span> : 'no P1'}</div></div>
        <div className="wtile"><div className="k">Unack alarms</div><div className={`v ${unack.length ? 'c-red' : ''}`}>{unack.length}</div><div className="sub">{lastP1 ? lastP1.text.slice(0, 40) : 'none active P1'}</div></div>
        <div className="wtile"><div className="k">Crews available</div><div className="v">{trucks.filter(t => t.status === 'Available').length}<small>/{trucks.length}</small></div><div className="sub">{trucks.filter(t => !t.comm).length ? <span className="c-red">{trucks.filter(t => !t.comm).length} out of contact</span> : 'all in contact'}</div></div>
      </div>
      <div className="wall-rel">
        {([['SAIDI', r.saidi.toFixed(2) + 'm'], ['SAIFI', r.saifi.toFixed(3)], ['CAIDI', r.caidi.toFixed(1) + 'm'], ['MAIFI', r.maifi.toFixed(3)], ['Avg response', mins(r.avgResp)], ['Avg restore', mins(r.avgRestore)]] as [string, string][]).map(([k, v]) => (
          <div key={k} className="wtile sm"><div className="k">{k}</div><div className="v">{v}</div></div>
        ))}
      </div>
      <div className="wall-main">
        <div className="wpanel">
          <div className="wh">Active incidents</div>
          {open.length === 0 && <div className="wempty">System normal</div>}
          {open.slice(0, 7).map(i => (
            <div key={i.id} className={`wrow p${i.priority}`}>
              <span className={`badge p${i.priority}`}>P{i.priority}</span>
              <span className="mono">{i.id}</span>
              <span className="grow">{i.kind === 'single' ? e.T.loads[i.loadId!].addr : `${i.predDev} · ${i.feeder}`}{i.critical ? ' · CRITICAL' : ''}{i.hazard ? ' · HAZARD' : ''}</span>
              <span className="c-red mono">{i.custOut}</span>
              <span className="mono">{i.crew ?? '—'}</span>
              <span className="mono dim">{i.etr ? 'ETR ' + e.hhmm(i.etr) : age(e.s.t - i.t)}</span>
            </div>
          ))}
        </div>
        <div className="wpanel">
          <div className="wh">Field units</div>
          {trucks.map(t => (
            <div key={t.id} className="wrow">
              <span className="mono"><b>{t.id}</b></span>
              <span className={`chip ${t.status.replace(/\s+/g, '')}`}>{t.status}</span>
              <span className="grow">{t.task?.kind === 'incident' ? t.task.id : t.task?.kind === 'workorder' ? e.s.workorders[t.task.id]?.type : t.task?.kind === 'planned' ? 'Planned job' : t.task?.kind === 'welfare' ? `Welfare → ${t.task.target}` : ''}{t.clearance ? ` · ${t.clearance}` : ''}</span>
              <span className="dim">{e.locOf(t.pos)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="wall-foot">
        <div className="wpanel feeders">
          {e.T.feederIds.map(f => { const rd = e.readings[f]; const pct = Math.min(1.2, rd.pct); return (
            <div key={f} className="fbar">
              <span className="mono">{f}</span>
              <div className="track"><div className="fill" style={{ width: `${(pct / 1.2) * 100}%`, background: rd.pct > 1 ? 'var(--red)' : rd.pct > 0.9 ? 'var(--amber)' : e.T.feeders[f].color }} /></div>
              <span className="mono">{Math.round(rd.pct * 100)}%</span>
              <span className={`mono ${rd.custOut ? 'c-red' : 'dim'}`}>{rd.custOut ? `${rd.custOut} out` : ''}</span>
            </div>); })}
        </div>
        <div className="wpanel radio">
          {lastRadio.map(m => <div key={m.id} className="wradio"><span className="mono dim">{e.hhmm(m.t)}</span> <b>{m.from}:</b> {m.text}</div>)}
        </div>
      </div>
    </div>
  );
}
