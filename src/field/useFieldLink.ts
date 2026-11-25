// Console side of the field link. Runs only in the main console window:
// drains the engine's field outbox to the session, publishes the yard
// snapshot for the phone map, and feeds crew events into the engine.
import { useEffect, useState } from 'react';
import type { Engine } from '../sim/engine';
import { yardSnapshot } from '../sim/field';
import { getBackend } from './backend';
import { addRadio } from './radioStore';
import { chirp } from './fieldRadio';
import { pushToCrews } from './push';
import type { ToCrew } from '../sim/types';

/** Which crew messages buzz the phone when the app is closed. */
function notifFor(m: ToCrew): { title: string; body: string; tag: string } | null {
  const t = m.text.replace(/^[A-Z]+-\d+:\s*/, '');
  switch (m.kind) {
    case 'dispatch': return m.state === 'issued' ? { title: 'DISPATCH — Sparks Control', body: m.text, tag: 'dispatch' } : null;
    case 'step':
      if (m.state === 'issued') return { title: `STEP ${m.step} — read it back`, body: m.text, tag: `step-${m.id}` };
      if (m.state === 'repeat') return { title: 'NEGATIVE — read it back again', body: m.text, tag: `step-${m.id}` };
      if (m.state === 'cleared') return { title: 'CLEARED TO OPERATE', body: `${(m.action ?? '').toUpperCase()} ${m.dev ?? ''} — tap the tag when done`, tag: `step-${m.id}` };
      return null;
    case 'clearance': return m.state === 'issued' ? { title: `CLEARANCE ${m.clearance ?? ''} ISSUED`, body: m.text, tag: 'clearance' } : m.state === 'released' ? { title: 'Release acknowledged', body: m.text, tag: 'clearance' } : null;
    case 'job':
      if (m.jobStatus === 'Assigned') return { title: m.trouble ? 'TROUBLE CALL' : 'NEW WORK ORDER', body: m.text, tag: `job-${m.job}` };
      if (m.briefStatus === 'approved' && m.jobStatus === 'On site') return { title: 'Job brief APPROVED', body: `${m.job}: you're clear to continue`, tag: `job-${m.job}` };
      if (m.briefStatus === 'returned') return { title: 'Job brief RETURNED', body: `${m.job}: ${m.briefNote ?? 'see the app'}`, tag: `job-${m.job}` };
      return null;
    case 'info': return { title: 'Sparks Control', body: t, tag: 'info' };
    default: return null;
  }
}

export interface LinkStatus { ok: boolean; err: string | null; lastSent: number; lastHeard: number; kind: 'firebase' | 'local'; }

export function useFieldLink(e: Engine, isMaster: boolean): LinkStatus | null {
  const code = e.s.field?.code ?? null;
  const [st, setSt] = useState<LinkStatus | null>(null);
  useEffect(() => {
    if (!isMaster || !code) { setSt(null); return; }
    const be = getBackend();
    let status: LinkStatus = { ok: true, err: null, lastSent: 0, lastHeard: 0, kind: be.kind };
    const set = (p: Partial<LinkStatus>) => { status = { ...status, ...p }; setSt(status); };
    set({});
    const started = Date.now();
    const un = be.onFromCrew(code, ev => {
      if (ev.kind === 'radio') {
        const at = typeof ev.sentAt === 'number' ? ev.sentAt : Date.now();
        addRadio({ id: ev.id, from: ev.truck, to: 'OPS', at, clock: e.hhmm(), text: ev.text, audio: ev.audio, mime: ev.mime, dur: ev.dur }, true);
        e.fieldEvent({ ...ev, audio: ev.audio ? 'clip' : undefined });
        set({ lastHeard: Date.now() });
        return;
      }
      const r = e.fieldEvent(ev);
      // Ping the operator when a crew checks in at a tag or sends a brief (not for replays on reload).
      if (Date.now() - started > 4000 && !r && (ev.kind === 'brief' || (ev.kind === 'status' && ev.status === 'On site'))) chirp();
      if (r) console.info('field event', ev.kind, ev.truck, '→', r);
      set({ lastHeard: Date.now() });
    });
    const unCrews = be.onCrews(code, crews => { for (const [t, c] of Object.entries(crews)) if (c.gps) e.fieldGps(t, c.gps); });
    let busy = false, lastSnap = '', lastSnapAt = 0;
    const id = setInterval(async () => {
      if (busy || !e.s.field) return;
      busy = true;
      try {
        const out = e.s.field.outbox.splice(0);
        if (out.length) {
          try {
            await be.sendToCrew(code, out); set({ ok: true, err: null, lastSent: Date.now() });
            for (const m of out) { const n = notifFor(m); if (n) pushToCrews(code, [m.truck], n, `${m.id}|${m.state}|${m.jobStatus ?? ''}|${m.briefStatus ?? ''}`); }
          }
          catch (err: any) { e.s.field.outbox.unshift(...out); set({ ok: false, err: err?.message ?? String(err) }); }
        }
        const snap = yardSnapshot(e);
        const key = JSON.stringify([snap.dev, snap.live, snap.trucks]);
        if (key !== lastSnap || Date.now() - lastSnapAt > 30000) {
          try { await be.publishState(code, snap); lastSnap = key; lastSnapAt = Date.now(); }
          catch (err: any) { set({ ok: false, err: err?.message ?? String(err) }); }
        }
      } finally { busy = false; }
    }, 700);
    return () => { clearInterval(id); un(); unCrews(); };
  }, [e, isMaster, code]);
  return st;
}
