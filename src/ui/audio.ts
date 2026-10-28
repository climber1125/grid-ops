// ─────────────────────────────────────────────────────────────
// Audio: alarm tones, radio squelch, and pluggable radio voices.
// Voice providers implement RadioVoice; the default uses the browser
// SpeechSynthesis API. Prerecorded clips or a local TTS server can be
// added later by registering another provider (see README).
// ─────────────────────────────────────────────────────────────
import type { RadioMsg } from '../sim/types';
import { speakable } from '../sim/radio';

export interface RadioVoice { name: string; available(): boolean; speak(msg: RadioMsg, text: string): Promise<void>; cancel(): void; }

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (!ctx) { try { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch { ctx = null; } }
  if (ctx?.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() { ac(); try { speechSynthesis.getVoices(); } catch { /* none */ } }

function tone(freq: number, start: number, dur: number, gain = 0.08, type: OscillatorType = 'square') {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.setValueAtTime(gain, c.currentTime + start + dur - 0.02);
  g.gain.linearRampToValueAtTime(0, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.02);
}

export function alarmTone(pri: number) {
  if (pri === 1) { tone(880, 0, 0.16); tone(660, 0.2, 0.16); tone(880, 0.4, 0.16); tone(660, 0.6, 0.16); }
  else tone(740, 0, 0.12, 0.05), tone(740, 0.3, 0.12, 0.05);
}

/** Short filtered noise burst = radio squelch tail / key-up. */
export function squelch() {
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * 0.09);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
  const g = c.createGain(); g.gain.value = 0.05;
  src.connect(f).connect(g).connect(c.destination); src.start();
}

class SpeechVoice implements RadioVoice {
  name = 'Browser speech synthesis';
  available() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }
  private pick(from: string) {
    const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
    if (!vs.length) return { voice: undefined, pitch: 1, rate: 1.08 };
    if (from === 'SPARKS CONTROL') return { voice: vs[0], pitch: 0.95, rate: 1.08 };
    let h = 0; for (const ch of from) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { voice: vs[(h % Math.max(1, vs.length - 1)) + (vs.length > 1 ? 1 : 0)] ?? vs[0], pitch: 0.75 + (h % 5) * 0.1, rate: 1.02 + (h % 3) * 0.05 };
  }
  speak(msg: RadioMsg, text: string) {
    return new Promise<void>(res => {
      const u = new SpeechSynthesisUtterance(text);
      const p = this.pick(msg.from);
      if (p.voice) u.voice = p.voice;
      u.pitch = p.pitch; u.rate = p.rate; u.volume = 0.95;
      u.onend = () => res(); u.onerror = () => res();
      speechSynthesis.speak(u);
      setTimeout(res, 15000);
    });
  }
  cancel() { try { speechSynthesis.cancel(); } catch { /* none */ } }
}

export const VOICES: RadioVoice[] = [new SpeechVoice()];

/** Sequential radio playback queue. Drops backlog so audio never lags far behind the sim. */
export class RadioPlayer {
  private q: RadioMsg[] = [];
  private busy = false;
  enabled = false;
  voice: RadioVoice = VOICES[0];
  onKey?: (from: string | null) => void;

  push(msgs: RadioMsg[], speed: number) {
    if (!this.enabled || !this.voice.available()) { for (const m of msgs) { squelchIf(this.enabled); void m; } return; }
    for (const m of msgs) if (speed <= 1 || m.kind !== 'routine') this.q.push(m);
    if (this.q.length > 4) this.q.splice(0, this.q.length - 3);
    this.pump();
  }
  private async pump() {
    if (this.busy) return;
    const m = this.q.shift(); if (!m) return;
    this.busy = true;
    this.onKey?.(m.from);
    squelch();
    await this.voice.speak(m, speakable(m.text));
    squelch();
    this.onKey?.(null);
    this.busy = false;
    setTimeout(() => this.pump(), 250);
  }
  stop() { this.q = []; this.voice.cancel(); this.busy = false; this.onKey?.(null); }
}
function squelchIf(on: boolean) { if (on) squelch(); }
