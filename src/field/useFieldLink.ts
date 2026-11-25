// Console side of the field link. Runs only in the main console window:
// drains the engine's field outbox to the session, publishes the yard
// snapshot for the phone map, and feeds crew events into the engine.
import { useEffect, useState } from 'react';
import type { Engine } from '../sim/engine';
import { yardSnapshot } from '../sim/field';
import { getBackend } from './backend';
import { addRadio } from './radioStore';

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
    const un = be.onFromCrew(code, ev => {
      if (ev.kind === 'radio') {
        const at = typeof ev.sentAt === 'number' ? ev.sentAt : Date.now();
        addRadio({ id: ev.id, from: ev.truck, to: 'OPS', at, clock: e.hhmm(), text: ev.text, audio: ev.audio, mime: ev.mime, dur: ev.dur }, true);
        e.fieldEvent({ ...ev, audio: ev.audio ? 'clip' : undefined });
        set({ lastHeard: Date.now() });
        return;
      }
      const r = e.fieldEvent(ev);
      if (r) console.info('field event', ev.kind, ev.truck, '→', r);
      set({ lastHeard: Date.now() });
    });
    let busy = false, lastSnap = '', lastSnapAt = 0;
    const id = setInterval(async () => {
      if (busy || !e.s.field) return;
      busy = true;
      try {
        const out = e.s.field.outbox.splice(0);
        if (out.length) {
          try { await be.sendToCrew(code, out); set({ ok: true, err: null, lastSent: Date.now() }); }
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
    return () => { clearInterval(id); un(); };
  }, [e, isMaster, code]);
  return st;
}
