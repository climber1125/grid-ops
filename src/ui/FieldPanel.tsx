// Console Field panel: join code, crew phones, send-to-device, and the
// no-tag fallback when a phone can't report.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useCtx, age } from './ctx';
import type { DevEl } from '../sim/types';
import { devWord } from '../sim/radio';
import { YARD_HOME } from '../sim/field';
import { JOB_POLES, ALL_POLES, areaOfPole, isLinePole } from '../sim/texasYard';

export function joinUrl(code: string, local: boolean) {
  return `${location.origin}/field?code=${code}${local ? '&fieldlocal=1' : ''}`;
}

function QrImg({ text, size = 120 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: size * 2 }).then(setSrc).catch(() => setSrc('')); }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt="Join QR" style={{ background: '#fff', borderRadius: 3 }} /> : null;
}

export function FieldPanel() {
  const { e, flash, flyTo, fieldLink, setSel } = useCtx();
  const f = e.s.field;
  const crews = Object.values(e.s.trucks).filter(t => t.field).sort((a, b) => a.id.localeCompare(b.id));
  const yardDevs = e.T.devIds.filter(id => { const d = e.T.els[id] as DevEl; return d.feeder?.startsWith('TX') && d.type !== 'xfmr'; });
  const [truck, setTruck] = useState('');
  const [dev, setDev] = useState(yardDevs[0] ?? '');
  const [note, setNote] = useState('');
  const [jk, setJk] = useState<'crossarm' | 'guy' | 'other'>('crossarm');
  const [jp, setJp] = useState(JOB_POLES[0]);
  const [jn, setJn] = useState('');
  const [asg, setAsg] = useState<Record<string, string>>({});
  if (!f?.code) return <div className="dim">No field session.</div>;
  const url = joinUrl(f.code, f.backend === 'local');
  const pick = truck && crews.some(c => c.id === truck) ? truck : crews[0]?.id ?? '';
  const jobs = Object.values(f.jobs ?? {}).sort((a, b) => a.id.localeCompare(b.id));
  const waitingTap = Object.values(e.s.orders).filter(o => o.status === 'Active' && o.steps[o.cur]?.status === 'InProgress' && e.s.trucks[o.steps[o.cur].exec]?.field);
  const linkTxt = !fieldLink ? 'Link runs in the main console window' : fieldLink.ok ? `Connected (${fieldLink.kind === 'local' ? 'local test' : 'Firebase'})${fieldLink.lastHeard ? ` · last crew message ${age((Date.now() - fieldLink.lastHeard) / 1000)} ago` : ''}` : `Link problem: ${fieldLink.err}`;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <QrImg text={url} />
        <div>
          <div className="dim" style={{ fontSize: 10 }}>JOIN CODE</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '.15em' }}>{f.code}</div>
          <div className="mono dim" style={{ fontSize: 10 }}>{url.replace(/^https?:\/\//, '')}</div>
          <div style={{ fontSize: 11, marginTop: 4 }} className={fieldLink && !fieldLink.ok ? 'c-red' : 'c-green'}>● {linkTxt}</div>
          <div className="acts" style={{ marginTop: 4 }}>
            <button className="btn sm" onClick={() => flyTo(YARD_HOME, 18)}>Texas Campus on map</button>
            <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(url); flash('Join link copied'); }}>Copy link</button>
            <a className="btn sm" href={`/field/tags?code=${f.code}${f.backend === 'local' ? '&fieldlocal=1' : ''}`} target="_blank" rel="noreferrer">Tag labels…</a>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 380 }}>
        <table className="grid">
          <thead><tr><th>Unit</th><th>Foreman / crew</th><th>Status</th><th>At</th><th>Sent to</th><th>Updated</th></tr></thead>
          <tbody>
            {crews.length ? crews.map(t => (
              <tr key={t.id} className="row" onClick={() => { setSel({ kind: 'truck', id: t.id }); flyTo(t.pos, 18); setTruck(t.id); }}>
                <td className="mono"><b>{t.id}</b>{t.clearance ? <span className="badge amber" style={{ marginLeft: 3 }}>{t.clearance}</span> : null}</td>
                <td>{t.field!.foreman}{t.field!.members.length ? <span className="dim"> + {t.field!.members.join(', ')}</span> : null}</td>
                <td><span className={`chip ${t.status.replace(/\s+/g, '')}`}>{t.field!.status}</span></td>
                <td className="mono">{t.field!.at === 'yard' ? 'Yard' : t.field!.at}</td>
                <td className="mono">{t.field!.dest ?? '—'}</td>
                <td className="mono dim">{age(e.s.t - t.field!.lastT)} ago</td>
              </tr>
            )) : <tr><td colSpan={6} className="dim">Waiting for crews to join with code {f.code}…</td></tr>}
          </tbody>
        </table>

        <div className="sec-t">Send a crew to a device</div>
        <div className="form-row">
          <select value={pick} onChange={ev => setTruck(ev.target.value)} disabled={!crews.length}>{crews.map(c => <option key={c.id} value={c.id}>{c.id} — {c.field!.foreman}</option>)}</select>
          <select value={dev} onChange={ev => setDev(ev.target.value)}>
            <optgroup label="Devices">{yardDevs.map(id => <option key={id} value={id}>{id} · {devWord(e.T.els[id] as DevEl)} · {(e.T.els[id] as DevEl).loc}</option>)}</optgroup>
            <optgroup label="Job poles">{JOB_POLES.map(p => <option key={p} value={p}>{p} · {areaOfPole(p)?.name ?? 'line pole'}</option>)}</optgroup>
          </select>
          <input placeholder="Note (optional)" value={note} onChange={ev => setNote(ev.target.value)} style={{ width: 160 }} />
          <button className="btn pri" disabled={!pick} onClick={() => { const r = e.fieldSendTo(pick, dev, note.trim()); if (r) flash(r, 'warn'); else { flash(`Sent ${pick} to ${dev}`, 'good'); setNote(''); } }}>Send</button>
        </div>

        <div className="sec-t">Yard work orders</div>
        <table className="grid">
          <thead><tr><th>WO</th><th>Job</th><th>Pole</th><th>Status</th><th>Crew</th><th></th></tr></thead>
          <tbody>{jobs.length ? jobs.map(j => (
            <tr key={j.id}>
              <td className="mono"><b>{j.id}</b>{j.needsClearance ? <span className="badge red" style={{ marginLeft: 3 }}>LINE</span> : null}</td>
              <td>{j.text}</td>
              <td className="mono">{j.pole}<span className="dim"> {areaOfPole(j.pole)?.name ?? ''}</span></td>
              <td>{j.status}</td>
              <td className="mono">{j.truck ?? '—'}</td>
              <td>{j.status !== 'Complete' && j.status !== 'Cancelled' && crews.length > 0 && <span className="form-row" style={{ margin: 0 }}>
                <select value={asg[j.id] ?? j.truck ?? crews[0].id} onChange={ev => setAsg(a => ({ ...a, [j.id]: ev.target.value }))}>{crews.map(c => <option key={c.id} value={c.id}>{c.id}</option>)}</select>
                <button className="btn sm" onClick={() => { const r = e.fieldAssign(j.id, asg[j.id] ?? j.truck ?? crews[0].id); if (r) flash(r, 'warn'); }}>{j.truck ? 'Reassign' : 'Assign'}</button>
              </span>}</td>
            </tr>
          )) : <tr><td colSpan={6} className="dim">No yard work orders yet.</td></tr>}</tbody>
        </table>
        <div className="form-row">
          <select value={jk} onChange={ev => setJk(ev.target.value as any)}><option value="crossarm">Crossarm change-out</option><option value="guy">Guy wire tensioning</option><option value="other">Other work</option></select>
          <select value={jp} onChange={ev => setJp(ev.target.value)}>
            <optgroup label="Job poles (tagged)">{JOB_POLES.map(p => <option key={p} value={p}>{p} · {areaOfPole(p)?.name ?? 'line pole'}</option>)}</optgroup>
            <optgroup label="All poles">{Object.keys(ALL_POLES).filter(p => !JOB_POLES.includes(p)).map(p => <option key={p} value={p}>{p} · {areaOfPole(p)?.name ?? 'line pole'}</option>)}</optgroup>
          </select>
          <input placeholder="Details (optional)" value={jn} onChange={ev => setJn(ev.target.value)} style={{ width: 160 }} />
          <button className="btn" onClick={() => { const r = e.fieldJob(jk, jp, jn.trim()); if (r) flash(r, 'warn'); else { flash(`Yard work order created at ${jp}${isLinePole(jp) ? ' — on the line, needs a clearance' : ''}`, 'good'); setJn(''); } }}>New work order</button>
        </div>

        {waitingTap.length > 0 && <>
          <div className="sec-t">Waiting on a tag tap</div>
          {waitingTap.map(o => { const st = o.steps[o.cur]; return (
            <div key={o.id} className="form-row">
              <span className="mono">{o.id} step {o.cur + 1}: {st.action.toUpperCase()} {st.dev} — Truck {st.exec}</span>
              <button className="btn sm" title="Use only when the crew reported it done on the radio and the phone can't send" onClick={() => { const r = e.fieldManual(o.id); if (r) flash(r, 'warn'); }}>Crew reported done by radio (no tag)</button>
            </div>
          ); })}
        </>}
      </div>
    </div>
  );
}
