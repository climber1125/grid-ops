// ─────────────────────────────────────────────────────────────
// Crew phone app (one phone per crew, carried by the foreman).
//   /field            join, status, jobs, switching steps, clearances, yard map
//   /t/<ID>           opened by tapping a device's or job pole's NFC tag / scanning its QR
//   /field/tags       instructor: printable QR labels + NFC tag writer (Android)
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { FieldStatus, FromCrew, SwAction, ToCrew, JobBrief } from '../sim/types';
import {
  YARD_FEEDERS, LINE_POLES, ALL_POLES, JOB_POLES,
  yardDeviceList, areaOfPole, isLinePole, currentYardDoc, type YardDevice,
} from '../sim/texasYard';
import { YardSvg } from './YardSvg';
import { canRecord, chirp, playClip, startRec, MAX_SEC, type Rec } from './fieldRadio';
import { enablePush, pushState, refreshPush, installMeta, isIOS, type PushState } from './push';
import { saveYard } from './yardStore';
import { CAL } from '../sim/texasYard';
import { cleanCode, getBackend, useLocalBackend, type YardSnap } from './backend';
import './field.css';

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
  useEffect(() => { installMeta(); }, []);
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
  const [tab, setTab] = useState<'now' | 'radio' | 'map' | 'log'>('now');
  const [sentRadio, setSentRadio] = useState<{ id: string; at: number; text?: string; audio?: string; dur?: number }[]>([]);
  const radioSeen = useRef<Set<string> | null>(null);
  const [unheard, setUnheard] = useState<ToCrew | null>(null);
  const [briefFor, setBriefFor] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>('off');
  useEffect(() => { pushState().then(setPush); if (me) refreshPush(me.code, me.truck); }, [me?.code, me?.truck]); // eslint-disable-line react-hooks/exhaustive-deps
  const gps = useGps(me);
  // While the app is on screen, tell the server so pushes are skipped — calls play live in the app instead.
  useEffect(() => {
    if (!me) return;
    const be2 = getBackend();
    const beat = () => { if (document.visibilityState === 'visible') be2.setActive(me.code, me.truck, Date.now()); };
    const vis = () => { if (document.visibilityState === 'visible') beat(); else be2.setActive(me.code, me.truck, 0); };
    beat();
    const id = setInterval(beat, 20_000);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', vis); be2.setActive(me.code, me.truck, 0); };
  }, [me?.code, me?.truck]); // eslint-disable-line react-hooks/exhaustive-deps
  const be = getBackend();

  useEffect(() => {
    if (!me) return;
    const a = be.onInbox(me.code, me.truck, m => {
      // Radio calls already in the inbox when the app opens are history, not new calls.
      if (!radioSeen.current) radioSeen.current = new Set(m.filter(x => x.kind === 'radio').map(x => x.id));
      if (!cueSeen.current) cueSeen.current = new Set(m.map(x => `${x.id}|${x.state}|${x.jobStatus ?? ''}|${x.briefStatus ?? ''}`));
      setInbox([...m].sort((x, y) => x.t - y.t || x.id.localeCompare(y.id)));
    });
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

  // New dispatches / steps / clearances / work orders while the app is open: short buzz + tone.
  const cueSeen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const key = (m: ToCrew) => `${m.id}|${m.state}|${m.jobStatus ?? ''}|${m.briefStatus ?? ''}`;
    const cues = inbox.filter(m => m.kind !== 'radio' && m.kind !== 'info' ? m.state === 'issued' || m.state === 'cleared' || m.state === 'repeat' : m.kind === 'info');
    if (!cueSeen.current) return;
    let fresh = false;
    for (const m of cues) { const k = key(m); if (!cueSeen.current.has(k)) { cueSeen.current.add(k); fresh = true; } }
    if (fresh) { chirp(); try { navigator.vibrate?.([150, 80, 150]); } catch { /* */ } }
  }, [inbox]);

  // Incoming radio calls: chirp + play the clip (browsers may need a tap first).
  useEffect(() => {
    const rs = inbox.filter(m => m.kind === 'radio');
    if (!radioSeen.current) return;
    for (const m of rs) if (!radioSeen.current.has(m.id)) {
      radioSeen.current.add(m.id);
      chirp(); try { navigator.vibrate?.([120, 60, 120]); } catch { /* no vibrate */ }
      if (m.audio) playClip(m.audio).then(() => setUnheard(null));
      setUnheard(m);
    }
  }, [inbox]); // eslint-disable-line react-hooks/exhaustive-deps
  const sendVoice = (c: { audio: string; mime: string; dur: number } | null, text?: string) => {
    if (!c && !text) return;
    const id = evId();
    send({ kind: 'radio', ...(c ? { audio: c.audio, mime: c.mime, dur: c.dur } : {}), ...(text ? { text } : {}), sentAt: Date.now() });
    setSentRadio(r => [...r, { id, at: Date.now(), text, audio: c?.audio, dur: c?.dur }].slice(-50));
    flash(c ? `Sent ${Math.round(c.dur)}s to Sparks Control` : 'Message sent to Sparks Control');
  };

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
      <div className="fa-chips">
        <button className={`fa-chip ${gps.state === 'on' ? 'ok' : gps.state === 'off' ? '' : 'bad'}`} onClick={() => gps.toggle()}>📍 {gps.state === 'on' ? `GPS ±${gps.acc ?? '?'} m` : gps.state === 'waiting' ? 'GPS…' : gps.state === 'denied' ? 'GPS blocked' : gps.state === 'unavailable' ? 'No GPS' : 'GPS off'}</button>
        <button className={`fa-chip ${push === 'on' ? 'ok' : push === 'local' ? '' : 'bad'}`} onClick={async () => setPush(await enablePush(me.code, me.truck).catch(() => 'off' as PushState))}>🔔 {push === 'on' ? 'Alerts on' : push === 'local' ? 'Alerts (test mode)' : push === 'denied' ? 'Alerts blocked' : push === 'needs-install' ? 'Install for alerts' : push === 'unsupported' ? 'No alerts here' : 'Turn on alerts'}</button>
      </div>
      {push === 'needs-install' && !tag && <div className="fa-card info">
        <b>Get call-outs with the app closed (iPhone):</b> tap the <b>Share</b> button, choose <b>Add to Home Screen</b>, then open <b>Sparks Field</b> from the new icon and tap <b>🔔 Turn on alerts</b>. You'll need to join once more in the installed app.
      </div>}
      {push === 'off' && !tag && <div className="fa-card info"><b>Turn on alerts</b> so dispatches, steps, clearances and radio calls buzz this phone even when the app is closed. <button className="fa-btn pri" onClick={async () => setPush(await enablePush(me.code, me.truck).catch(() => 'off' as PushState))}>🔔 Turn on alerts</button></div>}
      {push === 'denied' && !tag && <div className="fa-card info">Alerts are blocked for this site. Turn notifications on for it in the phone's settings{isIOS() ? ' (Settings → Notifications → Sparks Field)' : ' (Chrome → Site settings → Notifications)'}, then tap 🔔.</div>}
      {gps.state === 'denied' && !tag && <div className="fa-card info">Location is blocked. Allow location for this site in the phone's settings so control can see where your truck is while the app is open.</div>}
      {err && <div className="fa-err" onClick={() => setErr(null)}>{err}</div>}
      {badTag && <div className="fa-err">Tag {badTag} is not on the Texas yard map. Tell your instructor.</div>}
      {toast && <div className="fa-toast">{toast}</div>}
      {unheard && <div className="fa-card radio-in" onClick={() => { if (unheard.audio) playClip(unheard.audio); setUnheard(null); }}>
        <div className="lbl">📻 SPARKS CONTROL{unheard.audio ? ` · voice ${Math.round(unheard.dur ?? 0)}s` : ''}</div>
        {unheard.text && <div className="big">{unheard.text}</div>}
        {unheard.audio && <div>Tap to play</div>}
      </div>}

      {tag && DEV[tag] && <TagCard dev={tag} how={how} curStep={curStep} snap={snap} onClose={closeTag}
        onOperate={(action, verified, wrong) => {
          send({ kind: 'operate', dev: tag, action, verified, tag: how });
          flash(wrong ? `Reported ${ACT[action]} ${tag} — the operator will see this was not your cleared step` : `Reported ${DONE_WORD[action] ?? ACT[action]} ${tag}`);
          closeTag();
        }} />}
      {briefFor && (() => { const bj = jobs.find(j => j.job === briefFor); return bj ? <BriefForm j={bj} me={me} onCancel={() => setBriefFor(null)} onSend={b => { send({ kind: 'brief', job: bj.job, brief: b }); setBriefFor(null); flash('Job brief sent to control'); }} /> : null; })()}
      {!briefFor && tag && !DEV[tag] && <PoleTagCard pole={tag} how={how} job={jobs.find(j => j.pole === tag)} holding={!!holding} onClose={closeTag} onBrief={j => { closeTag(); setBriefFor(j.job!); }} onAct={(j, s) => { jobAct(j, s); closeTag(); }} />}

      {!briefFor && !tag && tab === 'now' && <>
        {infos.map(m => <div key={m.id} className="fa-card info">{m.text}</div>)}
        <StepCard m={curStep} onManualTag={() => curStep?.dev && setTag(curStep.dev)} />
        {jobs.map(j => <JobCard key={j.id} j={j} holding={!!holding} onBrief={() => setBriefFor(j.job!)} onAct={s => jobAct(j, s)} onEnRoute={() => { send({ kind: 'status', status: 'En route', dest: j.pole }); flash(`En route to ${j.pole}`); }} onNoTag={() => { send({ kind: 'status', status: 'On site', at: j.pole }); setTag(j.pole!); }} />)}
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
      {!tag && tab === 'radio' && <RadioLog inbox={inbox} sent={sentRadio} onText={t => sendVoice(null, t)} />}
      {!tag && tab === 'map' && <YardMap snap={snap} me={me.truck} jobs={jobs} />}
      {!tag && tab === 'log' && <div className="fa-card">{inbox.length ? [...inbox].reverse().map(m => <div key={m.id} className="logline"><span className={`st ${m.state}`}>{m.kind === 'step' ? `STEP ${m.step}` : m.kind === 'job' ? `${m.job} · ${m.jobStatus}` : m.kind.toUpperCase()} · {m.state}</span> {m.text}</div>) : <div className="dim">Nothing yet.</div>}
        <button className="fa-btn ghost" onClick={() => { if (confirm('Leave this session on this phone?')) { saveMe(null); setMe(null); } }}>Leave session</button>
        <CalibrateTool gps={gps} /></div>}

      <PttBar onClip={c => sendVoice(c)} onError={setErr} />
      <nav className="fa-nav four">
        {(['now', 'radio', 'map', 'log'] as const).map(t => <button key={t} className={tab === t && !tag ? 'on' : ''} onClick={() => { setTag(null); setBriefFor(null); setTab(t); }}>{t === 'now' ? 'Orders' : t === 'radio' ? 'Radio' : t === 'map' ? 'Yard map' : 'Log'}</button>)}
      </nav>
    </div>
  );
}

/** Always-on hold-to-talk bar above the tabs. */
function PttBar({ onClip, onError }: { onClip(c: { audio: string; mime: string; dur: number }): void; onError(m: string): void }) {
  const [rec, setRec] = useState<Rec | null>(null);
  const [t0, setT0] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => { if (!rec) return; const id = setInterval(() => setTick(n => n + 1), 200); return () => clearInterval(id); }, [rec]);
  if (!canRecord()) return null;
  const down = async () => {
    if (rec) return;
    try { const r = await startRec(c => { setRec(null); if (c) onClip(c); }); setT0(Date.now()); setRec(r); try { navigator.vibrate?.(40); } catch { /* */ } }
    catch { onError('Microphone blocked. Allow the microphone for this site in the browser settings, then try again.'); }
  };
  const up = async () => { if (!rec) return; const r = rec; setRec(null); const c = await r.stop(); if (c) onClip(c); else onError('Too short — hold the button while you talk.'); };
  return (
    <div className="fa-ptt">
      <button className={rec ? 'on' : ''} onPointerDown={ev => { ev.preventDefault(); down(); }} onPointerUp={up} onPointerCancel={() => { rec?.cancel(); setRec(null); }} onContextMenu={ev => ev.preventDefault()}>
        {rec ? `● TALKING ${((Date.now() - t0) / 1000).toFixed(0)}s / ${MAX_SEC}s — let go to send` : 'HOLD TO TALK · Sparks Control'}
      </button>
    </div>
  );
}

function RadioLog({ inbox, sent, onText }: { inbox: ToCrew[]; sent: { id: string; at: number; text?: string; audio?: string; dur?: number }[]; onText(t: string): void }) {
  const [t, setT] = useState('');
  const rows = [
    ...inbox.filter(m => m.kind === 'radio').map(m => ({ id: m.id, in: true, key: m.t * 1000, text: m.text, audio: m.audio, dur: m.dur, when: '' })),
    ...sent.map(m => ({ id: m.id, in: false, key: m.at, text: m.text, audio: m.audio, dur: m.dur, when: new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })),
  ];
  const ins = rows.filter(r => r.in).reverse(), outs = rows.filter(r => !r.in).reverse();
  return (
    <div className="fa-card">
      <div className="lbl">FROM SPARKS CONTROL</div>
      {ins.length ? ins.map(r => <div key={r.id} className="logline">{r.audio && <button className="fa-btn ghost sm" onClick={() => playClip(r.audio!)}>▶ {Math.round(r.dur ?? 0)}s</button>} {r.text}</div>) : <div className="dim">Nothing yet.</div>}
      <div className="lbl" style={{ marginTop: 8 }}>YOU SENT</div>
      {outs.length ? outs.map(r => <div key={r.id} className="logline"><span className="dim mono">{r.when}</span> {r.audio && <button className="fa-btn ghost sm" onClick={() => playClip(r.audio!)}>▶ {Math.round(r.dur ?? 0)}s</button>} {r.text}</div>) : <div className="dim">Nothing yet.</div>}
      <div className="row2" style={{ marginTop: 8 }}><input placeholder="Type to Sparks Control" value={t} onChange={e => setT(e.target.value)} /><button className="fa-btn" disabled={!t.trim()} onClick={() => { onText(t.trim()); setT(''); }}>Send</button></div>
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

/** What still stands between the crew and "Start work". */
function startBlock(j: ToCrew, holding: boolean): string | null {
  if (j.trouble && !j.revealed) return 'Scan the tag on site first';
  if (j.needsBrief && j.briefStatus !== 'approved') return j.briefStatus === 'sent' ? 'Waiting for control to approve the brief' : 'Send your job brief first';
  if (j.needsClearance && !holding) return 'Request a clearance first';
  return null;
}
function BriefStatus({ j, onBrief }: { j: ToCrew; onBrief(): void }) {
  if (!j.needsBrief || (j.trouble && !j.revealed)) return null;
  if (j.briefStatus === 'approved') return <div className="fa-ok">✔ Job brief approved by control</div>;
  if (j.briefStatus === 'sent') return <div className="dim">📋 Job brief sent — waiting for control to approve it.</div>;
  return <>
    {j.briefStatus === 'returned' && <div className="fa-warn small">Control returned your brief{j.briefNote ? `: ${j.briefNote}` : ''}. Fix it and send it again.</div>}
    <button className="fa-btn pri" onClick={onBrief}>📋 {j.briefStatus === 'returned' ? 'Fix and resend job brief' : 'Job brief'}</button>
  </>;
}

function JobCard({ j, holding, onAct, onEnRoute, onNoTag, onBrief }: { j: ToCrew; holding: boolean; onAct(s: 'ack' | 'working' | 'complete'): void; onEnRoute(): void; onNoTag(): void; onBrief(): void }) {
  const st = j.jobStatus;
  const hidden = j.trouble && !j.revealed;
  const block = startBlock(j, holding);
  return (
    <div className={`fa-card job ${st === 'Working' ? 'working' : ''} ${j.trouble ? 'trouble' : ''}`}>
      <div className="lbl">{j.trouble ? '⚠ TROUBLE CALL' : 'WORK ORDER'} {j.job} · {st}</div>
      <div className="big">{j.text}</div>
      {!hidden && j.needsClearance && <div className="fa-warn small">On the line — do not start until you hold a clearance that covers {j.pole}.</div>}
      {st === 'Assigned' && <button className="fa-btn pri" onClick={() => onAct('ack')}>Acknowledge</button>}
      {(st === 'Assigned' || st === 'Acknowledged') && <button className="fa-btn" onClick={onEnRoute}>En route to {j.pole}</button>}
      {(st === 'Acknowledged' || st === 'En route' || st === 'Assigned') && <><div className="dim">At {j.pole}: tap or scan its tag to check in{j.trouble ? ' and get the details' : ''}.</div><button className="fa-btn ghost" onClick={onNoTag}>Tag won't read — I'm at {j.pole}</button></>}
      {st === 'On site' && <BriefStatus j={j} onBrief={onBrief} />}
      {st === 'On site' && <button className="fa-btn pri" disabled={!!block} onClick={() => onAct('working')}>{block ?? 'Start work'}</button>}
      {st === 'Working' && <button className="fa-btn pri" onClick={() => { if (confirm(`Report ${j.job} complete? Tools and material clear, everything safe.`)) onAct('complete'); }}>Job complete</button>}
    </div>
  );
}

function PoleTagCard({ pole, how, job, holding, onAct, onBrief, onClose }: { pole: string; how: 'nfc' | 'qr'; job?: ToCrew; holding: boolean; onAct(j: ToCrew, s: 'ack' | 'working' | 'complete'): void; onBrief(j: ToCrew): void; onClose(): void }) {
  const a = areaOfPole(pole);
  const block = job ? startBlock(job, holding) : null;
  return (
    <div className="fa-card tag">
      <div className="lbl">{how === 'nfc' ? 'NFC TAG' : 'QR TAG'} · {a ? a.name.toUpperCase() : pole.startsWith('U') ? 'URD' : 'PERIMETER LINE'}</div>
      <div className="huge mono">{pole}</div>
      {job ? <>
        <div className="fa-ok">Checked in for <b>{job.job}</b></div>
        <div className="big">{job.trouble && !job.revealed ? 'Getting the call details from control…' : job.text}</div>
        <BriefStatus j={job} onBrief={() => onBrief(job)} />
        {job.jobStatus !== 'Working' && <button className="fa-btn pri" disabled={!!block} onClick={() => onAct(job, 'working')}>{block ?? 'Start work'}</button>}
        {job.jobStatus === 'Working' && <button className="fa-btn pri" onClick={() => onAct(job, 'complete')}>Job complete</button>}
      </> : <div className="dim">Reported on site at {pole}. You have no work order on this pole.</div>}
      <button className="fa-btn ghost" onClick={onClose}>Back</button>
    </div>
  );
}

const HAZARDS = ['Energized equipment', 'Backfeed possible', 'Oil / environmental', 'Traffic & public', 'Overhead clearance', 'Excavation / trench', 'Weather', 'Heat stress', 'Pinch points / rigging'];
const PPE = ['FR clothing', 'Hard hat & safety glasses', 'Rubber gloves & sleeves', 'Hot sticks', 'Personal protective grounds', 'Voltage detector', 'Cones / barricades', 'Fall protection'];
function BriefForm({ j, me, onSend, onCancel }: { j: ToCrew; me: Me; onSend(b: JobBrief): void; onCancel(): void }) {
  const crewAll = [me.foreman, ...me.members];
  const [hz, setHz] = useState<string[]>([]);
  const [ppe, setPpe] = useState<string[]>([]);
  const [iso, setIso] = useState('');
  const [gnd, setGnd] = useState('');
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [steps, setSteps] = useState<{ dev: string; action: SwAction }[]>([]);
  const [signed, setSigned] = useState<string[]>([]);
  const tog = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const ready = hz.length > 0 && ppe.length > 0 && !!iso.trim() && !!method.trim() && crewAll.every(c => signed.includes(c));
  return (
    <div className="fa-card brief">
      <div className="lbl">JOB BRIEF · {j.job} · pole {j.pole}</div>
      <div>{j.text}</div>
      <div className="lbl">HAZARDS</div>
      <div className="chips">{HAZARDS.map(h => <button key={h} className={`chip ${hz.includes(h) ? 'on' : ''}`} onClick={() => tog(hz, setHz, h)}>{h}</button>)}</div>
      <div className="lbl">PPE & TOOLS</div>
      <div className="chips">{PPE.map(h => <button key={h} className={`chip ${ppe.includes(h) ? 'on' : ''}`} onClick={() => tog(ppe, setPpe, h)}>{h}</button>)}</div>
      <label>Isolation points (what makes it dead)<input value={iso} onChange={e => setIso(e.target.value)} placeholder="e.g. open the elbows both sides of the pad" /></label>
      <div className="lbl">SWITCHING YOU NEED FROM CONTROL (in order)</div>
      {steps.map((st, i) => <div key={i} className="row3 steprow">
        <select value={st.action} onChange={e => setSteps(ss => ss.map((x, k) => (k === i ? { ...x, action: e.target.value as SwAction } : x)))}><option value="open">OPEN</option><option value="close">CLOSE</option></select>
        <select value={st.dev} onChange={e => setSteps(ss => ss.map((x, k) => (k === i ? { ...x, dev: e.target.value } : x)))}>{DEVS.map(d => <option key={d.id} value={d.id}>{d.id} — {d.kind}</option>)}</select>
        <button className="fa-btn ghost sm" onClick={() => setSteps(ss => ss.filter((_, k) => k !== i))}>✕</button>
      </div>)}
      <button className="fa-btn ghost" onClick={() => setSteps(ss => [...ss, { dev: DEVS[0].id, action: 'open' }])}>+ Add switching step</button>
      <label>Grounding plan<input value={gnd} onChange={e => setGnd(e.target.value)} placeholder="Where the grounds go" /></label>
      <label>Work method / steps<input value={method} onChange={e => setMethod(e.target.value)} placeholder="How you'll do the job" /></label>
      <label>Notes<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything else for control" /></label>
      <div className="lbl">CREW SIGN-OFF — everyone on the job briefed</div>
      {crewAll.map(c => <label key={c} className="chk"><input type="checkbox" checked={signed.includes(c)} onChange={() => tog(signed, setSigned, c)} /><span>{c}{c === me.foreman ? ' (foreman)' : ''}</span></label>)}
      <button className="fa-btn pri" disabled={!ready} onClick={() => onSend({ hazards: hz, ppe, isolation: iso.trim(), grounding: gnd.trim(), method: method.trim(), steps, crew: signed, ...(notes.trim() ? { notes: notes.trim() } : {}) })}>{ready ? 'Send brief to control' : 'Hazards, PPE, isolation, method and every crew sign-off are required'}</button>
      <button className="fa-btn ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function StepCard({ m, onManualTag }: { m: ToCrew | undefined; onManualTag(): void }) {
  if (!m) return null;
  const d = m.dev ? DEV[m.dev] : undefined;
  if (m.state === 'issued') return <div className="fa-card step issued"><div className="lbl">STEP {m.step} · READ IT BACK ON THE RADIO</div><div className="big">{m.text}</div><div className="dim">Hold the red TALK button and read the step back word for word. Do not operate until the operator says "That's correct."</div></div>;
  if (m.state === 'repeat') return <div className="fa-card step repeat"><div className="lbl">NEGATIVE — REPEAT BACK AGAIN</div><div className="big">{m.text}</div><div className="dim">The operator did not confirm your read-back. Listen, then hold TALK and read it back again.</div></div>;
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

// ── Yard map (Texas Ops layout) ─────────────────────────────
function YardMap({ snap, me, jobs }: { snap: YardSnap | null; me: string; jobs: ToCrew[] }) {
  const doc = useMemo(() => currentYardDoc(), []);
  const hi = useMemo(() => new Set(jobs.map(j => j.pole!).filter(Boolean)), [jobs]);
  return (
    <div className="fa-card">
      <YardSvg doc={doc} snap={snap} me={me} highlight={hi} height="62vh" labelPx={11} minLabelZoom={2.2} />
      <div className="dim" style={{ fontSize: 12 }}>Drag to move, pinch or ＋ to zoom. Squares: green = open, red = closed. Grey dashed = out of service. Blue ring = your work order. {snap ? `Updated ${snap.clock}` : 'Waiting for the console…'}</div>
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

// ── GPS while the app is open ───────────────────────────────
type GpsState = 'off' | 'waiting' | 'on' | 'denied' | 'unavailable';
export interface GpsHook { state: GpsState; acc: number | null; last: GeolocationPosition | null; toggle(): void; }
function useGps(me: Me | null): GpsHook {
  const [want, setWant] = useState(() => { try { return localStorage.getItem('gridops-gps') !== 'off'; } catch { return true; } });
  const [state, setState] = useState<GpsState>('off');
  const [last, setLast] = useState<GeolocationPosition | null>(null);
  const sent = useRef<{ at: number; lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!me || !want) { setState('off'); return; }
    if (!('geolocation' in navigator)) { setState('unavailable'); return; }
    setState('waiting');
    const be = getBackend();
    let fix: GeolocationPosition | null = null;
    // Report every 15 s, or sooner if they've moved 8 m (never more than every 4 s).
    const maybeSend = () => {
      if (!fix) return;
      const now = Date.now(), { latitude: lat, longitude: lng, accuracy } = fix.coords;
      const s0 = sent.current;
      const moved = s0 ? Math.hypot((lat - s0.lat) * 111320, (lng - s0.lng) * 111320 * Math.cos(lat * Math.PI / 180)) : 1e9;
      if (!s0 || now - s0.at > 15_000 || (moved > 8 && now - s0.at > 4_000)) {
        sent.current = { at: now, lat, lng };
        be.saveGps(me.code, me.truck, { lat, lng, acc: Math.round(accuracy), at: now });
      }
    };
    const id = navigator.geolocation.watchPosition(p => { fix = p; setState('on'); setLast(p); maybeSend(); },
      err => setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'waiting'), { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 });
    const tick = setInterval(maybeSend, 5_000);
    return () => { navigator.geolocation.clearWatch(id); clearInterval(tick); };
  }, [me?.code, me?.truck, want]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    state, acc: last ? Math.round(last.coords.accuracy) : null, last,
    toggle: () => setWant(w => { const n = !w; try { localStorage.setItem('gridops-gps', n ? 'on' : 'off'); } catch { /* */ } return n; }),
  };
}

/** Instructor: stand at two poles and record their GPS so the yard drawing sits on the real ground. */
function CalibrateTool({ gps }: { gps: GpsHook }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState('L1'), [b, setB] = useState('L25');
  const [fa, setFa] = useState<[number, number] | null>(null), [fb, setFb] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const capture = async (set: (v: [number, number]) => void, label: string) => {
    if (!('geolocation' in navigator)) return;
    setBusy(label); setMsg(null);
    const fixes: GeolocationPosition[] = [];
    await new Promise<void>(res => {
      const id = navigator.geolocation.watchPosition(p => { fixes.push(p); if (fixes.length >= 8) { navigator.geolocation.clearWatch(id); res(); } }, () => { navigator.geolocation.clearWatch(id); res(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
      setTimeout(() => { navigator.geolocation.clearWatch(id); res(); }, 25_000);
    });
    setBusy(null);
    if (!fixes.length) { setMsg('No GPS fix — step into the open and try again.'); return; }
    const best = fixes.sort((x, y) => x.coords.accuracy - y.coords.accuracy).slice(0, Math.max(3, Math.ceil(fixes.length / 2)));
    const lat = best.reduce((s, p) => s + p.coords.latitude, 0) / best.length, lng = best.reduce((s, p) => s + p.coords.longitude, 0) / best.length;
    set([lat, lng]);
    setMsg(`${label}: ${lat.toFixed(6)}, ${lng.toFixed(6)} (±${Math.round(best[0].coords.accuracy)} m)`);
  };
  const save = async () => {
    if (!fa || !fb) return;
    const pw = prompt('Instructor password:'); if (!pw) return;
    const doc = currentYardDoc();
    if (!doc.poles[a] || !doc.poles[b]) { setMsg('Unknown pole number'); return; }
    doc.cal = { a: { pole: a, ll: fa }, b: { pole: b, ll: fb }, at: new Date().toISOString() };
    try { await saveYard(doc, pw); setMsg('Saved. Reload Sparks Command and the crew phones to use it.'); } catch (e: any) { setMsg(e?.message ?? String(e)); }
  };
  if (!open) return <button className="fa-btn ghost" onClick={() => setOpen(true)}>Instructor: calibrate yard GPS{CAL.measured ? ' (measured)' : ''}</button>;
  return (
    <div className="fa-card">
      <div className="lbl">CALIBRATE YARD GPS (instructor)</div>
      <div className="dim">Stand right at the base of each pole, phone held still, sky in view. Two poles far apart work best.</div>
      {gps.state !== 'on' && <div className="fa-warn small">Turn GPS on first (📍 at the top).</div>}
      <div className="row2"><input className="mono" value={a} onChange={e => setA(e.target.value.toUpperCase())} /><button className="fa-btn" disabled={!!busy} onClick={() => capture(setFa, `Pole ${a}`)}>{busy === `Pole ${a}` ? 'Reading GPS…' : fa ? '✔ Re-read' : `I'm at ${a}`}</button></div>
      <div className="row2"><input className="mono" value={b} onChange={e => setB(e.target.value.toUpperCase())} /><button className="fa-btn" disabled={!!busy} onClick={() => capture(setFb, `Pole ${b}`)}>{busy === `Pole ${b}` ? 'Reading GPS…' : fb ? '✔ Re-read' : `I'm at ${b}`}</button></div>
      {msg && <div className="dim">{msg}</div>}
      <button className="fa-btn pri" disabled={!fa || !fb || !!busy} onClick={save}>Save calibration</button>
      <button className="fa-btn ghost" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}
