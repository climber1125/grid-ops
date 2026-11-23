// ─────────────────────────────────────────────────────────────
// Field scenario: real crews on phones, mixed in with sim crews.
//
// The engine stays pure. Everything the operator sends a real crew goes
// into s.field.outbox (the link layer writes it to the shared session),
// and every crew event arrives through fieldApply(). Real crews are never
// driven or animated by the sim: they move when the foreman updates them,
// and devices change only when the crew taps the tag and confirms.
// ─────────────────────────────────────────────────────────────
import type { Engine } from './engine';
import type { FieldState, FieldStatus, FromCrew, ToCrew, Truck, SwitchingOrder, SwStep, LineEl, DevEl } from './types';
import { sectionAround } from './network';
import { stepPhrase, ACTION_LABEL, devWord } from './radio';
import { YARD_SUB, yardPos } from './texasYard';
import { offset } from './geo';

export const YARD_HOME = yardPos([YARD_SUB.at[0] - 60, YARD_SUB.at[1] - 70]);

export function fieldState(e: Engine): FieldState {
  return (e.s.field ??= { code: null, backend: null, outbox: [], sent: {}, seen: {} });
}
export function fieldInit(e: Engine, code: string, backend: 'firebase' | 'local') {
  const f = fieldState(e);
  f.code = code; f.backend = backend;
  e.log('SCENARIO', 'info', `Field session ${code} open — crews join from their phones with this code.`);
  e.bump();
}
export const isField = (tr: Truck | undefined | null) => !!tr?.field;

/** Queue a message for a real crew (new or updated). */
export function fieldSend(e: Engine, msg: Omit<ToCrew, 't'> & { t?: number }) {
  const f = fieldState(e);
  const m: ToCrew = { ...f.sent[msg.id], ...msg, t: e.s.t } as ToCrew;
  f.sent[m.id] = m;
  f.outbox.push({ ...m });
  e.bump();
  return m;
}
const stepMsgId = (o: SwitchingOrder, idx: number) => `${o.id}-${idx + 1}`;

const STATUS_MAP: Record<FieldStatus, Truck['status']> = { 'At yard': 'Available', 'En route': 'En Route', 'On site': 'On Scene', Working: 'Working', 'Standing by': 'Standing By' };
function posOf(e: Engine, at: string | undefined) {
  if (!at || at === 'yard') return YARD_HOME;
  const d = e.T.els[at] as DevEl | undefined;
  return d?.kind === 'device' ? offset(d.pos, 4, -4) : YARD_HOME;
}

// ── Operator side ───────────────────────────────────────────
/** Send a real crew to a device. Their dot moves when the foreman updates. */
export function fieldDispatch(e: Engine, truck: string, dev: string, note = ''): string | null {
  const tr = e.s.trucks[truck];
  if (!tr?.field) return `${truck} is not a field crew`;
  const d = e.T.els[dev] as DevEl | undefined;
  if (!d || d.kind !== 'device') return `Unknown device ${dev}`;
  tr.field.dest = dev;
  fieldSend(e, { id: `${truck}-D${e.s.seq++}`, truck, kind: 'dispatch', dev, text: `Go to ${devWord(d)} ${dev} at ${d.loc}${note ? ` — ${note}` : ''}.`, state: 'issued' });
  e.log('DISPATCH', 'info', `Sent field crew ${truck} to ${dev} (${d.loc})${note ? ` — ${note}` : ''}`);
  e.decision(`Sent field crew ${truck} to ${dev}`);
  return null;
}

/** Engine hook: issuing a switching step to a real crew. The read-back happens on the real radio. */
export function fieldIssueStep(e: Engine, tr: Truck, o: SwitchingOrder, st: SwStep) {
  const d = e.T.els[st.dev] as DevEl;
  st.status = 'RepeatBack'; st.rbDev = st.dev; st.rbAction = st.action; st.note = undefined;
  (e as any).stepLog(st, `Issued to field crew ${tr.id} (radio read-back by the crew)`);
  fieldSend(e, {
    id: stepMsgId(o, o.cur), truck: tr.id, kind: 'step', order: o.id, step: o.cur + 1, dev: st.dev, action: st.action, loop: st.loop,
    text: `Switching order ${o.id}, step ${o.cur + 1}: ${stepPhrase(st.action, d, st.dev)}${st.loop ? ', loop close,' : ''} at ${d.loc}.`, state: 'issued',
  });
  e.log('SCADA', 'info', `${o.id} step ${o.cur + 1} issued to field crew ${tr.id}: ${ACTION_LABEL[st.action]} ${st.dev} — listen for the read-back on the radio`);
  e.decision(`Issued ${o.id} step ${o.cur + 1} to field crew ${tr.id}: ${ACTION_LABEL[st.action]} ${st.dev}`);
}

/** Engine hook: the operator heard the real read-back and confirmed (or said negative). */
export function fieldConfirm(e: Engine, o: SwitchingOrder, st: SwStep, correct: boolean) {
  const id = stepMsgId(o, o.cur);
  if (correct) {
    st.status = 'InProgress';
    (e as any).stepLog(st, 'Operator: "That\'s correct, perform" — crew cleared to operate', true);
    fieldSend(e, { id, truck: st.exec, kind: 'step', state: 'cleared', text: (fieldState(e).sent[id]?.text ?? '') });
    e.decision(`Confirmed field crew ${st.exec} read-back for ${o.id} step ${o.cur + 1}`);
  } else {
    (e as any).stepLog(st, 'Operator: "Negative" — crew to repeat back');
    fieldSend(e, { id, truck: st.exec, kind: 'step', state: 'repeat', text: (fieldState(e).sent[id]?.text ?? '') });
    e.decision(`Said negative to field crew ${st.exec} read-back for ${o.id} step ${o.cur + 1}`);
  }
  e.bump();
}

/** Engine hook: a clearance was granted to a real crew. */
export function fieldClearanceIssued(e: Engine, tr: Truck, clId: string, devs: string[]) {
  if (tr.field) tr.field.status = 'Working';
  tr.status = 'Working';
  fieldSend(e, { id: `${tr.id}-${clId}`, truck: tr.id, kind: 'clearance', clearance: clId, devs, state: 'issued', text: `Clearance ${clId} issued to you at ${e.hhmm()}. Isolation points: ${devs.join(', ')}. Tagged and held.` });
}
/** Engine hook: the operator acknowledged a real crew's release. */
export function fieldReleaseAck(e: Engine, tr: Truck, clId: string) {
  if (tr.field) tr.field.status = 'Standing by';
  // The real crew did the repair under the clearance: faults inside the cleared section are fixed.
  const cl = e.s.clearances[clId];
  if (cl) {
    const ns = new Set(cl.nodes);
    for (const f of Object.values(e.s.faults)) {
      if (!f.active) continue;
      const el = e.T.els[f.el] as LineEl | undefined;
      const inside = f.onLoad ? ns.has(e.T.loads[f.el]?.node) : !!el && (ns.has(el.from) || ns.has(el.to));
      if (inside) { f.active = false; e.log('OMS', 'good', `${f.id} repaired by field crew ${tr.id} under ${clId}`); if (f.incident && e.s.incidents[f.incident]) e.s.incidents[f.incident].timeline.push({ t: e.s.t, text: `Field crew ${tr.id}: repairs complete, released ${clId}` }); }
    }
  }
  fieldSend(e, { id: `${tr.id}-${clId}`, truck: tr.id, kind: 'clearance', clearance: clId, state: 'released', text: `Clearance ${clId} released at ${e.hhmm()}, tags removed. Stand by for restoration switching.` });
}

/** Console fallback: the crew reported the step done by radio and the phone couldn't (dead phone, no signal). */
export function fieldManualDone(e: Engine, oid: string): string | null {
  const o = e.s.orders[oid], st = o?.steps[o.cur];
  if (!st) return 'No step';
  return fieldApply(e, { id: `manual-${oid}-${o.cur}-${e.s.t}`, truck: st.exec, t: e.s.t, kind: 'operate', dev: st.dev, action: st.action, verified: true, tag: 'manual' });
}

// ── Crew events ─────────────────────────────────────────────
export function fieldApply(e: Engine, ev: FromCrew): string | null {
  const f = fieldState(e);
  if (f.seen[ev.id]) return null;
  f.seen[ev.id] = e.s.t;
  const truck = String(ev.truck ?? '').trim();
  let tr = e.s.trucks[truck];
  switch (ev.kind) {
    case 'join': {
      if (tr && !tr.field) {
        fieldSend(e, { id: `${truck}-J${e.s.seq++}`, truck, kind: 'info', state: 'issued', text: `Truck ${truck} is already a simulated crew in this scenario. Re-join with another truck number.` });
        e.log('DISPATCH', 'warn', `A field crew tried to join as ${truck}, which is a simulated truck — asked them to pick another number`);
        return 'Truck number in use';
      }
      if (!tr) { tr = e.addTruck(truck, YARD_HOME); tr.type = 'Real crew (field)'; tr.drive = 1; tr.work = 1; }
      const members = (ev.members ?? []).filter(Boolean).slice(0, 8);
      tr.crew = [ev.foreman, ...members].filter(Boolean).join(' / ') || 'Field crew';
      tr.field = { foreman: ev.foreman ?? '', members, status: tr.field?.status ?? 'At yard', at: tr.field?.at ?? 'yard', dest: tr.field?.dest, lastT: e.s.t };
      tr.status = STATUS_MAP[tr.field.status]; tr.pos = posOf(e, tr.field.at); tr.route = null;
      e.log('DISPATCH', 'good', `Field crew ${truck} joined — foreman ${ev.foreman || '?'}${members.length ? `, crew ${members.join(', ')}` : ''}`);
      fieldSend(e, { id: `${truck}-welcome`, truck, kind: 'info', state: 'issued', text: `Joined as Truck ${truck}. Keep your status current and wait for instructions.` });
      e.bump();
      return null;
    }
    case 'status': {
      if (!tr?.field) return 'Not a field crew';
      const prevPos = tr.pos;
      const status = ev.status ?? tr.field.status;
      tr.field.status = status; tr.field.lastT = e.s.t;
      if (ev.at !== undefined) tr.field.at = ev.at;
      if (ev.dest !== undefined) tr.field.dest = ev.dest;
      if (status === 'En route') {
        const to = posOf(e, tr.field.dest ?? tr.field.at);
        tr.pos = [(prevPos[0] + to[0]) / 2, (prevPos[1] + to[1]) / 2];
      } else tr.pos = posOf(e, tr.field.at);
      if (!tr.clearance) tr.status = STATUS_MAP[status];
      const where = status === 'En route' ? `en route to ${tr.field.dest ?? '?'}` : status === 'At yard' ? 'at the yard' : `${status.toLowerCase()} at ${tr.field.at}`;
      e.log('DISPATCH', 'info', `Field crew ${truck}: ${where}`);
      // A dispatch is done once they're on site where they were sent.
      if (status === 'On site') for (const m of Object.values(f.sent)) if (m.truck === truck && m.kind === 'dispatch' && m.state === 'issued' && m.dev === tr.field.at) fieldSend(e, { ...m, state: 'done' });
      e.bump();
      return null;
    }
    case 'operate': {
      if (!tr?.field && ev.tag !== 'manual') return 'Not a field crew';
      const dev = ev.dev!, action = ev.action!;
      const d = e.T.els[dev] as DevEl | undefined;
      if (!d || d.kind !== 'device') return `Unknown device ${dev}`;
      const o = Object.values(e.s.orders).find(x => x.status === 'Active' && x.steps[x.cur]?.exec === truck);
      const st = o?.steps[o.cur];
      const how = ev.tag === 'nfc' ? 'NFC tag verified' : ev.tag === 'qr' ? 'QR tag verified' : ev.tag === 'manual' ? 'reported by radio, no tag (operator entry)' : 'no tag scan';
      if (tr?.field) { tr.field.at = dev; tr.field.status = 'On site'; tr.pos = posOf(e, dev); if (!tr.clearance) tr.status = 'On Scene'; }
      if (!o || !st || st.status !== 'InProgress' || st.dev !== dev || st.action !== action) {
        // The crew operated something they were not cleared for. It happened — record it.
        const why = !o || !st ? 'with no switching step issued' : st.status !== 'InProgress' ? 'before the read-back was confirmed' : `but the step was ${ACTION_LABEL[st.action]} ${st.dev}`;
        e.violation('field-op', `Field crew ${truck} operated ${ACTION_LABEL[action]} ${dev} ${why}`);
        const r = e.devAction(dev, action, { by: truck, loopOk: true });
        if (!r.ok) e.log('SCADA', 'warn', `${truck} reported ${ACTION_LABEL[action]} ${dev}, but: ${r.reason}`);
        e.bump();
        return 'Not on the current step';
      }
      if (!ev.verified) e.decision(`Field crew ${truck} confirmed ${ACTION_LABEL[action]} ${dev} without the visual verification box`, false);
      const r = e.devAction(dev, action, { by: truck, loopOk: st.loop, order: o.id });
      if (!r.ok) {
        st.status = 'Failed'; st.note = r.reason;
        (e as any).stepLog(st, `${truck} unable to ${ACTION_LABEL[action]} ${dev}: ${r.reason}`, false);
        fieldSend(e, { id: stepMsgId(o, o.cur), truck, kind: 'step', state: 'cancelled', text: `Unable: ${r.reason}. Stand by.` });
        e.bump();
        return r.reason ?? 'Failed';
      }
      st.status = 'Done'; st.doneT = e.s.t;
      (e as any).stepLog(st, `${truck} operated ${ACTION_LABEL[action]} ${dev} — ${how}${ev.verified ? ', visual open/closed verified, flag set' : ''}`, true);
      fieldSend(e, { id: stepMsgId(o, o.cur), truck, kind: 'step', state: 'done', text: fieldState(e).sent[stepMsgId(o, o.cur)]?.text ?? '' });
      e.log('SCADA', 'good', `${o.id} step ${o.cur + 1}: field crew ${truck} reports ${ACTION_LABEL[action]} ${dev} complete (${how})`);
      (e as any).advanceOrder(o);
      e.bump();
      return null;
    }
    case 'clearance': {
      if (!tr?.field) return 'Not a field crew';
      if (tr.clearance) return `Already holding ${tr.clearance}`;
      if (e.s.requests.some(r => r.type === 'clearance' && r.truck === truck && r.status === 'Pending')) return 'Already requested';
      const w = tr.waitIso as any;
      let el: string | undefined = w?.el, devs: string[] | undefined = w?.devs, nodes: string[] | undefined = w?.nodes;
      if (!el) {
        // Work side of the device they're at: prefer the dead side, and the side with a known fault.
        const at = e.T.els[ev.dev ?? tr.field.at] as DevEl | undefined;
        const cands = at ? [...(e.T.adj[at.to] ?? []), ...(e.T.adj[at.from] ?? [])].filter(x => e.T.els[x].kind === 'line') : [];
        const score = (x: string) => {
          const sec = sectionAround(e.T, x), ns = new Set(sec.nodes);
          const faulted = Object.values(e.s.faults).some(f => f.active && !f.onLoad && (ns.has((e.T.els[f.el] as LineEl).from) || ns.has((e.T.els[f.el] as LineEl).to)));
          const dead = !sec.nodes.some(n => e.net.en.has(n));
          return (faulted ? 2 : 0) + (dead ? 1 : 0);
        };
        el = cands.sort((a, b) => score(b) - score(a))[0];
      }
      if (!el) { fieldSend(e, { id: `${truck}-C${e.s.seq++}`, truck, kind: 'info', state: 'issued', text: 'Set your location to the device you are working at, then request the clearance again.' }); return 'No work location'; }
      if (!nodes) { const sec = sectionAround(e.T, el); devs = devs ?? sec.bounds; }
      const pts = (devs ?? []).join(', ');
      e.request('clearance', truck, `Clearance on section bounded by ${pts} — ${w?.purpose ?? (ev.text || 'field work')}`, { dev: el, devs, nodes, inc: w?.inc || undefined });
      e.log('SAFETY', 'info', `Field crew ${truck} requests a clearance on the section bounded by ${pts}`);
      e.bump();
      return null;
    }
    case 'release': {
      if (!tr?.field) return 'Not a field crew';
      if (!tr.clearance) return 'No clearance held';
      if (e.s.requests.some(r => r.type === 'release' && r.truck === truck && r.status === 'Pending')) return 'Already released';
      e.request('release', truck, `Release of clearance ${tr.clearance} — work complete, grounds removed, crew clear`, { devs: [tr.clearance] });
      e.log('SAFETY', 'info', `Field crew ${truck} releases clearance ${tr.clearance}`);
      e.bump();
      return null;
    }
    case 'note': {
      e.log('DISPATCH', 'info', `Field crew ${truck}: ${ev.text ?? ''}`);
      e.bump();
      return null;
    }
  }
  return null;
}

/** Small public snapshot of the yard for crew phones (device states, crew dots). */
export function yardSnapshot(e: Engine) {
  const dev: Record<string, { open: boolean; tags: number; ctl?: string }> = {};
  for (const id of e.T.devIds) {
    const d = e.T.els[id] as DevEl;
    if (!d.feeder?.startsWith('TX') || d.type === 'xfmr') continue;
    const s = e.s.dev[id];
    dev[id] = { open: s.open, tags: s.tags.length, ...(s.ctl ? { ctl: s.ctl } : {}) };
  }
  const live: Record<string, boolean> = {};
  for (const id of e.T.feederIds) if (id.startsWith('TX')) for (const el of e.T.feeders[id].mainEls) live[el] = e.net.en.has((e.T.els[el] as LineEl).to);
  const trucks: Record<string, { status: string; at: string; dest?: string }> = {};
  for (const tr of Object.values(e.s.trucks)) if (tr.field) trucks[tr.id] = { status: tr.field.status, at: tr.field.at, ...(tr.field.dest ? { dest: tr.field.dest } : {}) };
  return { dev, live, t: e.s.t, clock: e.hhmm(), trucks };
}
