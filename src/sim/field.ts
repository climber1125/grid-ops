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
import type { FieldState, FieldStatus, FromCrew, ToCrew, Truck, SwitchingOrder, SwStep, LineEl, DevEl, FieldJob, JobKind, JobStatus } from './types';
import { sectionAround } from './network';
import { stepPhrase, ACTION_LABEL, devWord } from './radio';
import { YARD_PARKING, yardLL, poleLL, isLinePole, areaOfPole, ALL_POLES } from './texasYard';
import { offset, dist } from './geo';

export const YARD_HOME = yardLL(YARD_PARKING);

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
  if (d?.kind === 'device') return offset(d.pos, 2, -2);
  const p = poleLL(at);
  return p ? offset(p, 2, -2) : YARD_HOME;
}
/** Network node at a line pole (nearest yard vertex). */
export function poleNode(e: Engine, pole: string): string | null {
  const p = poleLL(pole);
  if (!p || !isLinePole(pole)) return null;
  let best: string | null = null, bd = 1e9;
  for (const fid of e.T.feederIds) if (fid.startsWith('TX')) for (const v of e.T.feeders[fid].vertNodes) { const d = dist(v.pos, p); if (d < bd) { bd = d; best = v.node; } }
  return bd < 3 ? best : null;
}
const where = (at: string) => (ALL_POLES[at] ? `pole ${at}${areaOfPole(at) ? ` (${areaOfPole(at)!.name})` : ''}` : at);

// ── GPS (phone reports while the crew app is open) ──────────
export const GPS_STALE_MS = 2 * 60_000;
export const gpsFresh = (tr: Truck) => !!tr.field?.gps && Date.now() - tr.field.gps.at < GPS_STALE_MS;
export function fieldGps(e: Engine, truck: string, g: { lat: number; lng: number; acc: number; at: number }) {
  const tr = e.s.trucks[truck];
  if (!tr?.field || !Number.isFinite(g.lat) || !Number.isFinite(g.lng)) return;
  if (tr.field.gps && tr.field.gps.at >= g.at) return;
  tr.field.gps = { lat: g.lat, lng: g.lng, acc: Math.round(g.acc), at: g.at };
  if (Date.now() - g.at < GPS_STALE_MS) tr.pos = [g.lat, g.lng];
  e.bump();
}

// ── Yard jobs (crossarm change-outs, guying) ────────────────
const JOB_TEXT: Record<JobKind, string> = { crossarm: 'Crossarm change-out', guy: 'Guy wire tensioning', other: 'Work', trouble: 'Trouble call' };
export const jobs = (e: Engine) => (fieldState(e).jobs ??= {});
function jobMsg(e: Engine, j: FieldJob) {
  if (!j.truck) return;
  const hidden = j.trouble && !j.revealed;
  const text = hidden ? `${j.id}: ${j.trouble!.call}`
    : j.trouble ? `${j.id}: ${j.trouble.reveal}`
      : `${j.id}: ${j.text} at ${where(j.pole)}${j.needsClearance ? ' — ON THE LINE: clearance required before work' : ''}`;
  fieldSend(e, {
    id: `JOB-${j.id}`, truck: j.truck, kind: 'job', job: j.id, pole: j.pole, jobStatus: j.status,
    needsClearance: hidden ? false : j.needsClearance, needsBrief: hidden ? false : !!j.needsBrief,
    ...(j.briefStatus ? { briefStatus: j.briefStatus } : {}), ...(j.briefNote ? { briefNote: j.briefNote } : {}),
    ...(j.trouble ? { trouble: true, revealed: !!j.revealed } : {}),
    state: j.status === 'Complete' ? 'done' : j.status === 'Cancelled' ? 'cancelled' : 'issued', text,
  });
}
function jobLog(e: Engine, j: FieldJob, text: string) { j.log.push({ t: e.s.t, text }); }
export function fieldNewJob(e: Engine, kind: JobKind, pole: string, note = ''): FieldJob | string {
  if (!ALL_POLES[pole]) return `Unknown pole ${pole}`;
  // Yard work orders are YW-101…, trouble calls TC-1… (so the scenario's YW numbers stay put)
  const pre = kind === 'trouble' ? 'TC-' : 'YW-';
  const id = `${pre}${Object.keys(jobs(e)).filter(k => k.startsWith(pre)).length + (kind === 'trouble' ? 1 : 101)}`;
  const j: FieldJob = { id, kind, pole, text: `${JOB_TEXT[kind]}${note ? ` — ${note}` : ''}`, status: 'Open', needsClearance: isLinePole(pole), needsBrief: isLinePole(pole), created: e.s.t, log: [] };
  jobs(e)[id] = j;
  jobLog(e, j, 'Created');
  e.log('OMS', 'info', `Yard work order ${id}: ${j.text} at ${where(pole)}${j.needsClearance ? ' — on the line, needs switching and a clearance' : ''}`);
  e.bump();
  return j;
}
export function fieldAssignJob(e: Engine, jobId: string, truck: string): string | null {
  const j = jobs(e)[jobId]; const tr = e.s.trucks[truck];
  if (!j) return `Unknown job ${jobId}`;
  if (!tr?.field) return `${truck} is not a field crew`;
  if (j.status === 'Complete' || j.status === 'Cancelled') return `${jobId} is ${j.status.toLowerCase()}`;
  if (j.truck && j.truck !== truck) { const old = j.truck; j.truck = truck; fieldSend(e, { id: `JOB-${j.id}`, truck: old, kind: 'job', job: j.id, pole: j.pole, jobStatus: 'Cancelled', state: 'cancelled', text: `${j.id} reassigned to Truck ${truck}.` }); }
  j.truck = truck; j.status = 'Assigned';
  tr.field.dest = j.pole;
  jobLog(e, j, `Assigned to ${truck}`);
  jobMsg(e, j);
  e.log('DISPATCH', 'info', `${jobId} assigned to field crew ${truck}`);
  e.decision(`Assigned ${jobId} to field crew ${truck}`);
  return null;
}
// ── Trouble calls (blind dispatch) ──────────────────────────
export const TROUBLE_TEMPLATES: Record<string, { name: string; poles: (e: Engine) => string[] }> = {
  padxfmr: { name: 'Failed pad-mount transformer (URD)', poles: e => Object.keys(ALL_POLES).filter(p => p.startsWith('U') && !!yardLoadAt(e, p)) },
  crossarm: { name: 'Broken crossarm / insulator on the line (line trips)', poles: e => Object.keys(ALL_POLES).filter(p => isLinePole(p) && !p.startsWith('U') && !!spanInto(e, p)) },
};
function yardLoadAt(e: Engine, pole: string): string | null {
  const n = poleNode(e, pole); if (!n) return null;
  return e.T.loadIds.find(l => e.T.loads[l].feeder.startsWith('TX') && (e.T.els[e.T.loads[l].xfmr] as DevEl)?.from === n) ?? null;
}
function spanInto(e: Engine, pole: string): string | undefined {
  for (const fid of ['TX-4110', 'TX-4120']) {
    const el = e.T.feeders[fid]?.mainEls.find(x => (e.T.els[x] as LineEl & { loc?: string }).loc?.endsWith(`–${pole}`));
    if (el) return el;
  }
  return undefined;
}
export function fieldNewTrouble(e: Engine, template: string, pole: string): FieldJob | string {
  const tp = TROUBLE_TEMPLATES[template];
  if (!tp) return `Unknown trouble type ${template}`;
  if (!tp.poles(e).includes(pole)) return `${tp.name} can't go at ${pole}`;
  const j = fieldNewJob(e, 'trouble', pole);
  if (typeof j === 'string') return j;
  j.needsClearance = true; j.needsBrief = true;
  if (template === 'padxfmr') {
    const lid = yardLoadAt(e, pole)!;
    const L = e.T.loads[lid];
    const f = e.createFault(lid, true, 'xfmr_failure', true); e.applyFault(f);
    j.text = `Trouble: ${L.name} out — failed pad-mount transformer`;
    j.trouble = {
      template, fault: f.id,
      call: `Trouble call — respond to pole ${pole} (URD). Details when you scan the tag on site.`,
      reveal: `${L.name} at ${pole} is out of power. Oil on the pad, the cabinet is hot and smells burnt, the transformer fuse is blown — the pad-mount transformer has failed. Make it safe and replace it: job brief, switching with control, clearance, replace, restore.`,
    };
  } else {
    const el = spanInto(e, pole);
    if (!el) return `No span into ${pole}`;
    const f = e.createFault(el, false, 'insulator', true); e.applyFault(f);
    j.text = `Trouble: broken crossarm / insulator at ${pole}`;
    j.trouble = {
      template, fault: f.id,
      call: `Trouble call — patrol to pole ${pole} on the perimeter line. Details when you scan the tag on site.`,
      reveal: `At ${pole}: the crossarm is split and the insulator has flashed over — the conductor is down on the arm. This is what tripped the line. Make it safe and repair it: job brief, switching with control, clearance, repair, restore.`,
    };
  }
  j.log.push({ t: e.s.t, text: `Trouble created: ${tp.name}` });
  e.log('OMS', 'alarm', `${j.id}: trouble call at ${where(pole)} — send a field crew (they get the details when they scan the tag there).`);
  e.bump();
  return j;
}
function reveal(e: Engine, tr: Truck, j: FieldJob) {
  if (!j.trouble || j.revealed) return;
  j.revealed = true;
  jobLog(e, j, `${tr.id} scanned in at ${j.pole} — call revealed`);
  e.log('DISPATCH', 'alarm', `📍 Field crew ${tr.id} is ON SITE at ${where(j.pole)} (tag scan) — ${j.id} details sent to their phone: ${j.text}`);
  e.decision(`Field crew ${tr.id} on site at ${j.pole} for ${j.id}`);
}

// ── Job briefs ──────────────────────────────────────────────
export function fieldBriefDecision(e: Engine, jobId: string, ok: boolean, note = ''): string | null {
  const j = jobs(e)[jobId]; if (!j?.brief) return 'No brief to review';
  j.briefStatus = ok ? 'approved' : 'returned'; j.briefNote = note || undefined;
  jobLog(e, j, ok ? 'Brief approved by control' : `Brief returned: ${note}`);
  e.log('DISPATCH', ok ? 'good' : 'warn', `${jobId} job brief ${ok ? 'approved' : `returned to Truck ${j.truck}${note ? ` — ${note}` : ''}`}`);
  e.decision(`${ok ? 'Approved' : 'Returned'} ${jobId} job brief`);
  jobMsg(e, j); e.bump();
  return null;
}
/** Turn the switching steps in a crew's brief into a draft order for control to review. */
export function fieldOrderFromBrief(e: Engine, jobId: string): string {
  const j = jobs(e)[jobId];
  if (!j?.brief?.steps.length) return 'The brief has no switching steps';
  const bad = j.brief.steps.find(st => !e.T.els[st.dev]);
  if (bad) return `Unknown device ${bad.dev} in the brief`;
  const o = e.newOrder(`${jobId} ${j.trouble ? 'trouble' : 'work'} at ${j.pole} — crew request (Truck ${j.truck})`, j.brief.steps.map(st => ({ dev: st.dev, action: st.action, exec: j.truck!, loop: st.action === 'close' && !!(e.T.els[st.dev] as DevEl).normalOpen })));
  jobLog(e, j, `Switching order ${o.id} drafted from the crew's brief`);
  e.log('DISPATCH', 'info', `${o.id} drafted from ${jobId} job brief — review it in Switching & clearances, then activate.`);
  e.bump();
  return o.id;
}

function clearanceCovers(e: Engine, truck: string, pole: string): boolean {
  const n = poleNode(e, pole);
  if (!n) return true;
  return Object.values(e.s.clearances).some(c => c.status === 'Active' && c.truck === truck && c.nodes.includes(n));
}
function jobStep(e: Engine, tr: Truck, j: FieldJob, st: 'ack' | 'working' | 'complete'): string | null {
  if (j.truck !== tr.id) return `${j.id} is not assigned to ${tr.id}`;
  if (st === 'ack') { if (j.status === 'Assigned') { j.status = 'Acknowledged'; jobLog(e, j, `${tr.id} acknowledged`); e.log('DISPATCH', 'info', `Field crew ${tr.id} acknowledged ${j.id}`); } }
  else if (st === 'working') {
    if (j.needsBrief && j.briefStatus !== 'approved') {
      fieldSend(e, { id: `${tr.id}-NB${e.s.seq++}`, truck: tr.id, kind: 'info', state: 'issued', text: `Send your job brief for ${j.id} and wait for control to approve it before you start.` });
      e.bump();
      return 'Brief not approved';
    }
    if (j.needsClearance && !clearanceCovers(e, tr.id, j.pole)) {
      e.violation('field-noclear', `Field crew ${tr.id} tried to start ${j.id} on line pole ${j.pole} without a clearance covering it`);
      fieldSend(e, { id: `${tr.id}-NC${e.s.seq++}`, truck: tr.id, kind: 'info', state: 'issued', text: `STOP — ${j.pole} is on the line. Request a clearance and wait for it before you start ${j.id}.` });
      e.bump();
      return 'No clearance';
    }
    j.status = 'Working'; jobLog(e, j, `${tr.id} started work`);
    if (tr.field) { tr.field.status = 'Working'; tr.field.at = j.pole; tr.pos = posOf(e, j.pole); }
    if (!tr.clearance) tr.status = 'Working';
    e.log('DISPATCH', 'info', `Field crew ${tr.id} working ${j.id} at ${where(j.pole)}`);
  } else {
    if (j.status !== 'Working') return 'Start the job first';
    j.status = 'Complete'; j.doneT = e.s.t; jobLog(e, j, `${tr.id} reported complete`);
    if (tr.field) tr.field.status = 'Standing by';
    if (!tr.clearance) tr.status = 'Standing By';
    e.log('OMS', 'good', `${j.id} complete — ${j.text} at ${where(j.pole)} (Truck ${tr.id}, ${Math.round((e.s.t - j.created) / 60)} min)`);
    e.decision(`${j.id} completed by field crew ${tr.id}`);
  }
  jobMsg(e, j);
  e.bump();
  return null;
}

// ── Operator side ───────────────────────────────────────────
/** Send a real crew to a device. Their dot moves when the foreman updates. */
export function fieldDispatch(e: Engine, truck: string, dev: string, note = ''): string | null {
  const tr = e.s.trucks[truck];
  if (!tr?.field) return `${truck} is not a field crew`;
  const d = e.T.els[dev] as DevEl | undefined;
  const isDev = d?.kind === 'device';
  if (!isDev && !ALL_POLES[dev]) return `Unknown device or pole ${dev}`;
  const txt = isDev ? `${devWord(d!)} ${dev} at ${d!.loc}` : where(dev);
  tr.field.dest = dev;
  fieldSend(e, { id: `${truck}-D${e.s.seq++}`, truck, kind: 'dispatch', dev, text: `Go to ${txt}${note ? ` — ${note}` : ''}.`, state: 'issued' });
  e.log('DISPATCH', 'info', `Sent field crew ${truck} to ${txt}${note ? ` — ${note}` : ''}`);
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
      if (inside) { f.active = false; if (f.onLoad) { const L = e.T.loads[f.el]; if (L && e.s.dev[L.xfmr]) e.s.dev[L.xfmr].open = false; } e.log('OMS', 'good', `${f.id} repaired by field crew ${tr.id} under ${clId}`); if (f.incident && e.s.incidents[f.incident]) e.s.incidents[f.incident].timeline.push({ t: e.s.t, text: `Field crew ${tr.id}: repairs complete, released ${clId}` }); }
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
      if (gpsFresh(tr)) { /* the phone's GPS places the truck */ }
      else if (status === 'En route') {
        const to = posOf(e, tr.field.dest ?? tr.field.at);
        tr.pos = [(prevPos[0] + to[0]) / 2, (prevPos[1] + to[1]) / 2];
      } else tr.pos = posOf(e, tr.field.at);
      if (!tr.clearance) tr.status = STATUS_MAP[status];
      const where = status === 'En route' ? `en route to ${tr.field.dest ?? '?'}` : status === 'At yard' ? 'at the yard' : `${status.toLowerCase()} at ${tr.field.at}`;
      e.log('DISPATCH', 'info', `Field crew ${truck}: ${where}`);
      for (const j of Object.values(jobs(e))) if (j.truck === truck && !['Complete', 'Cancelled', 'Working'].includes(j.status)) {
        const ns: JobStatus | null = status === 'On site' && tr.field.at === j.pole ? 'On site' : status === 'En route' && tr.field.dest === j.pole ? 'En route' : null;
        if (ns === 'On site') reveal(e, tr, j);
        if (ns && ns !== j.status) { j.status = ns; jobLog(e, j, `${truck} ${ns.toLowerCase()}`); jobMsg(e, j); }
      }
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
        const loc = ev.dev ?? tr.field.at;
        const at = e.T.els[loc] as DevEl | undefined;
        const pn = !at ? poleNode(e, loc) : null;
        const cands = at ? [...(e.T.adj[at.to] ?? []), ...(e.T.adj[at.from] ?? [])].filter(x => e.T.els[x].kind === 'line')
          : pn ? (e.T.adj[pn] ?? []).filter(x => e.T.els[x].kind === 'line') : [];
        const score = (x: string) => {
          const sec = sectionAround(e.T, x), ns = new Set(sec.nodes);
          const faulted = Object.values(e.s.faults).some(f => f.active && !f.onLoad && (ns.has((e.T.els[f.el] as LineEl).from) || ns.has((e.T.els[f.el] as LineEl).to)));
          const dead = !sec.nodes.some(n => e.net.en.has(n));
          return (faulted ? 2 : 0) + (dead ? 1 : 0);
        };
        el = cands.sort((a, b) => score(b) - score(a))[0];
      }
      if (!el) { fieldSend(e, { id: `${truck}-C${e.s.seq++}`, truck, kind: 'info', state: 'issued', text: 'Pick the device or line pole you are working at, then request the clearance again.' }); return 'No work location'; }
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
    case 'job': {
      if (!tr?.field) return 'Not a field crew';
      const j = ev.job ? jobs(e)[ev.job] : undefined;
      if (!j || !ev.jstep) return 'Unknown job';
      tr.field.lastT = e.s.t;
      return jobStep(e, tr, j, ev.jstep);
    }
    case 'brief': {
      if (!tr?.field) return 'Not a field crew';
      const j = ev.job ? jobs(e)[ev.job] : undefined;
      if (!j || j.truck !== truck || !ev.brief) return 'Unknown job';
      j.brief = ev.brief; j.briefStatus = 'sent'; j.briefNote = undefined;
      tr.field.lastT = e.s.t;
      jobLog(e, j, `${truck} sent the job brief`);
      e.log('DISPATCH', 'alarm', `📋 Job brief from Truck ${truck} for ${j.id} — review and approve it in the Field tab${ev.brief.steps.length ? ` (asks for ${ev.brief.steps.length} switching step${ev.brief.steps.length > 1 ? 's' : ''})` : ''}`);
      jobMsg(e, j); e.bump();
      return null;
    }
    case 'radio': {
      if (tr?.field) tr.field.lastT = e.s.t;
      e.log('RADIO', 'info', `Field crew ${truck}: ${ev.audio ? `🎙 voice ${Math.round(ev.dur ?? 0)}s` : ''}${ev.text ? `${ev.audio ? ' — ' : ''}"${ev.text}"` : ''}`);
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
  const spans: Record<string, boolean> = {};
  for (const id of e.T.feederIds) if (id.startsWith('TX')) for (const el of e.T.feeders[id].mainEls) {
    const L = e.T.els[el] as LineEl & { loc?: string };
    live[el] = e.net.en.has(L.to);
    const m = L.loc?.match(/^Span (\S+)–(\S+)$/);
    if (m) spans[[m[1], m[2]].sort().join('|')] = live[el];
  }
  const trucks: Record<string, { status: string; at: string; dest?: string; gps?: { lat: number; lng: number; acc: number; at: number } }> = {};
  for (const tr of Object.values(e.s.trucks)) if (tr.field) trucks[tr.id] = { status: tr.field.status, at: tr.field.at, ...(tr.field.dest ? { dest: tr.field.dest } : {}), ...(tr.field.gps ? { gps: tr.field.gps } : {}) };
  return { dev, live, spans, t: e.s.t, clock: e.hhmm(), trucks };
}
