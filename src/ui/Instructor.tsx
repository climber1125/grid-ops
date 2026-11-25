// Instructor tools: build a switching exercise to send to a student, and open the report they send back.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Engine } from '../sim/engine';
import { TOPO } from '../sim/topology';
import type { DevEl } from '../sim/types';
import { devWord, ACTION_LABEL } from '../sim/radio';
import type { SwAction } from '../sim/types';

/** Pill for an action: open = green outline, close = red, controls = cyan. */
export function ActPill({ a }: { a: SwAction }) {
  return <span className={`state ${a === 'open' ? 'open' : a === 'close' ? 'closed' : 'ctl'}`}>{ACTION_LABEL[a]}</span>;
}
import { sectionAround } from '../sim/network';
import {
  listSections, listBypassable, generateExercise, encodeExercise, referenceOrder, checkOrder, workLocation, WORK_TYPES, BYPASS_WORK,
  RULE_PRESETS, RULE_TEXT, DEFAULT_RULES,
  type ExerciseDef, type ExReport, type Finding, type OrderCheck, type CompanyRules, type RuleLevel,
} from '../sim/exercise';

export function exerciseLink(def: ExerciseDef) {
  const u = new URL(window.location.href);
  u.search = ''; u.searchParams.set('ex', encodeExercise(def));
  return u.toString();
}

export function download(obj: unknown, name: string) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const ICON: Record<Finding['level'], string> = { fail: '✗', warn: '!', info: 'i', pass: '✓' };
const CLS: Record<Finding['level'], string> = { fail: 'c-red', warn: 'c-amber', info: 'dim', pass: 'c-green' };
export function FindingsList({ check, hidePass }: { check: OrderCheck; hidePass?: boolean }) {
  const order = { fail: 0, warn: 1, info: 2, pass: 3 } as const;
  const f = [...check.findings].filter(x => !hidePass || x.level !== 'pass').sort((a, b) => order[a.level] - order[b.level]);
  return (
    <div className="findings">
      <div style={{ marginBottom: 4 }}><span className={`badge ${check.verdict === 'pass' ? 'green' : 'red'}`}>{check.verdict === 'pass' ? 'WOULD WORK' : 'PROBLEMS FOUND'}</span>
        <span className="dim" style={{ marginLeft: 8, fontSize: 11 }}>{check.workCustomers} customers in the work section · {check.outsideOutAtIso} outside out once isolated (best possible {check.minOutside}){check.momentary ? ` · ${check.momentary} blink` : ''}</span></div>
      {f.map((x, i) => <div key={i} className={`fnd ${x.level}`}><b className={CLS[x.level]} style={{ width: 14, display: 'inline-block' }}>{ICON[x.level]}</b> {x.text}</div>)}
    </div>
  );
}

function StepsTable({ steps, holdAfter }: { steps: { dev: string; action: string; exec: string; loop: boolean }[]; holdAfter?: number }) {
  return (
    <table className="grid" style={{ margin: '4px 0 8px' }}>
      <thead><tr><th>#</th><th>Action</th><th>Device</th><th>Location</th><th>By</th><th>Loop</th></tr></thead>
      <tbody>
        {steps.map((s, i) => {
          const d = TOPO.els[s.dev] as DevEl | undefined;
          return (
            <tr key={i} className={holdAfter === i ? 'holdrow' : ''}>
              <td className="mono">{i + 1}</td>
              <td><ActPill a={s.action as SwAction} /></td>
              <td className="mono">{s.dev} <span className="dim">{devWord(d)}</span></td>
              <td>{d?.loc}</td>
              <td className="mono">{s.exec === 'SCADA' ? 'SCADA' : `Truck ${s.exec}`}</td>
              <td>{s.loop ? <span className="badge amber">LOOP</span> : ''}{holdAfter === i ? <span className="badge cyan" style={{ marginLeft: 4 }}>HOLD AFTER</span> : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Create exercise ─────────────────────────────────────────
const LEVEL_TEXT: Record<RuleLevel, string> = { fail: 'Required / not allowed (fail)', warn: 'Flag it (warning)', off: 'Not graded' };
const CROSS_TEXT: Record<RuleLevel, string> = { fail: 'Not allowed — break-before-make only', warn: 'Allowed with approval (flagged)', off: 'Allowed' };

function RulesEditor({ rules, setRules, preset, setPreset }: { rules: CompanyRules; setRules(r: CompanyRules): void; preset: string; setPreset(p: string): void }) {
  return (
    <>
      <label>Company rules</label>
      <div>
        <select value={preset} onChange={ev => { setPreset(ev.target.value); if (RULE_PRESETS[ev.target.value]) setRules(RULE_PRESETS[ev.target.value].rules); }}>
          {Object.entries(RULE_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}<option value="custom">Custom</option>
        </select>
        <span className="dim" style={{ marginLeft: 8, fontSize: 11 }}>{RULE_PRESETS[preset]?.about ?? 'Your own mix of the rules below.'}</span>
      </div>
      {(Object.keys(RULE_TEXT) as (keyof CompanyRules)[]).map(k => (
        <Fragment key={k}>
          <label style={{ paddingLeft: 12 }}>{RULE_TEXT[k]}</label>
          <select value={rules[k]} onChange={ev => { setPreset('custom'); setRules({ ...rules, [k]: ev.target.value as RuleLevel }); }}>
            {(['fail', 'warn', 'off'] as RuleLevel[]).map(l => <option key={l} value={l}>{k === 'crossSub' ? CROSS_TEXT[l] : LEVEL_TEXT[l]}</option>)}
          </select>
        </Fragment>
      ))}
    </>
  );
}

function CreateExercise({ onStartHere }: { onStartHere(def: ExerciseDef): void }) {
  const eng = useMemo(() => Engine.create('A', 1), []);
  const sections = useMemo(() => listSections(TOPO), []);
  const equipment = useMemo(() => listBypassable(TOPO), []);
  const [kind, setKind] = useState<'isolate' | 'bypass'>('isolate');
  const [feeder, setFeeder] = useState(TOPO.feederIds[0]);
  const fsecs = sections.filter(s => s.feeder === feeder);
  const [secKey, setSecKey] = useState(fsecs[0]?.key ?? '');
  const sec = sections.find(s => s.key === secKey && s.feeder === feeder) ?? fsecs[0];
  const [equip, setEquip] = useState('VR-3117');
  const eq = equipment.find(x => x.id === equip) ?? equipment[0];
  const [work, setWork] = useState(WORK_TYPES[0]);
  const [truck, setTruck] = useState('233');
  const [minutes, setMinutes] = useState(15);
  const [coach, setCoach] = useState(false);
  const [notes, setNotes] = useState('');
  const [preset, setPreset] = useState('standard');
  const [rules, setRules] = useState<CompanyRules>(DEFAULT_RULES);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exId] = useState(() => 'EX-' + Math.floor(1000 + Math.random() * 9000));
  const [genDef, setGenDef] = useState<ExerciseDef | null>(null);
  const workList = kind === 'bypass' ? BYPASS_WORK[eq.type as 'reg' | 'recloser'] : WORK_TYPES;
  const rulesName = RULE_PRESETS[preset]?.name ?? 'Custom';

  const def: ExerciseDef | null = genDef ?? (kind === 'bypass'
    ? { v: 1, id: exId, title: `Bypass ${eq.id}`, kind, feeder: eq.feeder, workEl: eq.id, work: workList.includes(work) || !WORK_TYPES.includes(work) ? work : workList[0], truck, minutes, coach, by: 'instructor', notes: notes.trim() || undefined, rules, rulesName }
    : sec ? { v: 1, id: exId, title: `${work} on ${sec.feeder}`, kind, feeder: sec.feeder, workEl: sec.el, work, truck, minutes, coach, by: 'instructor', notes: notes.trim() || undefined, rules, rulesName } : null);
  const sig = JSON.stringify([def?.kind, def?.workEl, def?.truck, def?.rules]);
  const ref = useMemo(() => (def ? referenceOrder(eng, def) : null), [eng, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const refCheck = useMemo(() => (def && ref ? checkOrder(eng, def, ref.steps, ref.holdAfter) : null), [ref]); // eslint-disable-line react-hooks/exhaustive-deps
  const link = def ? exerciseLink(def) : '';
  const loc = def ? workLocation(eng, def).loc : '';
  const edit = <T,>(f: (v: T) => void) => (v: T) => { setGenDef(null); f(v); };

  return (
    <div>
      <div className="form-grid">
        <label>Job</label>
        <select value={kind} onChange={ev => { const k = ev.target.value as 'isolate' | 'bypass'; edit(setKind)(k); setWork(k === 'bypass' ? BYPASS_WORK[eq.type as 'reg' | 'recloser'][0] : WORK_TYPES[0]); }}>
          <option value="isolate">Isolate a section of line for a crew</option>
          <option value="bypass">Take a regulator or recloser out of service (no outage)</option>
        </select>
        {kind === 'isolate' ? <>
          <label>Feeder</label>
          <select value={feeder} onChange={ev => edit(setFeeder)(ev.target.value)}>{TOPO.feederIds.map(f => <option key={f}>{f}</option>)}</select>
          <label>Section to isolate</label>
          <select value={sec?.key} onChange={ev => edit(setSecKey)(ev.target.value)}>{fsecs.map(s => <option key={s.key} value={s.key}>{s.label.slice(s.feeder.length + 2)}</option>)}</select>
        </> : <>
          <label>Equipment</label>
          <select value={eq.id} onChange={ev => { const x = equipment.find(q => q.id === ev.target.value)!; edit(setEquip)(x.id); setWork(BYPASS_WORK[x.type as 'reg' | 'recloser'][0]); }}>{equipment.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        </>}
        <label>Work</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={workList.includes(work) ? work : '__c'} onChange={ev => edit(setWork)(ev.target.value === '__c' ? '' : ev.target.value)}>{workList.map(w => <option key={w}>{w}</option>)}<option value="__c">Custom…</option></select>
          {!workList.includes(work) && <input placeholder="Describe the work" value={work} onChange={ev => edit(setWork)(ev.target.value)} style={{ flex: 1 }} />}
        </div>
        <label>Crew on site</label>
        <select value={truck} onChange={ev => edit(setTruck)(ev.target.value)}>
          <option value="230">230 — veteran</option><option value="233">233 — journeyman</option><option value="240">240 — journeyman</option><option value="238">238 — apprentice (more wrong read-backs)</option>
        </select>
        <label>Time under clearance</label>
        <select value={minutes} onChange={ev => edit(setMinutes)(Number(ev.target.value))}>{[10, 15, 20, 30, 45].map(m => <option key={m} value={m}>{m} min (sim time)</option>)}</select>
        <RulesEditor rules={rules} setRules={r => { setGenDef(null); setRules(r); }} preset={preset} setPreset={setPreset} />
        <label>Coach mode</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={coach} onChange={ev => edit(setCoach)(ev.target.checked)} /> Show the check to the student when they submit (off = only you see it)</label>
        <label>Note to student</label>
        <input placeholder="Optional" value={notes} onChange={ev => edit(setNotes)(ev.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
        <button className="btn" onClick={() => setGenDef({ ...generateExercise(TOPO, Math.random, rules), coach, minutes, notes: notes.trim() || undefined, rulesName })}>Random job</button>
        {genDef && <span className="dim" style={{ alignSelf: 'center' }}>Random: {genDef.work} — {genDef.kind === 'bypass' ? genDef.workEl : genDef.feeder} (crew {genDef.truck}). Change any field above to go back to your own pick.</span>}
      </div>
      {def && <>
        <div className="sec-t">Exercise {def.id} · {def.rulesName ?? 'Standard'} rules</div>
        <div style={{ fontSize: 12 }}>{def.work} — {def.kind === 'bypass' ? <>take <b>{def.workEl}</b> out of service on {def.feeder} with no outage</> : <>on <b>{def.feeder}</b>, section {sections.find(s => s.key === [...sectionAround(TOPO, def.workEl).bounds].sort().join('|'))?.label.slice(def.feeder.length + 2) ?? ''}</>}. Crew {def.truck} on site at {loc}.</div>
        <div className="form-row" style={{ marginTop: 6 }}>
          <input readOnly value={link} style={{ flex: 1 }} className="mono" onFocus={ev => ev.target.select()} />
          <button className="btn pri" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select manually */ } }}>{copied ? 'Copied' : 'Copy link'}</button>
          <button className="btn" onClick={() => onStartHere(def)}>Start it here</button>
        </div>
        <div className="dim" style={{ fontSize: 11 }}>Text or email this link to the student. When they finish they download a report file and send it to you; open it under "Open a report".</div>
        <div className="sec-t" style={{ cursor: 'pointer' }} onClick={() => setShowKey(!showKey)}>{showKey ? '▾' : '▸'} Answer key (one correct order under these rules)</div>
        {showKey && ref && refCheck && <><StepsTable steps={ref.steps} holdAfter={ref.holdAfter} /><FindingsList check={refCheck} /></>}
      </>}
    </div>
  );
}

// ── Report viewer ───────────────────────────────────────────
const yes = (b: boolean) => <b className={b ? 'c-green' : 'c-red'}>{b ? 'Yes' : 'No'}</b>;
export function ReportView({ r }: { r: ExReport }) {
  useEffect(() => {
    const open = () => document.querySelectorAll<HTMLDetailsElement>('.report details').forEach(d => { d.open = true; });
    window.addEventListener('beforeprint', open);
    return () => window.removeEventListener('beforeprint', open);
  }, []);
  const o = r.outcome;
  const dt = (s: string) => new Date(s).toLocaleString();
  return (
    <div className="report">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{r.student} — {r.def.work} on {r.def.feeder}</div>
          <div className="dim" style={{ fontSize: 11.5 }}>{r.def.kind === 'bypass' ? `Bypass ${r.def.workEl} · ` : ''}{r.def.rulesName ?? 'Standard'} rules ({(Object.keys(RULE_TEXT) as (keyof CompanyRules)[]).map(k => `${RULE_TEXT[k].toLowerCase()}: ${r.rules?.[k] ?? 'warn'}`).join(', ')})</div>
          <div className="dim" style={{ fontSize: 11.5 }}>Exercise {r.def.id} · crew {r.def.truck} at {r.work.loc} · isolation points {[...r.work.bounds, ...r.work.vis].join(', ')} · {r.work.customers} customers in the section</div>
          <div className="dim" style={{ fontSize: 11.5 }}>Started {dt(r.startedWall)} · finished {dt(r.finishedWall)} · {r.simMinutes} min sim time</div>
        </div>
        <span className={`badge big ${r.verdict === 'pass' ? 'green' : r.verdict === 'notes' ? 'amber' : 'red'}`}>{r.verdict === 'pass' ? 'PASS' : r.verdict === 'notes' ? 'PASS — WITH NOTES' : 'FAIL'}</span>
      </div>

      <div className="sec-t">Did it work?</div>
      <div className="kv" style={{ gridTemplateColumns: 'repeat(4, auto 1fr)' }}>
        <span className="k">Section isolated</span><span className="v">{yes(o.isolatedOk)}{o.timeToIsolateMin !== null ? ` · ${o.timeToIsolateMin} min` : ''}</span>
        <span className="k">Clearance issued</span><span className="v">{yes(o.clearanceIssued)}{r.clearances[0] ? ` · ${r.clearances[0].issued}` : ''}</span>
        <span className="k">Clearance released</span><span className="v">{yes(o.clearanceReleased)}{r.clearances[0]?.released ? ` · ${r.clearances[0].released}` : ''}</span>
        <span className="k">Back to normal</span><span className="v">{yes(o.returnedNormal)}</span>
        <span className="k">Safety violations</span><span className={`v ${o.violations ? 'c-red' : 'c-green'}`}>{o.violations}</span>
        <span className="k">Wrong read-backs</span><span className="v">{o.wrongRepeatsCaught} caught · <span className={o.wrongRepeatsMissed ? 'c-red' : ''}>{o.wrongRepeatsMissed} missed</span></span>
        <span className="k">Customers hit outside the section</span><span className={`v ${r.unplanned.customers ? 'c-red' : 'c-green'}`}>{r.unplanned.customers}{r.unplanned.cmi ? ` · ${r.unplanned.cmi} cust-min` : ''}</span>
        <span className="k">Orders submitted</span><span className="v">{r.submissions.length}</span>
      </div>
      {r.violations.length > 0 && <div style={{ marginTop: 6 }}>{r.violations.map((v, i) => <div key={i} className="fnd fail"><b className="c-red">✗</b> {v.t} — {v.text}</div>)}</div>}

      <div className="sec-t">Would it have worked? (order as written, checked at submit)</div>
      {r.submissions.length === 0 && <div className="empty">No order was submitted.</div>}
      {r.submissions.map((s, i) => (
        <div key={i} className="subm">
          <div><b className="mono">{s.order}</b> {s.title} <span className="dim">— submission {i + 1}</span></div>
          <StepsTable steps={s.steps} holdAfter={s.holdAfter} />
          <FindingsList check={s.check} />
        </div>
      ))}

      <div className="sec-t">How it was executed</div>
      {r.orders.map(ord => (
        <div key={ord.id} className="subm">
          <div><b className="mono">{ord.id}</b> {ord.title} <span className="badge">{ord.status}</span></div>
          <table className="grid" style={{ marginTop: 4 }}>
            <thead><tr><th>#</th><th>Step</th><th>What happened</th></tr></thead>
            <tbody>
              {ord.steps.map((s, i) => (
                <tr key={i} className={ord.holdAfter === i ? 'holdrow' : ''}>
                  <td className="mono">{i + 1}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{ACTION_LABEL[s.action]} {s.dev}{s.loop ? ' (LOOP)' : ''}<div className="dim">{s.exec === 'SCADA' ? 'SCADA' : `Truck ${s.exec}`} · {s.status}</div></td>
                  <td style={{ whiteSpace: 'normal' }}>{(s.log ?? []).map((l, j) => <div key={j} className={l.ok === false ? 'c-red' : ''}><span className="dim mono">{fmtT(r, l.t)}</span> {l.ev}</div>)}{!s.log?.length && <span className="dim">Not run</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="sec-t">Every device operation, in order (replayed and checked)</div>
      <table className="grid">
        <thead><tr><th>Time</th><th>Operation</th><th>By</th><th>Order</th></tr></thead>
        <tbody>{r.ops.map((x, i) => <tr key={i} className={r.executedCheck.isolatedAt === i ? 'holdrow' : ''}><td className="mono">{fmtT(r, x.t)}</td><td className="mono">{ACTION_LABEL[x.action]} {x.dev}</td><td>{x.by === 'SCADA' ? 'SCADA' : `Truck ${x.by}`}</td><td className="mono dim">{x.order ?? 'outside an order'}</td></tr>)}</tbody>
      </table>
      <FindingsList check={r.executedCheck} hidePass />

      <div className="sec-t">Decisions log</div>
      <div className="declog">{r.decisions.map((d, i) => <div key={i} className={d.good === false ? 'c-red' : d.good ? 'c-green' : ''}><span className="dim mono">{d.t}</span> {d.text}</div>)}</div>

      <details className="sec-d"><summary className="sec-t">Answer key (one correct order)</summary>
        <StepsTable steps={r.reference.steps} holdAfter={r.reference.holdAfter} /><FindingsList check={r.reference.check} />
      </details>
      <details className="sec-d"><summary className="sec-t">Radio — switching traffic</summary>
        <div className="declog">{r.radio.map((m, i) => <div key={i}><span className="dim mono">{m.t}</span> <b>{m.from === 'C' ? 'Control' : m.from}:</b> {m.text}</div>)}</div>
      </details>
    </div>
  );
}
function fmtT(r: ExReport, t: number) {
  // Report times are sim seconds from shift start (shift starts 14:00 by default in the clock); show mm:ss into the exercise.
  void r; const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `+${m}:${String(s).padStart(2, '0')}`;
}

function OpenReport() {
  const [r, setR] = useState<ExReport | null>(null);
  const [err, setErr] = useState('');
  const load = async (f: File | undefined) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.kind !== 'sparks-switching-report') throw new Error('Not a GRID OPS switching report');
      setR(j); setErr('');
    } catch (ex: any) { setErr(ex.message ?? 'Could not read that file'); }
  };
  return (
    <div onDragOver={ev => ev.preventDefault()} onDrop={ev => { ev.preventDefault(); load(ev.dataTransfer.files[0]); }}>
      <div className="form-row no-print">
        <input type="file" accept=".json,application/json" onChange={ev => load(ev.target.files?.[0])} />
        {r && <button className="btn" onClick={() => window.print()}>Print / save PDF</button>}
        <span className="dim">or drop the file here</span>
      </div>
      {err && <div className="c-red">{err}</div>}
      {r ? <ReportView r={r} /> : <div className="empty" style={{ padding: 30 }}>Open the report file the student sent you.</div>}
    </div>
  );
}

export function InstructorModal({ onClose, onStartExercise }: { onClose(): void; onStartExercise(def: ExerciseDef): void }) {
  const [tab, setTab] = useState<'create' | 'report'>('create');
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide printable" onClick={ev => ev.stopPropagation()} style={{ maxWidth: 1100 }}>
        <div className="mh no-print"><span className="t">Instructor — switching exercises</span>
          <button className={`tab ${tab === 'create' ? 'on' : ''}`} onClick={() => setTab('create')}>Create exercise</button>
          <button className={`tab ${tab === 'report' ? 'on' : ''}`} onClick={() => setTab('report')}>Open a report</button>
          <span style={{ flex: 1 }} /><button className="btn sm" onClick={onClose}>✕</button></div>
        <div className="mb">{tab === 'create' ? <CreateExercise onStartHere={onStartExercise} /> : <OpenReport />}</div>
      </div>
    </div>
  );
}
