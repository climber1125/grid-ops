// Switching orders & clearances — written, approved, issued step-by-step
// with three-part communication (issue → repeat-back → confirm).
import { useEffect, useState, Fragment } from 'react';
import { useRadio } from '../field/radioStore';
import { playClip } from '../field/fieldRadio';
import { useCtx } from './ctx';
import type { DevEl } from '../sim/types';
import { devWord, actionsFor, ACTION_LABEL } from '../sim/radio';
import type { SwAction } from '../sim/types';
import { SayOr } from './VoiceUi';
import { FindingsList, download, ActPill } from './Instructor';
import { buildReport, workSection, workLocation, type ExState } from '../sim/exercise';

/** Banner for a running switching exercise. */
function ExerciseBar() {
  const { e, setSel } = useCtx();
  const ex = e.s.scen.flags.ex as ExState | undefined;
  const [name, setName] = useState(ex?.student ?? '');
  if (!ex) return null;
  const def = ex.def, ws = workSection(e, def), loc = workLocation(e, def);
  const last = ex.submissions.at(-1);
  const save = () => {
    const r = buildReport(e);
    if (r) download(r, `switching-report-${def.id}-${(ex.student || 'student').replace(/[^a-z0-9]+/gi, '-')}.json`);
  };
  return (
    <div className="exbar">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="badge cyan">EXERCISE {def.id}</span>
        <b>{def.work} on {def.feeder}</b>
        <span className="dim">Crew {def.truck} on site at {loc.loc}</span>
        <button className="btn sm" onClick={() => setSel({ kind: 'truck', id: def.truck })}>Show crew</button>
        <span style={{ flex: 1 }} />
        <input placeholder="Your name" value={name} onChange={ev => setName(ev.target.value)} onBlur={() => e.exSetStudent(name)} style={{ width: 150 }} />
        {!ex.finished
          ? <button className="btn" onClick={() => { e.exSetStudent(name); if (confirm('Finish the exercise now and download your report?')) { e.exFinish(); setTimeout(save, 50); } }}>Finish &amp; download report</button>
          : <button className="btn pri" onClick={() => { e.exSetStudent(name); setTimeout(save, 50); }}>Download report</button>}
      </div>
      <div style={{ fontSize: 11.5, marginTop: 3 }}>
        {def.kind === 'bypass'
          ? <>Take <b>{def.workEl}</b> out of service on its bypass with <b>no customer outage</b>, so the crew can work on it under a clearance. Mark the hold point and <b>submit the order for a check</b> before you activate it.</>
          : <>Isolate the work section ({ws.customers} customers on planned outage). Pick up everyone else you can, mark the hold point, and <b>submit the order for a check</b> before you activate it.</>}
        <span className="dim"> Company rules: {def.rulesName ?? 'Standard'}.</span>
        {def.notes && <div className="c-amber" style={{ marginTop: 2 }}>Instructor: {def.notes}</div>}
      </div>
      {last && (def.coach
        ? <div style={{ marginTop: 4 }}><FindingsList check={last.check} /></div>
        : <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>{ex.submissions.length} submission{ex.submissions.length > 1 ? 's' : ''} recorded. Your instructor will see the check in your report.</div>)}
      {ex.finished && <div className="c-green" style={{ fontSize: 12, marginTop: 3 }}>Exercise complete. Download your report and send it to your instructor.</div>}
    </div>
  );
}

export function SwitchingView() {
  const { e, swPrefill, setSwPrefill, openSbo, flash, setSel } = useCtx();
  const orders = Object.values(e.s.orders).sort((a, b) => b.created - a.created);
  const [cur, setCur] = useState<string>(orders.find(o => o.status === 'Active' || o.status === 'Draft')?.id ?? orders[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [dev, setDev] = useState('');
  const [action, setAction] = useState<SwAction>('open');
  const [exec, setExec] = useState('SCADA');
  const [loop, setLoop] = useState(false);
  const o = e.s.orders[cur];
  const devList = e.T.switchable.filter(id => (e.T.els[id] as DevEl).type !== 'fuse');

  useEffect(() => {
    if (!swPrefill) return;
    setDev(swPrefill.dev); setAction(swPrefill.action);
    setExec((e.T.els[swPrefill.dev] as DevEl).scada ? 'SCADA' : Object.keys(e.s.trucks)[0] ?? 'SCADA');
    if (!o || o.status === 'Complete' || o.status === 'Cancelled') { const n = e.newOrder(`Switching — ${swPrefill.dev}`); setCur(n.id); }
    setSwPrefill(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swPrefill]);

  const [err, setErr] = useState('');
  useEffect(() => setErr(''), [cur, o?.cur]);
  const run = (er: string | null | undefined) => { if (er) { flash(er, 'warn'); setErr(er); } else setErr(''); };
  const step = o?.steps[o.cur];
  const clrs = Object.values(e.s.clearances).filter(c => c.status === 'Active');
  const ex = e.s.scen.flags.ex as ExState | undefined;

  return (
    <div className="sw">
      <div className="sw-list">
        <div className="ph"><span className="ttl">Switching orders</span></div>
        <div className="form-row" style={{ padding: '0 8px' }}>
          <input placeholder="New order title" value={title} onChange={ev => setTitle(ev.target.value)} style={{ flex: 1 }} />
          <button className="btn pri" onClick={() => { const n = e.newOrder(title || 'Switching order'); setCur(n.id); setTitle(''); }}>New</button>
        </div>
        {orders.map(x => (
          <div key={x.id} className={`sw-item ${x.id === cur ? 'on' : ''}`} onClick={() => setCur(x.id)}>
            <div className="mono"><b>{x.id}</b> <span className={`badge ${x.status === 'Active' ? 'cyan' : x.status === 'Complete' ? 'green' : x.status === 'Cancelled' ? '' : 'amber'}`}>{x.status}</span></div>
            <div style={{ fontSize: 11, color: 'var(--text2)' }}>{x.title}</div>
            <div className="dim" style={{ fontSize: 10 }}>{x.steps.length} steps · {x.steps.filter(s => s.status === 'Done').length} done</div>
          </div>
        ))}
        <div className="ph" style={{ marginTop: 8 }}><span className="ttl">Active clearances</span></div>
        {clrs.length === 0 && <div className="empty">None</div>}
        {clrs.map(c => (
          <div key={c.id} className="sw-item">
            <div className="mono"><b className="c-amber">{c.id}</b> → Truck {c.truck}</div>
            <div style={{ fontSize: 10.5 }}>HOLD: {c.devs.join(', ')}</div>
            <div className="dim" style={{ fontSize: 10 }}>Issued {e.hhmm(c.issued)} · {c.purpose}</div>
            <button className="btn danger sm" style={{ marginTop: 3 }} onClick={() => { if (confirm(`Force-release ${c.id} without a release from Truck ${c.truck}? This is a serious safety violation and will be recorded.`)) run(e.releaseClearance(c.id, true)); }}>Force release…</button>
          </div>
        ))}
      </div>

      <div className="sw-main">
        <ExerciseBar />
        {!o ? <div className="empty">Create a switching order, or use “Add to switching order” from any device.</div> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b className="mono" style={{ fontSize: 14 }}>{o.id}</b>
              <span>{o.title}</span>
              <span className={`badge ${o.status === 'Active' ? 'cyan' : o.status === 'Complete' ? 'green' : 'amber'}`}>{o.status}</span>
              <span style={{ flex: 1 }} />
              {o.status === 'Draft' && ex && (() => { const sb = e.exSubmission(o.id); return <>
                {sb && <span className={`badge ${sb.current ? 'green' : 'amber'}`}>{sb.current ? 'Submitted' : 'Changed since submit'}</span>}
                <button className="btn" onClick={() => run(e.exSubmit(o.id))}>{sb ? 'Resubmit for check' : 'Submit for check'}</button>
              </>; })()}
              {o.status === 'Draft' && <button className="btn pri" onClick={() => run(e.activateOrder(o.id))}>Approve &amp; activate</button>}
              {(o.status === 'Draft' || o.status === 'Active') && <button className="btn" onClick={() => e.cancelOrder(o.id)}>Cancel order</button>}
            </div>
            <table className="grid" style={{ marginTop: 8 }}>
              <thead><tr><th>#</th><th>Action</th><th>Device</th><th>Location</th><th>By</th><th>Loop</th><th>Status</th><th>Time</th><th title="Hold point: stop after this step until the clearance is released">Hold</th><th></th></tr></thead>
              <tbody>
                {o.steps.map((s, i) => {
                  const d = e.T.els[s.dev] as DevEl;
                  return (
                    <Fragment key={i}>
                      <tr className={`steprow ${i === o.cur && o.status === 'Active' ? 'cur' : ''} ${s.status === 'Done' ? 'done' : ''}`}>
                        <td className="mono">{i + 1}</td>
                        <td><ActPill a={s.action} /></td>
                        <td className="mono"><a style={{ cursor: 'pointer', color: 'var(--cyan)' }} onClick={() => setSel({ kind: 'dev', id: s.dev })}>{s.dev}</a> <span className="dim">{devWord(d)}</span></td>
                        <td>{d.loc}</td>
                        <td className="mono">{s.exec === 'SCADA' ? 'SCADA' : `Truck ${s.exec}`}</td>
                        <td>{s.loop ? <span className="badge amber">LOOP</span> : ''}</td>
                        <td>{s.status}{s.note ? <div className="c-red" style={{ fontSize: 10, whiteSpace: 'normal', maxWidth: 260 }}>{s.note}</div> : null}</td>
                        <td className="mono dim">{s.doneT ? e.hhmm(s.doneT) : ''}</td>
                        <td>{o.status !== 'Complete' && o.status !== 'Cancelled'
                          ? <button className={`btn sm ${o.holdAfter === i ? 'on' : ''}`} title="Hold after this step" onClick={() => e.setHold(o.id, i)}>{o.holdAfter === i ? 'HOLD' : 'hold'}</button>
                          : o.holdAfter === i ? <span className="badge cyan">HOLD</span> : null}</td>
                        <td>{o.status !== 'Complete' && s.status === 'Pending' && i >= o.cur && <button className="btn sm" onClick={() => e.removeStep(o.id, i)}>✕</button>}</td>
                      </tr>
                      {o.holdAfter === i && <tr className="hold"><td colSpan={10}>HOLD POINT — work under clearance. Continue only after the crew releases the clearance.</td></tr>}
                    </Fragment>
                  );
                })}
                {o.steps.length === 0 && <tr><td colSpan={10} className="empty">No steps yet.</td></tr>}
              </tbody>
            </table>

            {o.status === 'Active' && step && (
              <div className="rbbox">
                {step.status === 'RepeatBack' ? (
                  <>
                    <div className="dim">{e.s.trucks[step.exec]?.field ? <>Field crew {step.exec} — <b>listen to the read-back on the radio</b> and compare it to the order:</> : <>Truck {step.exec} repeat-back for step {o.cur + 1}:</>}</div>
                    {e.s.trucks[step.exec]?.field && <FieldReadback truck={step.exec} />}
                    {!e.s.trucks[step.exec]?.field && <div className="q">{ACTION_LABEL[step.rbAction!]} {step.rbDev} — {devWord(e.T.els[step.rbDev!] as DevEl)} at {(e.T.els[step.rbDev!] as DevEl).loc}</div>}
                    <div className="dim" style={{ marginBottom: 6 }}>Order says: <b className="mono">{ACTION_LABEL[step.action]} {step.dev}</b>. Compare carefully before confirming.</div>
                    <div className="acts">
                      <SayOr phrase="That's correct, perform"><button className="btn good" onClick={() => run(e.confirmRepeat(o.id, true))}>“That's correct — perform”</button></SayOr>
                      <SayOr phrase={`Negative. Step ${o.cur + 1}: ${step.action} ${step.dev}. Repeat.`}><button className="btn danger" onClick={() => run(e.confirmRepeat(o.id, false))}>“Negative — repeat”</button></SayOr>
                    </div>
                  </>
                ) : step.status === 'Pending' || step.status === 'Failed' ? (
                  <div className="acts" style={{ alignItems: 'center' }}>
                    <span>Next: step {o.cur + 1} — <b className="mono">{ACTION_LABEL[step.action]} {step.dev}</b> by {step.exec === 'SCADA' ? 'SCADA' : `Truck ${step.exec}`}</span>
                    {step.exec === 'SCADA'
                      ? (step.action === 'open' || step.action === 'close'
                        ? <button className="btn pri" onClick={() => openSbo({ dev: step.dev, action: step.action as 'open' | 'close', order: o.id, viaOrder: true })}>Select / operate…</button>
                        : <button className="btn pri" onClick={() => run(e.issueStep(o.id))}>Execute by SCADA</button>)
                      : <SayOr phrase={`Truck ${step.exec}, ${o.id} step ${o.cur + 1}: ${step.action} ${devWord(e.T.els[step.dev] as DevEl)} ${step.dev}${step.loop ? ', loop close' : ''}`}><button className="btn pri" onClick={() => run(e.issueStep(o.id))}>Issue by radio</button></SayOr>}
                    {err && <div className="c-red" style={{ width: '100%', fontSize: 11 }}>{err}</div>}
                  </div>
                ) : (
                  <div className="dim">Step {o.cur + 1}: {step.status === 'Issued' ? 'awaiting repeat-back…' : (e.s.trucks[step.exec]?.field ? `Field crew ${step.exec} cleared — waiting for them to tap the tag at ${step.rbDev}, operate, and set the flag.` : `Truck ${step.exec} performing ${step.action} ${step.rbDev} — wait for report.`)}</div>
                )}
              </div>
            )}

            {(o.status === 'Draft' || o.status === 'Active') && (
              <>
                <div className="sec-t">Add step</div>
                <div className="form-row">
                  <select value={actionsFor(e.T.els[dev] as DevEl).includes(action) ? action : actionsFor(e.T.els[dev] as DevEl)[0]} onChange={ev => setAction(ev.target.value as SwAction)}>{actionsFor(e.T.els[dev] as DevEl).map(a => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}</select>
                  <input list="devlist" placeholder="Device ID" value={dev} onChange={ev => setDev(ev.target.value.toUpperCase())} style={{ width: 110 }} />
                  <datalist id="devlist">{devList.map(id => <option key={id} value={id}>{(e.T.els[id] as DevEl).loc}</option>)}</datalist>
                  <select value={exec} onChange={ev => setExec(ev.target.value)}>
                    <option value="SCADA">SCADA</option>
                    {Object.keys(e.s.trucks).map(t => <option key={t} value={t}>Truck {t}</option>)}
                  </select>
                  <label style={{ display: 'flex', gap: 3, alignItems: 'center' }}><input type="checkbox" checked={loop} onChange={ev => setLoop(ev.target.checked)} />Loop close (planned parallel)</label>
                  <button className="btn" onClick={() => { const acts = actionsFor(e.T.els[dev] as DevEl); run(e.addStep(o.id, dev, acts.includes(action) ? action : acts[0], exec, loop)); setLoop(false); }}>Add</button>
                </div>
                {dev && e.T.els[dev] && <div className="dim" style={{ fontSize: 10.5 }}>{dev}: {devWord(e.T.els[dev] as DevEl)} at {(e.T.els[dev] as DevEl).loc} · currently {(e.T.els[dev] as DevEl).type === 'reg' ? `tap ${e.s.dev[dev].tap ? (e.s.dev[dev].tap! > 0 ? e.s.dev[dev].tap + 'R' : -e.s.dev[dev].tap! + 'L') : 'NEUTRAL'}, control ${e.s.dev[dev].ctl?.toUpperCase()}` : `${e.s.dev[dev].open ? 'OPEN' : 'CLOSED'}${e.s.dev[dev].ctl ? `, control ${e.s.dev[dev].ctl!.toUpperCase()}` : ''}${e.s.dev[dev].nonReclose ? ', reclosing BLOCKED' : ''}`}{(e.T.els[dev] as DevEl).scada ? ' · SCADA' : ' · manual only'}{e.s.dev[dev].tags.length ? ` · HOLD ${e.s.dev[dev].tags.join(',')}` : ''}</div>}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Latest voice read-back(s) from a field crew, to play before confirming. */
function FieldReadback({ truck }: { truck: string }) {
  const items = useRadio();
  const recent = items.filter(x => x.from === truck && Date.now() - x.at < 5 * 60_000).slice(-2).reverse();
  if (!recent.length) return <div className="q dim">Waiting for Truck {truck} to read it back (voice clip on the field radio)…</div>;
  return (
    <div className="q" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {recent.map((it, i) => <span key={it.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        {i === 0 ? 'Read-back:' : 'Earlier:'}
        {it.audio ? <button className="btn sm" onClick={() => playClip(it.audio!)}>▶ {Math.round(it.dur ?? 0)}s · {it.clock}</button> : null}
        {it.text ? <span>"{it.text}"</span> : null}
      </span>)}
    </div>
  );
}
