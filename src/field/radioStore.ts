// Console-side log of field radio traffic (voice clips + text), kept out of the
// sim state so recordings don't bloat the save file. Session copies live in Firestore.
import { useEffect, useState } from 'react';
import type { Engine } from '../sim/engine';
import type { ToCrew } from '../sim/types';
import { getBackend } from './backend';
import { chirp, playClip, type Clip } from './fieldRadio';
import { pushToCrews } from './push';

export interface RadioItem { id: string; from: string; to: string; at: number; clock: string; text?: string; audio?: string; mime?: string; dur?: number; }
let items: RadioItem[] = [];
const subs = new Set<() => void>();
const fire = () => subs.forEach(f => f());
export let autoPlay = true;
export const setAutoPlay = (v: boolean) => { autoPlay = v; fire(); };

export function addRadio(it: RadioItem, incoming: boolean) {
  if (items.some(x => x.id === it.id)) return;
  items = [...items, it].sort((a, b) => a.at - b.at).slice(-300);
  fire();
  if (incoming && Date.now() - it.at < 60_000) { chirp(); if (autoPlay && it.audio) setTimeout(() => playClip(it.audio!), 250); }
}
export function useRadio(): RadioItem[] {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return items;
}
/** Latest clip from a truck after a sim time stamp (wall clock ms), for read-backs. */
export const latestFrom = (truck: string, sinceMs: number) => [...items].reverse().find(x => x.from === truck && x.at >= sinceMs);

/** Console → one field crew or all of them. */
export async function sendRadio(e: Engine, to: string, msg: { text?: string } & Partial<Clip>) {
  const f = e.s.field; if (!f?.code) throw new Error('No field session');
  const trucks = to === 'ALL' ? Object.values(e.s.trucks).filter(t => t.field).map(t => t.id) : [to];
  if (!trucks.length) throw new Error('No field crews have joined yet');
  const base = `R${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const out: ToCrew[] = trucks.map(t => ({ id: `${base}-${t}`, truck: t, t: e.s.t, kind: 'radio', state: 'issued', text: msg.text ?? '', ...(msg.audio ? { audio: msg.audio, mime: msg.mime, dur: msg.dur } : {}) }));
  await getBackend().sendToCrew(f.code, out);
  pushToCrews(f.code, trucks, { title: '📻 Sparks Control', body: msg.text ? msg.text : `Voice message (${Math.round(msg.dur ?? 0)}s) — tap to play`, tag: 'radio' });
  addRadio({ id: base, from: 'OPS', to, at: Date.now(), clock: e.hhmm(), text: msg.text, audio: msg.audio, mime: msg.mime, dur: msg.dur }, false);
  e.log('RADIO', 'info', `Sparks Control → ${to === 'ALL' ? 'all field crews' : `field crew ${to}`}: ${msg.audio ? `🎙 voice ${Math.round(msg.dur ?? 0)}s` : ''}${msg.text ? `${msg.audio ? ' — ' : ''}"${msg.text}"` : ''}`);
}
