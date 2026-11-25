// Console "Texas Ops" view: the NLC yard, big, with live device states and crews —
// plus the yard editor (add / move / delete poles, spans, switches, loads, job tags).
// Edits are a draft in this browser until "Save for everyone" (instructor password).
// Saved changes take effect the next time Sparks Command and the phones load.
import { useEffect, useMemo, useState } from 'react';
import { useCtx } from './ctx';
import { YardSvg } from '../field/YardSvg';
import { yardSnapshot } from '../sim/field';
import { YARD_AREAS, currentYardDoc, defaultYardDoc, checkYardDoc, type YardDoc, type YardDocLink, type YardDevType } from '../sim/texasYard';
import { inPolyXY } from './yardGeom';
import { saveYard, yardSource, yardSavedAt } from '../field/yardStore';

type Mode = 'view' | 'select' | 'pole' | 'line' | 'span' | 'dev' | 'move' | 'delete' | 'job' | 'load';
const MODES: { m: Mode; label: string; tip: string }[] = [
  { m: 'select', label: 'Select', tip: 'Click a pole to see or change it' },
  { m: 'pole', label: '+ Work pole', tip: 'Click the map to add a work-area pole (it joins the area you click in)' },
  { m: 'line', label: '+ Line pole', tip: 'Click the map to add a line pole' },
  { m: 'span', label: 'Span', tip: 'Click two line poles to add a span between them (or remove it if it exists)' },
  { m: 'dev', label: 'Device', tip: 'Click a span: none → switch → N.O. switch → recloser → none' },
  { m: 'move', label: 'Move', tip: 'Drag poles to move them' },
  { m: 'job', label: 'Job tag', tip: 'Click a pole to give it (or take away) an NFC/QR job tag' },
  { m: 'load', label: 'Load', tip: 'Click a line pole to add, rename or remove the building it feeds' },
  { m: 'delete', label: 'Delete', tip: 'Click a pole or a span to delete it' },
];
const DRAFT = 'gridops-yard-draft';

export function TexasOpsView() {
  const { e, flash } = useCtx();
  const [mode, setMode] = useState<Mode>('view');
  const [doc, setDocRaw] = useState<YardDoc>(() => { try { const d = JSON.parse(localStorage.getItem(DRAFT) ?? 'null'); if (d?.v === 1) return d; } catch { /* none */ } return currentYardDoc(); });
  const [hist, setHist] = useState<YardDoc[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const live = useMemo(() => JSON.stringify(currentYardDoc()), []);
  const dirty = JSON.stringify(doc) !== live;
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);
  const setDoc = (fn: (d: YardDoc) => YardDoc | void) => {
    const next: YardDoc = JSON.parse(JSON.stringify(doc));
    const r = fn(next) ?? next;
    setHist(h => [...h.slice(-50), doc]); setDocRaw(r);
    try { localStorage.setItem(DRAFT, JSON.stringify(r)); } catch { /* full */ }
  };
  const editing = mode !== 'view';
  const snap = editing && dirty ? null : yardSnapshot(e);

  const nextId = (prefix: string, pad = 2) => { for (let n = 1; ; n++) { const id = `${prefix}${String(n).padStart(pad, '0')}`; if (!doc.poles[id]) return id; } };
  const nextLine = () => { for (let n = 1; ; n++) if (!doc.poles[`L${n}`]) return `L${n}`; };
  const usedDev = new Set(doc.links.flatMap(l => (l.dev ? [l.dev.id] : [])));
  const nextDev = (p: string) => { for (let n = 11; n < 100; n++) { const id = `${p}-41${n}`; if (!usedDev.has(id)) return id; } return `${p}-${Date.now() % 10000}`; };
  const areaAt = (xy: [number, number]) => YARD_AREAS.filter(a => a.poly.length >= 3 && a.kind !== 'lap' && a.kind !== 'equipment' && a.kind !== 'urd').find(a => inPolyXY(xy, a.poly)) ?? YARD_AREAS.find(a => a.poly.length >= 3 && inPolyXY(xy, a.poly)) ?? null;
  const spanIdx = (a: string, b: string) => doc.links.findIndex(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));

  const onPole = (id: string) => {
    const p = doc.poles[id];
    if (mode === 'select' || mode === 'view') { setSel(id); return; }
    if (mode === 'job') { setDoc(d => { d.poles[id].job = !d.poles[id].job; }); flash(`${id}: job tag ${p.job ? 'removed' : 'added'}`); return; }
    if (mode === 'delete') {
      if (Object.values(doc.sources).includes(id)) { flash(`${id} is a source — it can't be deleted (move it instead)`, 'warn'); return; }
      setDoc(d => { delete d.poles[id]; d.links = d.links.filter(l => l.a !== id && l.b !== id); delete d.loads[id]; });
      if (sel === id) setSel(null);
      flash(`Deleted ${id}`); return;
    }
    if (mode === 'span') {
      if (p.area !== 'LINE') { flash('Spans only run between line poles', 'warn'); return; }
      if (!pending) { setPending(id); return; }
      if (pending === id) { setPending(null); return; }
      const i = spanIdx(pending, id);
      setDoc(d => { if (i >= 0) d.links.splice(i, 1); else d.links.push({ a: pending, b: id }); });
      flash(i >= 0 ? `Removed span ${pending}–${id}` : `Added span ${pending}–${id}`);
      setPending(id); return;
    }
    if (mode === 'load') {
      if (p.area !== 'LINE') { flash('Loads sit on line poles', 'warn'); return; }
      const cur = doc.loads[id];
      const name = prompt(cur ? `Building fed from ${id} (blank to remove):` : `Name of the building fed from ${id}:`, cur?.name ?? '');
      if (name === null) return;
      setDoc(d => { if (!name.trim()) delete d.loads[id]; else d.loads[id] = { name: name.trim().toUpperCase(), kw: cur?.kw ?? 25, ...(cur?.critical ? { critical: true } : {}) }; });
      return;
    }
  };
  const onSpan = (i: number) => {
    const l = doc.links[i];
    if (mode === 'delete') { setDoc(d => { d.links.splice(i, 1); }); flash(`Deleted span ${l.a}–${l.b}`); return; }
    if (mode !== 'dev') return;
    const order: (null | { type: YardDevType; no?: boolean })[] = [null, { type: 'switch' }, { type: 'switch', no: true }, { type: 'recloser' }];
    const k = !l.dev ? 0 : l.dev.type === 'recloser' ? 3 : l.dev.no ? 2 : 1;
    const nx = order[(k + 1) % order.length];
    setDoc(d => {
      const L: YardDocLink = d.links[i];
      if (!nx) { delete L.dev; return; }
      const at = L.dev?.at ?? L.b;
      const pre = nx.type === 'recloser' ? 'R' : nx.no ? 'TS' : 'S';
      const keep = L.dev && L.dev.id.startsWith(pre + '-');
      L.dev = { type: nx.type, id: keep ? L.dev!.id : nextDev(pre), at, ...(nx.no ? { no: true } : {}), ...(nx.type === 'recloser' ? { scada: true } : {}) };
    });
  };
  const onEmpty = (xy: [number, number]) => {
    if (mode === 'pole') {
      const a = areaAt(xy);
      const area = a && Object.keys(a.poles).length + 1 && a.id !== 'LAP' && a.id !== 'EQ' && a.id !== 'URD' ? a : YARD_AREAS.find(x => x.id === 'YD')!;
      const id = nextId(`${area.id}-`);
      setDoc(d => { d.poles[id] = { xy: [Math.round(xy[0] * 10) / 10, Math.round(xy[1] * 10) / 10], area: area.id }; });
      setSel(id); flash(`Added ${id}${area.name ? ` in ${area.name}` : ''}`); return;
    }
    if (mode === 'line') {
      const id = nextLine();
      setDoc(d => { d.poles[id] = { xy: [Math.round(xy[0] * 10) / 10, Math.round(xy[1] * 10) / 10], area: 'LINE' }; });
      setSel(id); flash(`Added line pole ${id} — use Span to connect it`); return;
    }
    setSel(null); setPending(null);
  };
  const onMove = (id: string, xy: [number, number]) => { setDocRaw(d => { const n = { ...d, poles: { ...d.poles, [id]: { ...d.poles[id], xy: [Math.round(xy[0] * 10) / 10, Math.round(xy[1] * 10) / 10] as [number, number] } } }; try { localStorage.setItem(DRAFT, JSON.stringify(n)); } catch { /* */ } return n; }); };

  const rename = (id: string) => {
    const nid = prompt(`New number for ${id}:`, id)?.trim().toUpperCase();
    if (!nid || nid === id) return;
    if (doc.poles[nid]) { flash(`${nid} already exists`, 'warn'); return; }
    if (!/^[A-Z0-9-]{1,10}$/.test(nid)) { flash('Use letters, numbers and dashes (max 10)', 'warn'); return; }
    setDoc(d => {
      d.poles[nid] = d.poles[id]; delete d.poles[id];
      for (const l of d.links) { if (l.a === id) l.a = nid; if (l.b === id) l.b = nid; if (l.dev?.at === id) l.dev.at = nid; }
      if (d.loads[id]) { d.loads[nid] = d.loads[id]; delete d.loads[id]; }
      for (const k of Object.keys(d.sources) as (keyof YardDoc['sources'])[]) if (d.sources[k] === id) d.sources[k] = nid;
    });
    setSel(nid);
  };
  const save = async () => {
    const bad = checkYardDoc(doc);
    if (bad.length) { flash(bad[0], 'warn'); return; }
    const pw = prompt('Instructor password to save the yard for everyone:');
    if (!pw) return;
    setBusy(true);
    try {
      await saveYard(doc, pw);
      try { localStorage.removeItem(DRAFT); } catch { /* */ }
      flash('Yard saved. Reload Sparks Command and the crew phones to use it.', 'good');
    } catch (err: any) { flash(err?.message ?? String(err), 'warn'); } finally { setBusy(false); }
  };

  const sp = sel ? doc.poles[sel] : null;
  const spLinks = sel ? doc.links.filter(l => l.a === sel || l.b === sel) : [];
  const problems = checkYardDoc(doc);
  const counts = { poles: Object.keys(doc.poles).length, line: Object.values(doc.poles).filter(p => p.area === 'LINE').length, jobs: Object.values(doc.poles).filter(p => p.job).length, devs: doc.links.filter(l => l.dev).length };

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 6, padding: 8, overflow: 'hidden' }}>
      <div className="form-row" style={{ flexWrap: 'wrap', margin: 0 }}>
        <b style={{ marginRight: 6 }}>NLC Texas yard</b>
        <button className={`btn sm ${mode === 'view' ? 'on' : ''}`} onClick={() => { setMode('view'); setPending(null); }}>Live view</button>
        <span className="dim" style={{ margin: '0 4px' }}>Edit:</span>
        {MODES.map(x => <button key={x.m} title={x.tip} className={`btn sm ${mode === x.m ? 'on' : ''}`} onClick={() => { setMode(x.m); setPending(null); }}>{x.label}</button>)}
        <span style={{ flex: 1 }} />
        <button className="btn sm" disabled={!hist.length} onClick={() => { const p = hist[hist.length - 1]; setHist(h => h.slice(0, -1)); setDocRaw(p); try { localStorage.setItem(DRAFT, JSON.stringify(p)); } catch { /* */ } }}>Undo</button>
        <button className="btn sm" onClick={() => { if (confirm('Throw away the draft and go back to the saved yard?')) { setHist(h => [...h, doc]); setDocRaw(currentYardDoc()); try { localStorage.removeItem(DRAFT); } catch { /* */ } } }}>Discard draft</button>
        <button className="btn sm" onClick={() => { if (confirm('Start over from the built-in yard (traced from the screenshots)?')) setDoc(() => defaultYardDoc()); }}>Built-in yard</button>
        <button className="btn sm pri" disabled={!dirty || busy || problems.length > 0} title={problems[0]} onClick={save}>{busy ? 'Saving…' : 'Save for everyone'}</button>
      </div>
      <div className="dim" style={{ fontSize: 11 }}>
        {mode === 'view' ? 'Live yard — device colors and crew positions update with the sim. ' : MODES.find(x => x.m === mode)!.tip + '. '}
        {counts.poles} poles ({counts.line} line) · {counts.devs} devices · {counts.jobs} job tags · yard: {yardSource}{yardSavedAt ? ` (${new Date(yardSavedAt).toLocaleString()})` : ''}
        {dirty && <span className="c-amber"> · DRAFT not saved — the live network uses the saved yard until you save and reload</span>}
        {problems.length > 0 && <span className="c-red"> · {problems[0]}</span>}
        {pending && <span className="c-amber"> · span from {pending}: click the next line pole</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
          <YardSvg doc={doc} snap={snap} height="100%" labelPx={10} minLabelZoom={1.25}
            edit={{ onPole, onSpan: mode === 'dev' || mode === 'delete' ? onSpan : undefined, onEmpty, onMove, drag: mode === 'move', selected: sel, pending }} />
        </div>
        {sp && sel && <div style={{ width: 230, flex: 'none', overflow: 'auto' }} className="panel-sub">
          <div className="sec-t">Pole {sel}</div>
          <div className="form-row"><button className="btn sm" onClick={() => rename(sel)}>Renumber…</button></div>
          <div className="form-row"><label className="dim" style={{ width: 50 }}>Type</label>
            <select value={sp.area} onChange={ev => { const v = ev.target.value; setDoc(d => { d.poles[sel].area = v; if (v !== 'LINE') { d.links = d.links.filter(l => l.a !== sel && l.b !== sel); delete d.loads[sel]; } }); }}>
              <option value="LINE">Line pole</option>
              {YARD_AREAS.filter(a => a.id !== 'LAP' && a.id !== 'EQ' && a.id !== 'URD').map(a => <option key={a.id} value={a.id}>{a.name || 'Loose pole (no area)'}</option>)}
            </select></div>
          <label className="chk"><input type="checkbox" checked={!!sp.job} onChange={ev => { const v = ev.target.checked; setDoc(d => { d.poles[sel].job = v; }); }} /> Job tag (NFC/QR)</label>
          {sp.area === 'LINE' && <>
            <div className="dim" style={{ marginTop: 6 }}>Spans</div>
            {spLinks.length ? spLinks.map(l => <div key={`${l.a}-${l.b}`} className="mono" style={{ fontSize: 11 }}>{l.a}–{l.b}{l.dev ? ` · ${l.dev.id}${l.dev.no ? ' N.O.' : ''}` : ''}</div>) : <div className="dim">None — use Span to connect it.</div>}
            {doc.loads[sel] && <div style={{ marginTop: 6 }}>Feeds <b>{doc.loads[sel].name}</b> <label className="chk"><input type="checkbox" checked={!!doc.loads[sel].critical} onChange={ev => { const v = ev.target.checked; setDoc(d => { d.loads[sel].critical = v || undefined; }); }} /> Critical</label></div>}
            {Object.entries(doc.sources).map(([f, s]) => s === sel ? <div key={f} className="c-amber">Source for {f}</div> : null)}
          </>}
          <div className="dim" style={{ marginTop: 6, fontSize: 11 }}>x {sp.xy[0]} · y {sp.xy[1]}</div>
        </div>}
      </div>
    </div>
  );
}
