// ─────────────────────────────────────────────────────────────
// Crew phone app (one phone per crew, carried by the foreman).
//   /field            join, status, jobs, switching steps, clearances, yard map
//   /t/<ID>           opened by tapping a device's or job pole's NFC tag / scanning its QR
//   /field/tags       instructor: printable QR labels + NFC tag writer (Android)
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { FieldStatus, FromCrew, SwAction, ToCrew } from '../sim/types';
import {
  YARD_FEEDERS, YARD_TIES, YARD_AREAS, LINE_POLES, ALL_POLES, JOB_POLES, YARD_PARKING,
  yardDeviceList, areaOfPole, isLinePole, type YardDevice,
} from '../sim/texasYard';
import { cleanCode, getBackend, useLocalBackend, type YardSnap } from './backend';
import './field.css';

type XY = [number, number];
const DEVS = yardDeviceList();
const DEV = Object.fromEntries(DEVS.map(d => [d.id, d])) as Record<string, YardDevice>;
const ACT: Record<SwAction, string> = { open: 'OPEN', close: 'CLOSE', manual: 'SET TO MANUAL', auto: 'SET TO AUTO', neutral: 'SET TO NEUTRAL', 'nr-on': 'NON-RECLOSE ON', 'nr-off': 'NON-RECLOSE OFF' } as Record<SwAction, string>;
const DONE_WORD: Partial<Record<SwAction, string>> = { open: 'OPENED', close: 'CLOSED' };
const isTagId = (id: string) => !!DEV[id] || !!ALL_POLES[id];

interface Me { code: string; truck: string; foreman: string; members: string[]; }
const ME_KEY = 'gridops-crew';
const loadMe = (): Me | null => { try { return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null'); } catch { return null; } };
const saveMe = (m: Me | null) => { try { m ? localStorage.setItem(ME_KEY, JSON.stringify(m)) : localStorage.removeItem(ME_KEY); } catch { /* private mode */ } };
const evId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export default function FieldApp() {
  const path = location.pathname;
  useLocalBackend(); // remember ?fieldlocal
  if (path.startsWith('/field/tags')) return <TagLabels />;
  const tagId = path.startsWith('/t/') ? decodeURIComponent(path.slice(3)).toUpperCase().replace(/\/$/, '') : null;
  const how = new URLSearchParams(location.search).get('s') === 'q' ? 'qr' : 'nfc';
  return <CrewApp tagId={tagId && isTagId(tagId) ? tagId : null} badTag={tagId && !isTagId(tagId) ? tagId : null} how={how} />;
}

/** Device + pole picker used for status and clearance location. */
function PlacePicker({ value, onChange, linesOnly = false }: { value: string; onChange(v: string): void; linesOnly?: boolean }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      <optgroup label="Devices">{DEVS.map(d => <option key={d.id} value={d.id}>{d.id} — {d.kind}, pole {d.pole}</option>)}</optgroup>
      <optgroup label="Line poles">{Object.keys(LINE_POLES).map(p => <option key={p} value={p}>{p} — line pole</option>)}</optgroup>
      {!linesOnly && <optgroup label="Job poles">{JOB_POLES.filter(p => !isLinePole(p)).map(p => <option key={p} value={p}>{p} — {areaOfPole(p)?.name}</option>)}</optgroup>}
    </select>
  );
}

// ── Crew app ────────────────────────────────────────────────
function CrewApp({ tagId, badTag, how }: { tagId: string | null; badTag: string | null; how: 'nfc' | 'qr' }) {
  const [me, setMe] = useState<Me | null>(loadMe);
  const [inbox, setInbox] = useState<ToCrew[]>([]);
  const [snap, setSnap] = useState<YardSnap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(tagId);
  const [tab, setTab] = useState<'now' | 'map' | 'log'>('now');
  const be = getBackend();

  useEffect(() => {
    if (!me) return;
    const a = be.onInbox(me.code, me.truck, m => setInbox([...m].sort((x, y) => x.t - y.t || x.id.localeCompare(y.id))));
    const b = be.onState(me.code, setSnap);
    return () => { a(); b(); };
  }, [me?.code, me?.truck]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(x => (x === t ? null : x)), 3500); };
  const send = (ev: Omit<FromCrew, 'id' | 'truck' | 't'>) => {
    if (!me) return;
    be.sendFromCrew(me.code, { id: evId(), truck: me.truck, t: 0, ...ev } as FromCrew).catch(e => setErr(e?.message ?? String(e)));
  };

  // A tag scan puts the crew on site there.
  const tagged = useRef(false);
  useEffect(() => {
    if (!me || !tagId || tagged.current) return;
    tagged.current = true;
    send({ kind: 'status', status: 'On site', at: tagId });
  }, [me, tagId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return <JoinScreen onJoined={m => { saveMe(m); setMe(m); }} tagId={tagId} />;

  const mine = snap?.trucks?.[me.truck];
  const status = (mine?.status ?? 'At yard') as FieldStatus;
  const steps = inbox.filter(m => m.kind === 'step');
  const curStep = [...steps].reverse().find(m => m.state === 'issued' || m.state === 'repeat' || m.state === 'cleared');
  const dispatch = [...inbox].reverse().find(m => m.kind === 'dispatch' && m.state === 'issued');
  const cl = [...inbox].reverse().find(m => m.kind === 'clearance');
  const holding = cl && cl.state === 'issued' ? cl : null;
  const jobs = inbox.filter(m => m.kind === 'job' && m.state === 'issued');
  const infos = inbox.filter(m => m.kind === 'info' && !(m.id.endsWith('-welcome') && inbox.some(x => x.kind !== 'info'))).slice(-2);
  const closeTag = () => { setTag(null); history.replaceState(null, '', '/field'); };
  const jobAct = (j: ToCrew, jstep: 'ack' | 'working' | 'complete') => {
    send({ kind: 'job', job: j.job, jstep });
    flash(jstep === 'ack' ? `${j.job} acknowledged` : jstep === 'working' ? `${j.job}: work started` : `${j.job} reported complete`);
  };

  return (
    <div className="fa">
      <header className="fa-top">
        <div><b>Truck {me.truck}</b> <span className="dim">· {me.foreman}</span></div>
        <div className="dim mono">{me.code}{be.kind === 'local' ? ' · LOCAL TEST' : ''}{snap ? ` · ${snap.clock}` : ''}</div>
      </header>
      {err && <div className="fa-err" onClick={() => setErr(null)}>{err}</div>}
      {badTag && <div className="fa-err">Tag {badTag} is not on the Texas yard map. Tell your instructor.</div>}
      {toast && <div className="fa-toast">{toast}</div>}

      {tag && DEV[tag] && <TagCard dev={tag} how={how} curStep={curStep} snap={snap} onClose={closeTag}
        onOperate={(action, verified, wrong) => {
          send({ kind: 'operate', dev: tag, action, verified, tag: how });
          flash(wrong ? `Reported ${ACT[action]} ${tag} — the operator will see this was not your cleared step` : `Reported ${DONE_WORD[action] ?? ACT[action]} ${tag}`);
          closeTag();
        }} />}
      {tag && !DEV[tag] && <PoleTagCard pole={tag} how={how} job={jobs.find(j => j.pole === tag)} holding={!!holding} onClose={closeTag} onAct={(j, s) => { jobAct(j, s); closeTag(); }} />}

      {!tag && tab === 'now' && <>
        {infos.map(m => <div key={m.id} className="fa-card info">{m.text}</div>)}
        <StepCard m={curStep} onManualTag={() => curStep?.dev && setTag(curStep.dev)} />
        {jobs.map(j => <JobCard key={j.id} j={j} holding={!!holding} onAct={s => jobAct(j, s)} onEnRoute={() => { send({ kind: 'status', status: 'En route', dest: j.pole }); flash(`En route to ${j.pole}`); }} onNoTag={() => { send({ kind: 'status', status: 'On site', at: j.pole }); setTag(j.pole!); }} />)}
        {!curStep && !jobs.length && <div className="fa-card dim">No work order or switching step for you right now. Keep your status current.</div>}
        {dispatch && !curStep && <div className="fa-card dispatch"><div className="lbl">DISPATCH</div><div className="big">{dispatch.text}</div></div>}
        <StatusCard status={status} at={mine?.at ?? 'yard'} dest={mine?.dest ?? dispatch?.dev} onSet={(st, dev) => {
          send(st === 'At yard' ? { kind: 'status', status: st, at: 'yard' } : st === 'En route' ? { kind: 'status', status: st, dest: dev } : { kind: 'status', status: st, at: dev });
          flash(st === 'At yard' ? 'Status: at the yard' : st === 'En route' ? `Status: en route to ${dev}` : `Status: ${st.toLowerCase()} at ${dev}`);
        }} />
        <ClearanceCard holding={holding} last={cl} at={mine?.at} onRequest={(dev, why) => { send({ kind: 'clearance', dev, text: why }); flash('Clearance requested — wait for the operator to issue it'); }}
          onRelease={() => { send({ kind: 'release' }); flash('Release sent — wait for the operator to acknowledge'); }} />
        <NoteCard onSend={t => { send({ kind: 'note', text: t }); flash('Note sent'); }} />
      </>}
      {!tag && tab === 'map' && <YardMap snap={snap} me={me.truck} jobs={jobs} />}
      {!tag && tab === 'log' && <div className="fa-card">{inbox.length ? [...inbox].reverse().map(m => <div key={m.id} className="logline"><span className={`st ${m.state}`}>{m.kind === 'step' ? `STEP ${m.step}` : m.kind === 'job' ? `${m.job} · ${m.jobStatus}` : m.kind.toUpperCase()} · {m.state}</span> {m.text}</div>) : <div className="dim">Nothing yet.</div>}
        <button className="fa-btn ghost" onClick={() => { if (confirm('Leave this session on this phone?')) { saveMe(null); setMe(null); } }}>Leave session</button></div>}

      <nav className="fa-nav">
        {(['now', 'map', 'log'] as const).map(t => <button key={t} className={tab === t && !tag ? 'on' : ''} onClick={() => { setTag(null); setTab(t); }}>{t === 'now' ? 'Orders' : t === 'map' ? 'Yard map' : 'Log'}</button>)}
      </nav>
    </div>
  );
}

function JoinScreen({ onJoined, tagId }: { onJoined(m: Me): void; tagId: string | null }) {
  const q = new URLSearchParams(location.search);
  const prev = loadMe();
  const [code, setCode] = useState(cleanCode(q.get('code') ?? prev?.code ?? ''));
  const [truck, setTruck] = useState(prev?.truck ?? '');
  const [foreman, setForeman] = useState(prev?.foreman ?? '');
  const [members, setMembers] = useState<string[]>(prev?.members?.length ? prev.members : ['', '']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const be = getBackend();
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const m: Me = { code: cleanCode(code), truck: truck.trim(), foreman: foreman.trim(), members: members.map(x => x.trim()).filter(Boolean) };
      if (m.code.length !== 6) throw new Error(`The session code is 6 letters/numbers (you have ${m.code.length}). It's the big code in the instructor's Field tab.`);
      if (!/^\d{2,4}$/.test(m.truck)) throw new Error('Truck number: 2–4 digits.');
      if (!m.foreman) throw new Error('Enter the foreman\'s name.');
      if (!(await be.sessionOpen(m.code))) throw new Error('No open session with that code. Check with your instructor.');
      await be.join(m.code, { truck: m.truck, foreman: m.foreman, members: m.members, t: Date.now() }, { id: evId(), truck: m.truck, t: 0, kind: 'join', foreman: m.foreman, members: m.members });
      onJoined(m);
    } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="fa">
      <header className="fa-top"><div><b>Sparks Command</b> <span className="dim">· Field crew</span></div><div className="dim">{be.kind === 'local' ? 'LOCAL TEST' : 'NLC Texas yard'}</div></header>
      {tagId && <div className="fa-card info">You scanned {tagId}. Join your crew's session first.</div>}
      <div className="fa-card">
        <label>Session code<input className="mono big" value={code} onChange={e => setCode(cleanCode(e.target.value))} placeholder="ABC123" autoCapitalize="characters" inputMode="text" /></label>
        <label>Truck number<input className="mono" value={truck} onChange={e => setTruck(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="250" inputMode="numeric" /></label>
        <label>Foreman<input value={foreman} onChange={e => setForeman(e.target.value)} placeholder="Name" autoComplete="name" /></label>
        <div className="lbl">Crew</div>
        {members.map((m, i) => <input key={i} value={m} placeholder={`Crew member ${i + 1}`} onChange={e => setMembers(ms => ms.map((x, j) => (j === i ? e.target.value : x)))} />)}
        {members.length < 6 && <button className="fa-btn ghost" onClick={() => setMembers(ms => [...ms, ''])}>+ Add crew member</button>}
        {err && <div className="fa-err">{err}</div>}
        <button className="fa-btn pri" disabled={busy} onClick={go}>{busy ? 'Joining…' : 'Join session'}</button>
      </div>
    </div>
  );
}

function JobCard({ j, holding, onAct, onEnRoute, onNoTag }: { j: ToCrew; holding: boolean; onAct(s: 'ack' | 'working' | 'complete'): void; onEnRoute(): void; onNoTag(): void }) {
  const st = j.jobStatus;
  return (
    <div className={`fa-card job ${st === 'Working' ? 'working' : ''}`}>
      <div className="lbl">WORK ORDER {j.job} · {st}</div>
      <div className="big">{j.text}</div>
      {j.needsClearance && <div className="fa-warn small">On the line — do not start until you hold a clearance that covers {j.pole}.</div>}
      {st === 'Assigned' && <button className="fa-btn pri" onClick={() => onAct('ack')}>Acknowledge</button>}
      {(st === 'Assigned' || st === 'Acknowledged') && <button className="fa-btn" onClick={onEnRoute}>En route to {j.pole}</button>}
      {(st === 'Acknowledged' || st === 'En route') && <><div className="dim">At the pole: tap or scan its tag to report on site.</div><button className="fa-btn ghost" onClick={onNoTag}>Tag won't read — I'm at {j.pole}</button></>}
      {st === 'On site' && <button className="fa-btn pri" disabled={j.needsClearance && !holding} onClick={() => onAct('working')}>{j.needsClearance && !holding ? 'Request a clearance first' : 'Start work'}</button>}
      {st === 'Working' && <button className="fa-btn pri" onClick={() => { if (confirm(`Report ${j.job} complete? Tools and material clear, pole safe.`)) onAct('complete'); }}>Job complete</button>}
    </div>
  );
}

function PoleTagCard({ pole, how, job, holding, onAct, onClose }: { pole: string; how: 'nfc' | 'qr'; job?: ToCrew; holding: boolean; onAct(j: ToCrew, s: 'ack' | 'working' | 'complete'): void; onClose(): void }) {
  const a = areaOfPole(pole);
  const canStart = job && ['On site', 'Acknowledged', 'En route', 'Assigned'].includes(job.jobStatus ?? '');
  return (
    <div className="fa-card tag">
      <div className="lbl">{how === 'nfc' ? 'NFC TAG' : 'QR TAG'} · {a ? a.name.toUpperCase() : 'PERIMETER LINE'}</div>
      <div className="huge mono">{pole}</div>
      {job ? <>
        <div className="fa-ok">On site for <b>{job.job}</b>: {job.text}</div>
        {job.needsClearance && !holding && <div className="fa-warn">This pole is on the line. Request a clearance and wait for it before you start.</div>}
        {canStart && <button className="fa-btn pri" disabled={job.needsClearance && !holding} onClick={() => onAct(job, 'working')}>{job.needsClearance && !holding ? 'Clearance needed first' : 'Start work'}</button>}
        {job.jobStatus === 'Working' && <button className="fa-btn pri" onClick={() => onAct(job, 'complete')}>Job complete</button>}
      </> : <div className="dim">Reported on site at {pole}. You have no work order on this pole.</div>}
      <button className="fa-btn ghost" onClick={onClose}>Back</button>
    </div>
  );
}

function StepCard({ m, onManualTag }: { m: ToCrew | undefined; onManualTag(): void }) {
  if (!m) return null;
  const d = m.dev ? DEV[m.dev] : undefined;
  if (m.state === 'issued') return <div className="fa-card step issued"><div className="lbl">STEP {m.step} · READ IT BACK ON THE RADIO</div><div className="big">{m.text}</div><div className="dim">Repeat the step back word for word. Do not operate until the operator says "That's correct."</div></div>;
  if (m.state === 'repeat') return <div className="fa-card step repeat"><div className="lbl">NEGATIVE — REPEAT BACK AGAIN</div><div className="big">{m.text}</div><div className="dim">The operator did not confirm your read-back. Listen and read it back again.</div></div>;
  return (
    <div className="fa-card step cleared">
      <div className="lbl">CLEARED TO OPERATE · STEP {m.step}</div>
      <div className="huge">{ACT[m.action!]} {m.dev}</div>
      <div>{d ? `${d.kind} at pole ${d.pole}` : ''}{m.loop ? ' · LOOP CLOSE' : ''}</div>
      <div className="dim">Go to {m.dev}, tap or scan its tag, operate, check it visually, and set the flag.</div>
      <button className="fa-btn ghost" onClick={onManualTag}>Tag won't read — confirm here</button>
    </div>
  );
}

function TagCard({ dev, how, curStep, snap, onOperate, onClose }: {
  dev: string; how: 'nfc' | 'qr'; curStep: ToCrew | undefined; snap: YardSnap | null;
  onOperate(action: SwAction, verified: boolean, wrong: boolean): void; onClose(): void;
}) {
  const d = DEV[dev];
  const state = snap?.dev[dev];
  const [ver, setVer] = useState(false);
  const [anyway, setAnyway] = useState<SwAction | null>(null);
  const mineHere = curStep?.state === 'cleared' && curStep.dev === dev;
  const flagWord = (a: SwAction) => (a === 'open' ? 'OPEN' : a === 'close' ? 'CLOSED' : ACT[a]);
  return (
    <div className="fa-card tag">
      <div className="lbl">{how === 'nfc' ? 'NFC TAG' : 'QR TAG'} · POLE {d.pole}</div>
      <div className="huge mono">{dev}</div>
      <div>{d.kind} · {d.feeder}{state ? <> · shows <b>{state.open ? 'OPEN' : 'CLOSED'}</b>{state.ctl ? ` · ${state.ctl.toUpperCase()}` : ''}{state.tags ? ` · ${state.tags} hold tag(s)` : ''}</> : null}</div>
      {mineHere ? <>
        <div className="fa-ok">Your cleared step: <b>{ACT[curStep!.action!]} {dev}</b></div>
        <label className="chk"><input type="checkbox" checked={ver} onChange={e => setVer(e.target.checked)} /><span>I operated it, checked it visually, and set the flag to <b>{flagWord(curStep!.action!)}</b></span></label>
        <button className="fa-btn pri" disabled={!ver} onClick={() => onOperate(curStep!.action!, true, false)}>Confirm {DONE_WORD[curStep!.action!] ?? ACT[curStep!.action!]} {dev}</button>
      </> : <>
        <div className="fa-warn">{curStep?.state === 'cleared' ? <>STOP. Your cleared step is <b>{ACT[curStep.action!]} {curStep.dev}</b> — not this device.</> : curStep ? <>STOP. Your step is not confirmed yet — read it back on the radio first.</> : <>STOP. You have no switching step for this device.</>}</div>
        {!anyway ? <div className="row2">
          <button className="fa-btn ghost" onClick={() => setAnyway('open')}>I already opened it</button>
          <button className="fa-btn ghost" onClick={() => setAnyway('close')}>I already closed it</button>
        </div> : <>
          <div className="dim">This will be reported to the operator as an operation without a cleared step.</div>
          <button className="fa-btn danger" onClick={() => onOperate(anyway, true, true)}>Report {DONE_WORD[anyway]} {dev}</button>
        </>}
      </>}
      <button className="fa-btn ghost" onClick={onClose}>Back</button>
    </div>
  );
}

function StatusCard({ status, at, dest, onSet }: { status: FieldStatus; at: string; dest?: string; onSet(s: FieldStatus, dev?: string): void }) {
  const [dev, setDev] = useState(dest ?? (at !== 'yard' ? at : DEVS[0].id));
  useEffect(() => { if (dest) setDev(dest); }, [dest]);
  return (
    <div className="fa-card">
      <div className="lbl">YOUR STATUS · now <b>{status}{status === 'At yard' ? '' : status === 'En route' ? ` → ${dest ?? '?'}` : ` at ${at}`}</b></div>
      <PlacePicker value={dev} onChange={setDev} />
      <div className="row3">
        <button className={`fa-btn ${status === 'At yard' ? 'on' : ''}`} onClick={() => onSet('At yard')}>At yard</button>
        <button className={`fa-btn ${status === 'En route' ? 'on' : ''}`} onClick={() => onSet('En route', dev)}>En route</button>
        <button className={`fa-btn ${status === 'On site' ? 'on' : ''}`} onClick={() => onSet('On site', dev)}>On site</button>
      </div>
    </div>
  );
}

function ClearanceCard({ holding, last, at, onRequest, onRelease }: { holding: ToCrew | null; last?: ToCrew; at?: string; onRequest(dev: string, why: string): void; onRelease(): void }) {
  const [open, setOpen] = useState(false);
  const pickable = (x?: string) => !!x && x !== 'yard' && (!!DEV[x] || isLinePole(x));
  const [dev, setDev] = useState(pickable(at) ? at! : 'L23');
  const [why, setWhy] = useState('');
  const [chk, setChk] = useState([false, false, false]);
  useEffect(() => { if (pickable(at)) setDev(at!); }, [at]);
  if (holding) return (
    <div className="fa-card hold">
      <div className="lbl">YOU HOLD CLEARANCE {holding.clearance}</div>
      <div>{holding.text}</div>
      {!open ? <button className="fa-btn" onClick={() => setOpen(true)}>Release clearance…</button> : <>
        {['Work is complete', 'Grounds are removed', 'All personnel are clear'].map((t, i) => <label key={t} className="chk"><input type="checkbox" checked={chk[i]} onChange={e => setChk(c => c.map((x, j) => (j === i ? e.target.checked : x)))} /><span>{t}</span></label>)}
        <button className="fa-btn pri" disabled={!chk.every(Boolean)} onClick={() => { onRelease(); setOpen(false); setChk([false, false, false]); }}>Release {holding.clearance}</button>
      </>}
    </div>
  );
  return (
    <div className="fa-card">
      <div className="lbl">CLEARANCE{last?.state === 'released' ? ` · ${last.clearance} released` : ''}</div>
      {!open ? <button className="fa-btn" onClick={() => setOpen(true)}>Request a clearance…</button> : <>
        <div className="dim">Work location — the line pole you'll work on, or the device at the edge of your section:</div>
        <PlacePicker value={dev} onChange={setDev} linesOnly />
        <input placeholder="Work to be done (e.g. crossarm L23)" value={why} onChange={e => setWhy(e.target.value)} />
        <button className="fa-btn pri" onClick={() => { onRequest(dev, why.trim() || 'field work'); setOpen(false); setWhy(''); }}>Request clearance</button>
      </>}
    </div>
  );
}

function NoteCard({ onSend }: { onSend(t: string): void }) {
  const [t, setT] = useState('');
  return <div className="fa-card"><div className="row2"><input placeholder="Short note to the operator" value={t} onChange={e => setT(e.target.value)} /><button className="fa-btn" disabled={!t.trim()} onClick={() => { onSend(t.trim()); setT(''); }}>Send</button></div></div>;
}

// ── Yard map (Texas Ops layout, from texasYard.ts) ──────────
function YardMap({ snap, me, jobs }: { snap: YardSnap | null; me: string; jobs: ToCrew[] }) {
  const pts = [...Object.values(ALL_POLES), ...YARD_AREAS.flatMap(a => a.poly)];
  const minX = Math.min(...pts.map(p => p[0])) - 12, maxX = Math.max(...pts.map(p => p[0])) + 12;
  const minY = Math.min(...pts.map(p => p[1])) - 12, maxY = Math.max(...pts.map(p => p[1])) + 12;
  const X = (p: XY) => p[0] - minX, Y = (p: XY) => p[1] - minY;
  const segs: { k: string; a: XY; b: XY; live: boolean | undefined; color: string; tie?: boolean }[] = [];
  for (const f of YARD_FEEDERS) f.spans.forEach(([a, b], i) => { const k = `${f.id}-M${String(i + 1).padStart(2, '0')}`; segs.push({ k, a: LINE_POLES[a], b: LINE_POLES[b], live: snap?.live[k], color: f.color }); });
  for (const t of YARD_TIES) segs.push({ k: t.id, a: LINE_POLES[t.from], b: LINE_POLES[t.to], live: snap ? !!snap.dev[t.id] && !snap.dev[t.id].open : undefined, color: '#9aa4b2', tie: true });
  const jobPoles = new Set(jobs.map(j => j.pole));
  const crewAt: Record<string, string[]> = {};
  for (const [t, c] of Object.entries(snap?.trucks ?? {})) { const k = c.at === 'yard' ? 'YARD' : c.at; (crewAt[k] ??= []).push(t); }
  const crewXY = (k: string): XY => (k === 'YARD' ? YARD_PARKING : DEV[k] ? DEV[k].xy : ALL_POLES[k] ?? YARD_PARKING);
  const topDevAt: Record<string, YardDevice> = {};
  for (const d of DEVS) { const cur = topDevAt[d.pole]; if (!cur || d.kind === 'Recloser' || d.kind.includes('N.O.') || d.id.startsWith('CB-')) topDevAt[d.pole] = d; }
  return (
    <div className="fa-card">
      <svg viewBox={`0 0 ${maxX - minX} ${maxY - minY}`} className="yardmap">
        {YARD_AREAS.map(a => <polygon key={a.id} points={a.poly.map(p => `${X(p)},${Y(p)}`).join(' ')} fill={a.color} fillOpacity={0.08} stroke={a.color} strokeWidth={1.2} strokeDasharray="4 3" />)}
        {segs.map(s => <line key={s.k} x1={X(s.a)} y1={Y(s.a)} x2={X(s.b)} y2={Y(s.b)} stroke={s.live === false ? '#55606e' : s.color} strokeWidth={s.live === false ? 1.5 : 2.4} strokeDasharray={s.tie || s.live === false ? '4 3' : undefined} />)}
        {YARD_AREAS.flatMap(a => Object.entries(a.poles).map(([id, p]) => <circle key={id} cx={X(p)} cy={Y(p)} r={jobPoles.has(id) ? 4.5 : JOB_POLES.includes(id) ? 3.4 : 2.4} fill="#e8a53a" stroke={jobPoles.has(id) ? '#58a6ff' : '#fff'} strokeWidth={jobPoles.has(id) ? 2 : 0.6} />))}
        {Object.entries(LINE_POLES).map(([id, p]) => <circle key={id} cx={X(p)} cy={Y(p)} r={jobPoles.has(id) ? 4 : 2.6} fill="#0d1117" stroke={jobPoles.has(id) ? '#58a6ff' : '#e8edf3'} strokeWidth={jobPoles.has(id) ? 2 : 1} />)}
        {Object.values(topDevAt).map(d => { const st = snap?.dev[d.id]; return <g key={d.id}>
          <rect x={X(d.xy) - 4} y={Y(d.xy) - 4} width={8} height={8} fill={!st ? '#666' : st.open ? '#1e8e3e' : '#d93025'} stroke="#fff" strokeWidth={1} />
          <text x={X(d.xy) + 6} y={Y(d.xy) - 5} className="ml dev">{d.id}</text>
        </g>; })}
        {YARD_AREAS.map(a => { const c = a.poly.reduce((s, p) => [s[0] + p[0] / a.poly.length, s[1] + p[1] / a.poly.length], [0, 0]) as XY; return <text key={a.id + 't'} x={X(c)} y={Y(c)} className="ml area">{a.name}</text>; })}
        {Object.entries(crewAt).map(([k, ts]) => { const p = crewXY(k); return <text key={'c' + k} x={X(p)} y={Y(p) + 12} className={`ml crew ${ts.includes(me) ? 'me' : ''}`}>▲{ts.join(' ')}</text>; })}
      </svg>
      <div className="dim" style={{ fontSize: 12 }}>Squares: green = open, red = closed. Grey dashed line = out of service. Blue ring = your work order. {snap ? `Updated ${snap.clock}` : 'Waiting for the console…'}</div>
      <table className="fa-tbl"><tbody>{DEVS.map(d => { const s = snap?.dev[d.id]; return <tr key={d.id}><td className="mono">{d.id}</td><td>{d.pole}</td><td className={s ? (s.open ? 'o' : 'c') : ''}>{s ? (s.open ? 'OPEN' : 'CLOSED') : '—'}{s?.tags ? ' 🏷' : ''}</td></tr>; })}</tbody></table>
    </div>
  );
}

// ── Tag labels + NFC writer (instructor) ────────────────────
function TagLabels() {
  const origin = location.origin;
  const nfcOk = 'NDEFReader' in window;
  const [msg, setMsg] = useState<string | null>(null);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  const ids = useMemo(() => [...DEVS.map(d => d.id), ...JOB_POLES], []);
  useEffect(() => { (async () => { const o: Record<string, string> = {}; for (const id of ids) o[id] = await QRCode.toDataURL(`${origin}/t/${id}?s=q`, { margin: 1, width: 360 }); setQrs(o); })(); }, [origin, ids]);
  const write = async (id: string) => {
    try {
      setMsg(`Hold the tag for ${id} to the back of the phone…`);
      const w = new (window as any).NDEFReader();
      await w.write({ records: [{ recordType: 'url', data: `${origin}/t/${id}?s=n` }] });
      setMsg(`✔ Wrote ${id}. Stick it on and label it.`);
    } catch (e: any) { setMsg(`Could not write ${id}: ${e?.message ?? e}`); }
  };
  const groups = useMemo(() => [
    ...YARD_FEEDERS.map(f => ({ title: `${f.id} — ${f.name}: devices`, items: DEVS.filter(d => d.feeder === f.id).map(d => ({ id: d.id, l1: d.kind, l2: `Pole ${d.pole}`, flag: true })) })),
    { title: 'Job poles — perimeter line', items: JOB_POLES.filter(isLinePole).map(p => ({ id: p, l1: 'Line pole', l2: 'Perimeter line', flag: false })) },
    { title: 'Job poles — work areas', items: JOB_POLES.filter(p => !isLinePole(p)).map(p => ({ id: p, l1: 'Job pole', l2: areaOfPole(p)?.name ?? '', flag: false })) },
  ], []);
  return (
    <div className="tags-page">
      <div className="noprint fa-card">
        <h2>NLC Texas yard tags ({ids.length})</h2>
        <p>Print this page for the QR labels. Each label also gets an NFC tag (NTAG215) written to the same ID. Devices get an OPEN/CLOSED flag; job poles don't.</p>
        {nfcOk ? <p>This phone can write NFC tags: tap <b>Write NFC</b> on a label, then hold a blank tag to the back of the phone.</p>
          : <p className="dim">To write NFC tags, open this page in Chrome on an Android phone. (iPhones can read the tags but can't write them from a web page.)</p>}
        {msg && <div className="fa-toast" style={{ position: 'static' }}>{msg}</div>}
        <button className="fa-btn" onClick={() => print()}>Print labels</button>
      </div>
      {groups.map(g => <div key={g.title}>
        <h3 className="grp">{g.title}</h3>
        <div className="labels">{g.items.map(it => (
          <div key={it.id} className="label">
            {qrs[it.id] && <img src={qrs[it.id]} alt="" />}
            <div className="lid">{it.id}</div>
            <div className="lk">{it.l1}</div>
            <div className="lk">{it.l2}</div>
            {it.flag && <div className="flag">Flag: OPEN ▢ CLOSED ▢</div>}
            {nfcOk && <button className="fa-btn noprint" onClick={() => write(it.id)}>Write NFC</button>}
          </div>
        ))}</div>
      </div>)}
    </div>
  );
}
