// Field radio: short voice clips recorded in the browser and sent through the session.
// Clips ride inside the session documents (no extra storage setup). Max 30 s each.
export interface Clip { audio: string; mime: string; dur: number; }
export const MAX_SEC = 30;

function pickMime(): string {
  const M = (window as any).MediaRecorder;
  if (!M?.isTypeSupported) return '';
  for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) if (M.isTypeSupported(m)) return m;
  return '';
}
export const canRecord = () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!(window as any).MediaRecorder;

let stream: MediaStream | null = null;
async function mic(): Promise<MediaStream> {
  if (stream && stream.getTracks().some(t => t.readyState === 'live')) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return stream;
}

export interface Rec { stop(): Promise<Clip | null>; cancel(): void; }
/** Start recording. Resolves once the mic is open. */
export async function startRec(onAutoStop?: (c: Clip | null) => void): Promise<Rec> {
  const s = await mic();
  const mime = pickMime();
  const rec: MediaRecorder = new (window as any).MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24000 });
  const parts: Blob[] = [];
  const t0 = performance.now();
  let done: ((c: Clip | null) => void) | null = null;
  let cancelled = false;
  const finished = new Promise<Clip | null>(res => { done = res; });
  rec.ondataavailable = ev => { if (ev.data.size) parts.push(ev.data); };
  rec.onstop = async () => {
    const dur = (performance.now() - t0) / 1000;
    if (cancelled || dur < 0.4 || !parts.length) { done!(null); return; }
    const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' });
    const audio = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(blob); });
    done!({ audio, mime: blob.type, dur: Math.round(dur * 10) / 10 });
  };
  rec.start(250);
  const timer = setTimeout(() => { if (rec.state === 'recording') { rec.stop(); finished.then(c => onAutoStop?.(c)); } }, MAX_SEC * 1000);
  return {
    stop() { clearTimeout(timer); if (rec.state === 'recording') rec.stop(); return finished; },
    cancel() { cancelled = true; clearTimeout(timer); if (rec.state === 'recording') rec.stop(); },
  };
}

let cur: HTMLAudioElement | null = null;
export function playClip(audio: string): Promise<void> {
  cur?.pause();
  cur = new Audio(audio);
  return cur.play().catch(() => { /* blocked until the user taps something */ });
}
/** Short two-tone chirp so a radio call is noticed even when the clip can't autoplay. */
export function chirp() {
  try {
    const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (!C) return;
    const ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); g.gain.value = 0.08;
    o.frequency.setValueAtTime(1200, ctx.currentTime); o.frequency.setValueAtTime(900, ctx.currentTime + 0.09);
    o.start(); o.stop(ctx.currentTime + 0.18);
  } catch { /* no audio */ }
}
