// ─────────────────────────────────────────────────────────────
// Crew phone app (one phone per crew, carried by the foreman).
//   /field            join, status, instructions, clearances, yard map
//   /t/<DEVICE>       opened by tapping the device's NFC tag or scanning its QR
//   /field/tags       instructor: printable QR labels + NFC tag writer (Android)
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { FieldStatus, FromCrew, SwAction, ToCrew } from '../sim/types';
import { YARD_FEEDERS, YARD_POLES, YARD_SUB, YARD_TIES, yardDeviceList, type YardDevice } from '../sim/texasYard';
import { cleanCode, getBackend, useLocalBackend, type YardSnap } from './backend';
import './field.css';

const DEVS = yardDeviceList();
const DEV = Object.fromEntries(DEVS.map(d => [d.id, d])) as Record<string, YardDevice>;
const ACT: Record<SwAction, string> = { open: 'OPEN', close: 'CLOSE', manual: 'SET TO MANUAL', auto: 'SET TO AUTO', neutral: 'SET TO NEUTRAL', 'nr-on': 'NON-RECLOSE ON', 'nr-off': 'NON-RECLOSE OFF' } as Record<SwAction, string>;
const DONE_WORD: Partial<Record<SwAction, string>> = { open: 'OPENED', close: 'CLOSED' };

interface Me { code: string; truck: string; foreman: string; members: string[]; }
const ME_KEY = 'gridops-crew';
const loadMe = (): Me | null => { try { return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null'); } catch { return null; } };
const saveMe = (m: Me | null) => { try { m ? localStorage.setItem(ME_KEY, JSON.stringify(m)) : localStorage.removeItem(ME_KEY); } catch { /* private mode */ } };
const evId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export default function FieldApp() {
  const path = location.pathname;
  useLocalBackend(); // remember ?fieldlocal
  if (path.startsWith('/field/tags')) return <TagLabels />;
  const tagDev = path.startsWith('/t/') ? decodeURIComponent(path.slice(3)).toUpperCase().replace(/\/$/, '') : null;
  const how = new URLSearchParams(location.search).get('s') === 'q' ? 'qr' : 'nfc';
  return <CrewApp tagDev={tagDev && DEV[tagDev] ? tagDev : null} badTag={tagDev && !DEV[tagDev] ? tagDev : null} how={how} />;
}

// ── Crew app ────────────────────────────────────────────────
function CrewApp({ tagDev, badTag, how }: { tagDev: string | null; badTag: string | null; how: 'nfc' | 'qr' }) {
  const [me, setMe] = useState<Me | null>(loadMe);
  const [inbox, setInbox] = useState<ToCrew[]>([]);
  const [snap, setSnap] = useState<YardSnap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(tagDev);
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

  // A tag scan puts the crew on site at that device.
  const tagged = useRef(false);
  useEffect(() => {
    if (!me || !tagDev || tagged.current) return;
    tagged.current = true;
    send({ kind: 'status', status: 'On site', at: tagDev });
  }, [me, tagDev]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return <JoinScreen onJoined={m => { saveMe(m); setMe(m); }} tagDev={tagDev} />;

  const mine = snap?.trucks?.[me.truck];
  const status = (mine?.status ?? 'At yard') as FieldStatus;
  const steps = inbox.filter(m => m.kind === 'step');
  const curStep = [...steps].reverse().find(m => m.state === 'issued' || m.state === 'repeat' || m.state === 'cleared');
  const dispatch = [...inbox].reverse().find(m => m.kind === 'dispatch' && m.state === 'issued');
  const cl = [...inbox].reverse().find(m => m.kind === 'clearance');
  const holding = cl && cl.state === 'issued' ? cl : null;
  const infos = inbox.filter(m => m.kind === 'info' && !(m.id.endsWith('-welcome') && inbox.some(x => x.kind !== 'info'))).slice(-2);

  return (
    <div className="fa">
      <header className="fa-top">
        <div><b>Truck {me.truck}</b> <span className="dim">· {me.foreman}</span></div>
        <div className="dim mono">{me.code}{be.kind === 'local' ? ' · LOCAL TEST' : ''}{snap ? ` · ${snap.clock}` : ''}</div>
      </header>
      {err && <div className="fa-err" onClick={() => setErr(null)}>{err}</div>}
      {badTag && <div className="fa-err">Tag {badTag} is not a Texas Campus device. Tell your instructor.</div>}
      {toast && <div className="fa-toast">{toast}</div>}

      {tag && <TagCard dev={tag} how={how} curStep={curStep} snap={snap} onClose={() => { setTag(null); history.replaceState(null, '', '/field'); }}
        onOperate={(action, verified, wrong) => {
          send({ kind: 'operate', dev: tag, action, verified, tag: how });
          flash(wrong ? `Reported ${ACT[action]} ${tag} — the operator will see this was not your cleared step` : `Reported ${DONE_WORD[action] ?? ACT[action]} ${tag}`);
          setTag(null); history.replaceState(null, '', '/field');
        }} />}

      {!tag && tab === 'now' && <>
        {infos.map(m => <div key={m.id} className="fa-card info">{m.text}</div>)}
        <StepCard m={curStep} onManualTag={() => curStep?.dev && setTag(curStep.dev)} />
        {dispatch && !curStep && <div className="fa-card dispatch"><div className="lbl">DISPATCH</div><div className="big">{dispatch.text}</div></div>}
        <StatusCard status={status} at={mine?.at ?? 'yard'} dest={mine?.dest ?? dispatch?.dev} onSet={(st, dev) => {
          send(st === 'At yard' ? { kind: 'status', status: st, at: 'yard' } : st === 'En route' ? { kind: 'status', status: st, dest: dev } : { kind: 'status', status: st, at: dev });
          flash(st === 'At yard' ? 'Status: at the yard' : st === 'En route' ? `Status: en route to ${dev}` : `Status: ${st.toLowerCase()} at ${dev}`);
        }} />
        <ClearanceCard holding={holding} last={cl} at={mine?.at} onRequest={(dev, why) => { send({ kind: 'clearance', dev, text: why }); flash('Clearance requested — wait for the operator to issue it'); }}
          onRelease={() => { send({ kind: 'release' }); flash('Release sent — wait for the operator to acknowledge'); }} />
        <NoteCard onSend={t => { send({ kind: 'note', text: t }); flash('Note sent'); }} />
      </>}
      {!tag && tab === 'map' && <YardMap snap={snap} me={me.truck} />}
      {!tag && tab === 'log' && <div className="fa-card">{inbox.length ? [...inbox].reverse().map(m => <div key={m.id} className="logline"><span className={`st ${m.state}`}>{m.kind === 'step' ? `STEP ${m.step}` : m.kind.toUpperCase()} · {m.state}</span> {m.text}</div>) : <div className="dim">Nothing yet.</div>}
        <button className="fa-btn ghost" onClick={() => { if (confirm('Leave this session on this phone?')) { saveMe(null); setMe(null); } }}>Leave session</button></div>}

      <nav className="fa-nav">
        {(['now', 'map', 'log'] as const).map(t => <button key={t} className={tab === t && !tag ? 'on' : ''} onClick={() => { setTag(null); setTab(t); }}>{t === 'now' ? 'Orders' : t === 'map' ? 'Yard map' : 'Log'}</button>)}
      </nav>
    </div>
  );
}

function JoinScreen({ onJoined, tagDev }: { onJoined(m: Me): void; tagDev: string | null }) {
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
      if (m.code.length !== 6) throw new Error('The session code is 6 letters/numbers.');
      if (!/^\d{2,4}$/.test(m.truck)) throw new Error('Truck number: 2–4 digits.');
      if (!m.foreman) throw new Error('Enter the foreman\'s name.');
      if (!(await be.sessionOpen(m.code))) throw new Error('No open session with that code. Check with your instructor.');
      await be.join(m.code, { truck: m.truck, foreman: m.foreman, members: m.members, t: Date.now() }, { id: evId(), truck: m.truck, t: 0, kind: 'join', foreman: m.foreman, members: m.members });
      onJoined(m);
    } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="fa">
      <header className="fa-top"><div><b>Sparks Command</b> <span className="dim">· Field crew</span></div><div className="dim">{be.kind === 'local' ? 'LOCAL TEST' : 'Texas Campus'}</div></header>
      {tagDev && <div className="fa-card info">You scanned {tagDev}. Join your crew's session first.</div>}
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

function StepCard({ m, onManualTag }: { m: ToCrew | undefined; onManualTag(): void }) {
  if (!m) return <div className="fa-card dim">No switching step for you right now. Keep your status current.</div>;
  const d = m.dev ? DEV[m.dev] : undefined;
  if (m.state === 'issued') return <div className="fa-card step issued"><div className="lbl">STEP {m.step} · READ IT BACK ON THE RADIO</div><div className="big">{m.text}</div><div className="dim">Repeat the step back word for word. Do not operate until the operator says "That's correct."</div></div>;
  if (m.state === 'repeat') return <div className="fa-card step repeat"><div className="lbl">NEGATIVE — REPEAT BACK AGAIN</div><div className="big">{m.text}</div><div className="dim">The operator did not confirm your read-back. Listen and read it back again.</div></div>;
  return (
    <div className="fa-card step cleared">
      <div className="lbl">CLEARED TO OPERATE · STEP {m.step}</div>
      <div className="huge">{ACT[m.action!]} {m.dev}</div>
      <div>{d ? `${d.kind} at ${d.pole === 'Sub' ? 'the substation' : `pole ${d.pole}`}` : ''}{m.loop ? ' · LOOP CLOSE' : ''}</div>
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
      <div className="lbl">{how === 'nfc' ? 'NFC TAG' : 'QR TAG'} · {d.pole === 'Sub' ? 'SUBSTATION' : `POLE ${d.pole}`}</div>
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
      <select value={dev} onChange={e => setDev(e.target.value)}>{DEVS.map(d => <option key={d.id} value={d.id}>{d.id} — {d.kind}, {d.pole === 'Sub' ? 'sub' : d.pole}</option>)}</select>
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
  const [dev, setDev] = useState(at && at !== 'yard' ? at : DEVS[0].id);
  const [why, setWhy] = useState('');
  const [chk, setChk] = useState([false, false, false]);
  useEffect(() => { if (at && at !== 'yard') setDev(at); }, [at]);
  if (holding) return (
    <div className="fa-card hold">
      <div className="lbl">YOU HOLD CLEARANCE {holding.clearance}</div>
      <div>{holding.text}</div>
      {!open ? <button className="fa-btn" onClick={() => setOpen(true)}>Release clearance…</button> : <>
        {['Work is complete', 'Grounds are removed', 'All personnel are clear'].map((t, i) => <label key={t} className="chk"><input type="checkbox" checked={chk[i]} onChange={e => setChk(c => c.map((x, j) => (j === i ? e.target.checked : x)))} /> {t}</label>)}
        <button className="fa-btn pri" disabled={!chk.every(Boolean)} onClick={() => { onRelease(); setOpen(false); setChk([false, false, false]); }}>Release {holding.clearance}</button>
      </>}
    </div>
  );
  return (
    <div className="fa-card">
      <div className="lbl">CLEARANCE{last?.state === 'released' ? ` · ${last.clearance} released` : ''}</div>
      {!open ? <button className="fa-btn" onClick={() => setOpen(true)}>Request a clearance…</button> : <>
        <div className="dim">Work location (the device at the edge of your work section):</div>
        <select value={dev} onChange={e => setDev(e.target.value)}>{DEVS.map(d => <option key={d.id} value={d.id}>{d.id} — {d.pole === 'Sub' ? 'sub' : d.pole}</option>)}</select>
        <input placeholder="Work to be done (e.g. replace crossarm P12)" value={why} onChange={e => setWhy(e.target.value)} />
        <button className="fa-btn pri" onClick={() => { onRequest(dev, why.trim() || 'field work'); setOpen(false); setWhy(''); }}>Request clearance</button>
      </>}
    </div>
  );
}

function NoteCard({ onSend }: { onSend(t: string): void }) {
  const [t, setT] = useState('');
  return <div className="fa-card"><div className="row2"><input placeholder="Short note to the operator" value={t} onChange={e => setT(e.target.value)} /><button className="fa-btn" disabled={!t.trim()} onClick={() => { onSend(t.trim()); setT(''); }}>Send</button></div></div>;
}

// ── Yard map (schematic, from texasYard.ts) ─────────────────
function YardMap({ snap, me }: { snap: YardSnap | null; me: string }) {
  const pts = Object.values(YARD_POLES).concat([YARD_SUB.at]);
  const minX = Math.min(...pts.map(p => p[0])) - 130, maxX = Math.max(...pts.map(p => p[0])) + 130;
  const minY = Math.min(...pts.map(p => p[1])) - 60, maxY = Math.max(...pts.map(p => p[1])) + 60;
  const X = (p: [number, number]) => p[0] - minX, Y = (p: [number, number]) => maxY - p[1];
  const segs: { k: string; a: [number, number]; b: [number, number]; live: boolean | undefined; color: string }[] = [];
  for (const f of YARD_FEEDERS) {
    const route = [YARD_SUB.at, ...f.route.map(p => YARD_POLES[p])];
    for (let i = 1; i < route.length; i++) { const k = `${f.id}-M${String(i).padStart(2, '0')}`; segs.push({ k, a: route[i - 1], b: route[i], live: snap?.live[k], color: f.color }); }
  }
  for (const t of YARD_TIES) segs.push({ k: t.id, a: YARD_POLES[t.from], b: YARD_POLES[t.to], live: snap ? snap.dev[t.id] && !snap.dev[t.id].open : undefined, color: '#9aa4b2' });
  const byPole: Record<string, YardDevice[]> = {};
  for (const d of DEVS) (byPole[d.pole] ??= []).push(d);
  const crewAt: Record<string, string[]> = {};
  for (const [t, c] of Object.entries(snap?.trucks ?? {})) { const p = c.at === 'yard' ? 'YARD' : DEV[c.at]?.pole ?? 'YARD'; (crewAt[p] ??= []).push(t); }
  return (
    <div className="fa-card">
      <svg viewBox={`0 0 ${maxX - minX} ${maxY - minY}`} className="yardmap">
        {segs.map(s => <line key={s.k} x1={X(s.a)} y1={Y(s.a)} x2={X(s.b)} y2={Y(s.b)} stroke={s.live === undefined ? s.color : s.live ? s.color : '#555'} strokeWidth={s.live === false ? 4 : 7} strokeDasharray={s.k.startsWith('TS') && !s.live ? '10 8' : undefined} />)}
        <rect x={X(YARD_SUB.at) - 22} y={Y(YARD_SUB.at) - 22} width={44} height={44} fill="#222" stroke="#ccc" strokeWidth={2} />
        <text x={X(YARD_SUB.at)} y={Y(YARD_SUB.at) + 40} className="ml">SUB</text>
        {Object.entries(YARD_POLES).map(([pid, p]) => {
          const ds = byPole[pid] ?? [];
          const main = ds.find(d => d.kind === 'Recloser') ?? ds.find(d => d.kind.startsWith('Tie')) ?? ds[0];
          const st = main ? snap?.dev[main.id] : undefined;
          return (
            <g key={pid}>
              <circle cx={X(p)} cy={Y(p)} r={main ? 15 : 8} fill={!main ? '#888' : !st ? '#666' : st.open ? '#1e8e3e' : '#d93025'} stroke="#fff" strokeWidth={2} />
              <text x={X(p)} y={Y(p) - 22} className="ml">{pid}{main ? ` ${main.id}` : ''}{st ? (st.open ? ' O' : ' C') : ''}</text>
              {crewAt[pid] && <text x={X(p)} y={Y(p) + 34} className={`ml crew ${crewAt[pid].includes(me) ? 'me' : ''}`}>▲{crewAt[pid].join(' ')}</text>}
            </g>
          );
        })}
        {crewAt.YARD && <text x={X(YARD_SUB.at) + 30} y={Y(YARD_SUB.at) - 30} className={`ml crew ${crewAt.YARD.includes(me) ? 'me' : ''}`} textAnchor="start">Yard: {crewAt.YARD.join(' ')}</text>}
      </svg>
      <div className="dim" style={{ fontSize: 12 }}>Green = open, red = closed (utility convention). Grey line = dead. {snap ? `Updated ${snap.clock}` : 'Waiting for the console…'}</div>
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
  useEffect(() => { (async () => { const o: Record<string, string> = {}; for (const d of DEVS) o[d.id] = await QRCode.toDataURL(`${origin}/t/${d.id}?s=q`, { margin: 1, width: 360 }); setQrs(o); })(); }, [origin]);
  const write = async (id: string) => {
    try {
      setMsg(`Hold the tag for ${id} to the back of the phone…`);
      const w = new (window as any).NDEFReader();
      await w.write({ records: [{ recordType: 'url', data: `${origin}/t/${id}?s=n` }] });
      setMsg(`✔ Wrote ${id}. Stick it on the device and label it.`);
    } catch (e: any) { setMsg(`Could not write ${id}: ${e?.message ?? e}`); }
  };
  const groups = useMemo(() => YARD_FEEDERS.map(f => ({ f: f.id, devs: DEVS.filter(d => d.feeder === f.id) })), []);
  return (
    <div className="tags-page">
      <div className="noprint fa-card">
        <h2>Texas Campus device tags</h2>
        <p>Print this page for the QR labels (one per device). Each label also gets an NFC tag (NTAG215) written to the same device.</p>
        {nfcOk ? <p>This phone can write NFC tags: tap <b>Write NFC</b> on a device, then hold a blank tag to the back of the phone.</p>
          : <p className="dim">To write NFC tags, open this page in Chrome on an Android phone. (iPhones can read the tags but can't write them from a web page.)</p>}
        {msg && <div className="fa-toast" style={{ position: 'static' }}>{msg}</div>}
        <button className="fa-btn" onClick={() => print()}>Print labels</button>
      </div>
      {groups.map(g => <div key={g.f}>
        <h3 className="grp">{g.f}</h3>
        <div className="labels">{g.devs.map(d => (
          <div key={d.id} className="label">
            {qrs[d.id] && <img src={qrs[d.id]} alt="" />}
            <div className="lid">{d.id}</div>
            <div className="lk">{d.kind}</div>
            <div className="lk">{d.pole === 'Sub' ? 'Texas Campus Sub' : `Pole ${d.pole}`}</div>
            <div className="flag">Flag: OPEN ▢ CLOSED ▢</div>
            {nfcOk && <button className="fa-btn noprint" onClick={() => write(d.id)}>Write NFC</button>}
          </div>
        ))}</div>
      </div>)}
    </div>
  );
}
