// GRID OPS operator workstation shell: top bar, monitors, modals,
// real-time loop, audio, toasts, autosave, and multi-window linking.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Engine } from '../sim/engine';
import { EngineCtx, type Ctx, type Sel, type SboReq } from './ctx';
import { GisMap, selPos } from './GisMap';
import { ScadaView } from './Scada';
import { SwitchingView } from './Switching';
import { OmsPanel } from './Oms';
import { RadioPanel } from './Radio';
import { CrewBoard, AlarmPanel } from './Bottom';
import { Inspector } from './Inspector';
import { SboModal, ScenarioModal, AarModal } from './Modals';
import { RadioPlayer, alarmTone, unlockAudio } from './audio';
import { saveState, loadState } from '../sim/persist';
import { openChannel, remoteEngine, initialView, viewUrl, VIEWS, WIN_ID, type Msg, type View } from './link';
import type { LatLng } from '../sim/types';

interface Toast { id: number; text: string; level: string; t: string; born: number; }
type Tab = 'gis' | 'scada' | 'sw';
type Mon = 'gis' | 'scada' | 'sw' | 'oms' | 'radio' | 'crew' | 'alarms';
type Role = 'pending' | 'master' | 'replica';
interface Peer { view: View; master: boolean; t: number; }
type Prefill = { dev: string; action: 'open' | 'close' } | null;

export default function App() {
  const [e, setE] = useState<Engine>(() => Engine.create('A', 1001));
  const eRef = useRef(e); eRef.current = e;
  const [, setVer] = useState(0);

  // ── Window role & view ─────────────────────────────────────
  const chan = useMemo(() => openChannel(), []);
  const [role, setRole] = useState<Role>(chan ? 'pending' : 'master');
  const roleRef = useRef(role); roleRef.current = role;
  const [view, setViewRaw] = useState<View>(initialView);
  const viewRef = useRef(view); viewRef.current = view;
  const peers = useRef(new Map<string, Peer>());
  const [peerCount, setPeerCount] = useState(0);
  const lastHeard = useRef(Date.now());
  const post = (m: Msg) => { try { chan?.postMessage(m); } catch { /* closed */ } };
  const setView = (v: View) => {
    setViewRaw(v);
    if (v === 'gis' || v === 'scada' || v === 'sw') setTabRaw(v);
    try { history.replaceState(null, '', viewUrl(v)); } catch { /* file:// quirks */ }
    post({ type: 'hello', from: WIN_ID, view: v, master: roleRef.current === 'master' });
  };

  const [tab, setTabRaw] = useState<Tab>(() => (['gis', 'scada', 'sw'].includes(initialView()) ? initialView() as Tab : 'gis'));
  const [mon, setMon] = useState<Mon>('gis');
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1280);
  const [focus, setFocus] = useState(false);
  useEffect(() => { const f = () => setNarrow(window.innerWidth < 1280); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);

  const [sel, setSelLocal] = useState<Sel>(null);
  const [sbo, setSbo] = useState<SboReq | null>(null);
  const [showScen, setShowScen] = useState(false);
  const [showAar, setShowAar] = useState(false);
  const [showMon, setShowMon] = useState(false);
  const [showObj, setShowObj] = useState(true);
  const [audioOn, setAudioOn] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [silenced, setSilenced] = useState(false);
  const [keyed, setKeyed] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [swPrefill, setSwPrefillState] = useState<Prefill>(null);
  const prefillRef = useRef<Prefill>(null);
  const [saved, setSaved] = useState<{ autosave?: number; manual?: number }>({});
  const [pendingWins, setPendingWins] = useState<{ v: View; label: string; feat: string }[]>([]);
  const mapApi = useRef<{ flyTo(p: LatLng, z?: number): void } | null>(null);
  const player = useRef(new RadioPlayer());
  const seen = useRef({ radio: 0, log: 0, alarmCount: 0, lastTone: 0 });

  const isMaster = role === 'master';
  const mapVisible = view === 'gis' || (view === 'all' && tab === 'gis' && (!narrow || mon === 'gis'));
  const mapVisRef = useRef(mapVisible); mapVisRef.current = mapVisible;
  const ce = useMemo(() => (role === 'replica' ? remoteEngine(e, post) : e), [e, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const ceRef = useRef(ce); ceRef.current = ce;

  const flash = (text: string, level: 'info' | 'warn' | 'alarm' | 'good' = 'info') => setToasts(t => [...t, { id: Date.now() + Math.random(), text, level, t: eRef.current.hhmm(), born: Date.now() }].slice(-5));

  const start = (id: string, seed: number) => {
    if (roleRef.current === 'replica') { post({ type: 'start', from: WIN_ID, id, seed }); setShowScen(false); return; }
    setE(Engine.create(id, seed)); setShowScen(false); setShowAar(false); if (viewRef.current === 'all') setTabRaw('gis');
  };
  const loadInto = (state: any) => {
    if (roleRef.current === 'replica') { post({ type: 'load', from: WIN_ID, state }); return; }
    const ne = new Engine(state); ne.s.paused = false; setE(ne);
  };
  const resume = async (key: string) => { const v = await loadState(key); if (v) { loadInto(v.state); setShowScen(false); flash(`Session restored (${key})`, 'good'); } };

  // ── Link: message handling ─────────────────────────────────
  useEffect(() => {
    if (!chan) return;
    const handle = (ev: MessageEvent<Msg>) => {
      const m = ev.data;
      const me = roleRef.current;
      switch (m.type) {
        case 'state': {
          if (m.from === WIN_ID) return;
          if (me === 'master') {
            if (m.from < WIN_ID) { setRole('replica'); eRef.current.syncFrom(m.s, m.readings, m.devKw); lastHeard.current = Date.now(); }
            return;
          }
          lastHeard.current = Date.now();
          eRef.current.syncFrom(m.s, m.readings, m.devKw);
          if (me === 'pending') setRole('replica');
          setVer(v => v + 1);
          break;
        }
        case 'hello': {
          if (m.from === WIN_ID) return;
          const isNew = !peers.current.has(m.from);
          peers.current.set(m.from, { view: m.view, master: m.master, t: Date.now() });
          if (me === 'master' && isNew) broadcast();
          break;
        }
        case 'act': {
          if (me !== 'master') return;
          const fn = (eRef.current as any)[m.method];
          if (typeof fn !== 'function') return;
          let r: any;
          try { r = fn.apply(eRef.current, m.args); } catch (err) { r = String(err); }
          const text = typeof r === 'string' ? r : r && r.ok === false ? r.reason : null;
          if (text) post({ type: 'result', to: m.from, text });
          broadcast(); setVer(v => v + 1);
          break;
        }
        case 'result': if (m.to === WIN_ID) flash(m.text, 'warn'); break;
        case 'sel': {
          if (m.from === WIN_ID) return;
          setSelLocal(m.sel);
          if (m.sel && mapVisRef.current) { const p = selPos(eRef.current, m.sel); if (p) mapApi.current?.flyTo(p); }
          break;
        }
        case 'goto': {
          if (m.to !== WIN_ID) return;
          if (viewRef.current === 'all') setTabRaw(m.tab); else setView(m.tab);
          if (m.prefill) { prefillRef.current = m.prefill; setSwPrefillState(m.prefill); }
          window.focus();
          break;
        }
        case 'start': if (me === 'master') start(m.id, m.seed); break;
        case 'load': if (me === 'master') loadInto(m.state); break;
      }
    };
    chan.addEventListener('message', handle);
    post({ type: 'hello', from: WIN_ID, view: viewRef.current, master: false });
    const t = setTimeout(() => { if (roleRef.current === 'pending') setRole('master'); }, 900);
    return () => { chan.removeEventListener('message', handle); clearTimeout(t); };
  }, [chan]); // eslint-disable-line react-hooks/exhaustive-deps

  function broadcast() {
    if (roleRef.current !== 'master' || !chan) return;
    const en = eRef.current;
    post({ type: 'state', from: WIN_ID, gen: 0, s: en.s, readings: en.readings, devKw: en.devKw });
  }

  // Heartbeat, peer pruning, state broadcast, takeover if the main console goes away
  useEffect(() => {
    if (!chan) return;
    const hb = setInterval(() => {
      post({ type: 'hello', from: WIN_ID, view: viewRef.current, master: roleRef.current === 'master' });
      const now = Date.now();
      for (const [id, p] of peers.current) if (now - p.t > 3500) peers.current.delete(id);
      setPeerCount(peers.current.size);
      if (roleRef.current === 'replica' && now - lastHeard.current > 2500) {
        setTimeout(() => {
          if (roleRef.current === 'replica' && Date.now() - lastHeard.current > 2500) {
            const ne = new Engine(eRef.current.s);
            setE(ne); setRole('master');
            flash('Main console closed — this window took over the simulation', 'warn');
          }
        }, Math.random() * 700);
      }
    }, 1000);
    const bc = setInterval(broadcast, 250);
    return () => { clearInterval(hb); clearInterval(bc); };
  }, [chan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time loop (main console only): 10 Hz sim step, ~4 Hz React render
  useEffect(() => {
    if (!isMaster) return;
    let last = performance.now(), lastRender = 0;
    const id = setInterval(() => {
      const now = performance.now();
      eRef.current.tick(now - last); last = now;
      if (now - lastRender > 240) { lastRender = now; setVer(v => v + 1); }
    }, 100);
    return () => clearInterval(id);
  }, [isMaster]);

  // Reset watchers when the engine instance changes
  useEffect(() => {
    seen.current.radio = e.s.radio.at(-1)?.id ?? 0;
    seen.current.log = e.s.log.at(-1)?.id ?? 0;
    seen.current.alarmCount = e.s.alarms.length;
    player.current.stop();
    setSelLocal(null); setToasts([]);
  }, [e]);

  useEffect(() => { player.current.onKey = setKeyed; }, []);
  useEffect(() => { player.current.enabled = audioOn && voiceOn && isMaster; if (!voiceOn || !isMaster) player.current.stop(); }, [audioOn, voiceOn, isMaster]);

  // Per-render side effects: radio audio, alarm tones (main console only), toasts, AAR
  const s = e.s;
  useEffect(() => {
    const newMsgs = s.radio.filter(m => m.id > seen.current.radio);
    if (newMsgs.length) { seen.current.radio = newMsgs.at(-1)!.id; if (isMaster) player.current.push(newMsgs, s.paused ? 1 : s.speed); }
    if (s.alarms.length > seen.current.alarmCount) { seen.current.alarmCount = s.alarms.length; setSilenced(false); }
    const unack = s.alarms.filter(a => !a.acked && a.active && a.pri <= 2);
    if (isMaster && audioOn && !silenced && unack.length && Date.now() - seen.current.lastTone > 6000) { seen.current.lastTone = Date.now(); alarmTone(Math.min(...unack.map(a => a.pri))); }
    const newLog = s.log.filter(l => l.id > seen.current.log);
    if (newLog.length) {
      seen.current.log = newLog.at(-1)!.id;
      const add = newLog.filter(l => l.level !== 'info' && l.cat !== 'RADIO').slice(-4).map(l => ({ id: l.id, text: l.text, level: l.level, t: e.hhmm(l.t), born: Date.now() }));
      if (add.length) setToasts(t => [...t, ...add].slice(-5));
    }
    if (isMaster && s.scen.done && !s.scen.aarShown) { s.scen.aarShown = true; setShowAar(true); }
  });
  useEffect(() => { const id = setInterval(() => setToasts(t => t.filter(x => Date.now() - x.born < 7000)), 1000); return () => clearInterval(id); }, []);

  // Autosave every 30 s (main console only)
  useEffect(() => {
    const id = setInterval(() => { if (roleRef.current === 'master') saveState('autosave', eRef.current.s).catch(() => undefined); }, 30000);
    Promise.all([loadState('autosave'), loadState('manual')]).then(([a, m]) => setSaved({ autosave: a?.savedAt, manual: m?.savedAt })).catch(() => undefined);
    return () => clearInterval(id);
  }, []);

  // ── Context for panels ─────────────────────────────────────
  const peerShowing = (t: Tab) => {
    const now = Date.now();
    for (const [id, p] of peers.current) if (now - p.t < 3500 && p.view === t) return id;
    for (const [id, p] of peers.current) if (now - p.t < 3500 && p.view === 'all') return id;
    return null;
  };
  const setTab = (t: Tab) => {
    if (viewRef.current === 'all') { setTabRaw(t); setMon(t); return; }
    if (viewRef.current === t) return;
    const peer = peerShowing(t);
    if (peer) { post({ type: 'goto', to: peer, tab: t, prefill: prefillRef.current }); prefillRef.current = null; setSwPrefillState(null); return; }
    if (viewRef.current === 'gis' || viewRef.current === 'scada' || viewRef.current === 'sw') setView(t);
    else window.open(viewUrl(t), `gridops-${t}-${Date.now()}`, 'popup,width=1400,height=900');
  };
  const ctx: Ctx = {
    e: ce, sel,
    setSel: (x: Sel) => { setSelLocal(x); post({ type: 'sel', from: WIN_ID, sel: x }); },
    openSbo: r => setSbo(r),
    flyTo: (p, z) => { if (!mapVisRef.current) return; mapApi.current?.flyTo(p, z); },
    setTab,
    swPrefill,
    setSwPrefill: (p: Prefill) => { prefillRef.current = p; setSwPrefillState(p); },
    flash,
  };

  // ── Monitor launcher ───────────────────────────────────────
  const openWin = (v: View, feat = 'popup,width=1400,height=900') => window.open(viewUrl(v), `gridops-${v}-${Date.now()}`, feat);
  const spread = async () => {
    const w = window as any;
    if (!('getScreenDetails' in w)) { flash('This browser cannot place windows on screens automatically — use Chrome or Edge, or open windows and drag them.', 'warn'); return; }
    let sd: any;
    try { sd = await w.getScreenDetails(); } catch { flash('Window placement permission denied — open windows from the list and drag them to each screen.', 'warn'); return; }
    const others = sd.screens.filter((x: any) => x !== sd.currentScreen);
    if (!others.length) { flash('Only one screen detected. Connect and extend a second display first.', 'warn'); return; }
    const plan: View[] = others.length === 1 ? ['gis'] : others.length === 2 ? ['gis', 'scada'] : ['gis', 'scada', 'sw'];
    const queue = plan.map((v, i) => {
      const sc = others[i];
      return { v, label: `${VIEWS.find(x => x[0] === v)![1]} → screen ${i + 2}`, feat: `popup,left=${sc.availLeft},top=${sc.availTop},width=${sc.availWidth},height=${sc.availHeight}` };
    });
    if (others.length === 1) { setView('all'); setTabRaw('scada'); } else setView('ops');
    const left: typeof queue = [];
    for (const q of queue) { const win = openWin(q.v, q.feat); if (!win) left.push(q); }
    setPendingWins(left);
    if (left.length) flash('Browser allowed only one new window per click — use the “Open next” button for the rest.', 'warn');
    else setShowMon(false);
  };

  // ── Header data ────────────────────────────────────────────
  const out = e.customersOut();
  const served = e.T.totalCustomers - out;
  const openInc = e.openIncidents().filter(i => i.status !== 'Restored').length;
  const unackAl = s.alarms.filter(a => !a.acked).length;
  const pendReq = s.requests.filter(r => r.status === 'Pending').length;
  const d = e.clock();
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], mons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const objs = useMemo(() => e.scen.objectives, [e, s.scenario]); // eslint-disable-line react-hooks/exhaustive-deps

  const compact = view === 'all' && narrow;
  const wsCls = view === 'all' ? `ws ${compact ? 'compact' : ''} ${focus && !narrow ? 'focus' : ''}` : `ws single v-${view}`;
  const showMain = view === 'all' || view === 'gis' || view === 'scada' || view === 'sw';
  const curTab: Tab = view === 'gis' || view === 'scada' || view === 'sw' ? view : tab;
  const pickTab = (t: Tab) => (view === 'all' ? (setTabRaw(t), setMon(t)) : setView(t));

  const radio = <RadioPanel keyed={keyed} voiceOn={voiceOn} setVoiceOn={setVoiceOn} audioOn={audioOn && isMaster} />;
  const alarms = <AlarmPanel silenced={silenced} setSilenced={setSilenced} />;

  return (
    <EngineCtx.Provider value={ctx}>
      <div className={wsCls}>
        <div className="topbar">
          <div className="brand"><div className="mark">SME</div><div><div className="n1">SPARKS MUNICIPAL ELECTRIC</div><div className="n2">GRID OPS · DISTRIBUTION CONTROL</div></div></div>
          <div className="tb-sep" />
          <button className="btn" onClick={() => setShowScen(true)} title="Scenarios"><span className="badge cyan">{e.scen.id}</span> {e.scen.name}</button>
          <div className="tb-sep" />
          <div><div className="clock">{e.hhmmss()}</div></div>
          <div className="clockdate">{days[d.getDay()]} {String(d.getDate()).padStart(2, '0')} {mons[d.getMonth()]}<br />{d.getFullYear()} CDT</div>
          <div className="speed">
            <button className={`btn ${s.paused ? 'on' : ''}`} onClick={() => { ce.setPaused(!s.paused); setVer(v => v + 1); }}>{s.paused ? '▶' : '❚❚'}</button>
            {[1, 5, 10].map(x => <button key={x} className={`btn ${!s.paused && s.speed === x ? 'on' : ''}`} onClick={() => { ce.setSpeed(x); setVer(v => v + 1); }}>{x}×</button>)}
          </div>
          <div className="tb-sep" />
          <div className="stat"><span className="k">Served</span><span className="v c-green">{served.toLocaleString()}</span></div>
          <div className="stat"><span className="k">Out</span><span className={`v ${out ? 'c-red' : ''}`}>{out.toLocaleString()}</span></div>
          <div className="stat"><span className="k">Incidents</span><span className={`v ${openInc ? 'c-amber' : ''}`}>{openInc}</span></div>
          <div className="stat"><span className="k">Alarms</span><span className={`v ${unackAl ? 'c-red' : ''}`}>{unackAl}</span></div>
          <div className="tb-sep" />
          <div className={`weather ${s.weather.level}`}>{s.weather.text}</div>
          <span style={{ flex: 1 }} />
          <span className={`linkpill ${isMaster ? 'main' : role === 'replica' ? 'rep' : ''}`} title={isMaster ? 'This window runs the simulation; other windows mirror it' : 'Mirroring the main console — your actions are sent to it'}>
            {role === 'pending' ? 'CONNECTING…' : isMaster ? `MAIN${peerCount ? ` · ${peerCount} LINKED` : ''}` : 'LINKED'}
          </span>
          <label className="aa" title="Desk dispatcher handles routine dispatch / refuse approvals">
            <input type="checkbox" checked={s.autoAssist} onChange={ev => { ce.setAutoAssist(ev.target.checked); setVer(v => v + 1); }} /> Auto-assist
          </label>
          {isMaster && (!audioOn ? <button className="btn pri audio-cta" onClick={() => { unlockAudio(); setAudioOn(true); }}>Enable audio</button>
            : <button className="btn on" onClick={() => { setAudioOn(false); player.current.stop(); }}>Audio on</button>)}
          <button className="btn" onClick={() => saveState('manual', s).then(() => { setSaved(x => ({ ...x, manual: Date.now() })); flash('Session saved to this browser (IndexedDB)', 'good'); })}>Save</button>
          {view === 'all' && !narrow && <button className={`btn ${focus ? 'on' : ''}`} onClick={() => setFocus(!focus)}>{focus ? 'All panels' : 'Map focus'}</button>}
          <button className={`btn ${showMon ? 'on' : ''}`} onClick={() => setShowMon(!showMon)}>Monitors</button>
          <button className="btn" title="Full screen this window" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => undefined); }}>⛶</button>
          <button className="btn" onClick={() => setShowAar(true)}>AAR</button>
        </div>

        {compact && (
          <div className="monbar">
            {([['gis', 'Map'], ['scada', 'SCADA'], ['sw', 'Switching'], ['oms', 'OMS'], ['radio', 'Radio'], ['crew', 'Units'], ['alarms', 'Alarms']] as [Mon, string][]).map(([k, label]) => {
              const badge = k === 'oms' ? openInc : k === 'radio' ? pendReq : k === 'alarms' ? unackAl : 0;
              return <button key={k} className={`btn ${mon === k ? 'on' : ''}`} onClick={() => { setMon(k); if (k === 'gis' || k === 'scada' || k === 'sw') setTabRaw(k); }}>{label}{badge ? <span className={`badge ${k === 'alarms' || k === 'radio' ? 'red' : 'amber'}`} style={{ marginLeft: 4 }}>{badge}</span> : null}</button>;
            })}
          </div>
        )}

        {showMain && (
          <div className="panel mainpane" style={compact && !['gis', 'scada', 'sw'].includes(mon) ? { display: 'none' } : undefined}>
            <div className="ph">
              <div className="tabs">
                <button className={`tab ${curTab === 'gis' ? 'on' : ''}`} onClick={() => pickTab('gis')}>M1 · GIS / System map</button>
                <button className={`tab ${curTab === 'scada' ? 'on' : ''}`} onClick={() => pickTab('scada')}>M2 · SCADA{s.alarms.some(a => !a.acked && a.pri === 1) ? <span className="badge red">!</span> : null}</button>
                <button className={`tab ${curTab === 'sw' ? 'on' : ''}`} onClick={() => pickTab('sw')}>Switching &amp; clearances{s.requests.some(r => r.status === 'Pending' && (r.type === 'clearance' || r.type === 'release')) ? <span className="badge amber">!</span> : null}</button>
              </div>
              <span className="sp" />
              <span className="mono dim" style={{ fontSize: 10 }}>SEED {s.seed} · {e.T.totalCustomers.toLocaleString()} CUST · 6 FEEDERS · 3 SUBS</span>
            </div>
            <div className="pb" style={{ position: 'relative', overflow: 'hidden' }}>
              <GisMap visible={mapVisible} apiRef={mapApi} />
              {curTab === 'scada' && <div style={{ position: 'absolute', inset: 0 }}><ScadaView /></div>}
              {curTab === 'sw' && <div style={{ position: 'absolute', inset: 0 }}><SwitchingView /></div>}
              {curTab !== 'sw' && <Inspector />}
              {curTab === 'gis' && (
                <div className="objbar">
                  <div className="h"><span>Scenario {e.scen.id} objectives</span><a style={{ cursor: 'pointer', color: 'var(--cyan)' }} onClick={() => setShowObj(!showObj)}>{showObj ? 'hide' : 'show'}</a></div>
                  {showObj && objs.map(o => { const st = s.scen.obj[o.id]; return <div key={o.id} className="obj"><span className={st?.status === 'pass' ? 'c-green' : st?.status === 'fail' ? 'c-red' : 'dim'}>{st?.status === 'pass' ? '✔' : st?.status === 'fail' ? '✖' : '○'}</span><span style={{ color: st?.status === 'pending' ? undefined : 'var(--dim)' }}>{o.text}</span></div>; })}
                </div>
              )}
              <div className="toasts">
                {toasts.map(t => <div key={t.id} className={`toast ${t.level}`}><span className="tt">{t.t}</span>{t.text}</div>)}
              </div>
            </div>
          </div>
        )}

        {view === 'all' && !compact && (
          <>
            <div className="rightcol"><OmsPanel />{radio}</div>
            <div className="bottomrow"><CrewBoard />{alarms}</div>
          </>
        )}
        {compact && (
          <>
            {mon === 'oms' && <div className="monwrap"><OmsPanel /></div>}
            {mon === 'radio' && <div className="monwrap">{radio}</div>}
            {mon === 'crew' && <div className="monwrap"><CrewBoard /></div>}
            {mon === 'alarms' && <div className="monwrap">{alarms}</div>}
          </>
        )}
        {view === 'ops' && <div className="opsgrid"><OmsPanel />{radio}<CrewBoard />{alarms}</div>}
        {view === 'oms' && <div className="monwrap"><OmsPanel /></div>}
        {view === 'radio' && <div className="monwrap">{radio}</div>}
        {view === 'crew' && <div className="monwrap"><CrewBoard /></div>}
        {view === 'alarms' && <div className="monwrap">{alarms}</div>}
        {!showMain && toasts.length > 0 && <div className="toasts fixed">{toasts.map(t => <div key={t.id} className={`toast ${t.level}`}><span className="tt">{t.t}</span>{t.text}</div>)}</div>}

        {showMon && (
          <div className="monmenu">
            <div className="sec-t" style={{ marginTop: 0 }}>This window shows</div>
            <select value={view} onChange={ev => setView(ev.target.value as View)} style={{ width: '100%' }}>
              {VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <div className="sec-t">Open a linked window</div>
            {!chan ? <div className="warnbox">This browser blocks window linking here. Open GRID OPS from the Netlify link, or with Chrome/Edge.</div> : (
              <div className="monbtns">
                {VIEWS.map(([v, l]) => <button key={v} className="btn" onClick={() => openWin(v)}>{l}</button>)}
              </div>
            )}
            {chan && <>
              <div className="sec-t">Auto-arrange</div>
              <button className="btn pri" style={{ width: '100%' }} onClick={spread}>Spread across all screens</button>
              {pendingWins.length > 0 && (
                <button className="btn warn" style={{ width: '100%', marginTop: 4 }} onClick={() => { const [q, ...rest] = pendingWins; if (openWin(q.v, q.feat)) setPendingWins(rest); }}>Open next: {pendingWins[0].label}</button>
              )}
              <div className="dim" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.45 }}>
                2 screens: map on screen 2, full console (SCADA up) here.<br />3 screens: map, SCADA, and Ops desk here.<br />Press ⛶ in each window to go full screen.
              </div>
            </>}
            <div className="sec-t">Linked windows</div>
            <div style={{ fontSize: 11 }}>
              <div><span className="mono">{isMaster ? 'MAIN' : 'LINKED'}</span> · this window · {VIEWS.find(x => x[0] === view)![1]}</div>
              {[...peers.current.entries()].map(([id, p]) => <div key={id} className="dim"><span className="mono">{p.master ? 'MAIN' : 'LINKED'}</span> · {VIEWS.find(x => x[0] === p.view)?.[1] ?? p.view}</div>)}
            </div>
          </div>
        )}
      </div>

      {role === 'pending' && <div className="modal-bg"><div className="mono" style={{ color: 'var(--cyan)' }}>Connecting to GRID OPS console…</div></div>}
      {sbo && <SboModal req={sbo} onClose={() => setSbo(null)} />}
      {showScen && <ScenarioModal current={e.scen.id} onStart={start} onClose={() => setShowScen(false)} saved={saved} onResume={() => resume('autosave')} onLoadManual={() => resume('manual')} />}
      {showAar && <AarModal onClose={() => setShowAar(false)} onNew={() => { setShowAar(false); setShowScen(true); }} />}
    </EngineCtx.Provider>
  );
}
