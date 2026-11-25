// Where the edited Texas yard lives.
//   Firestore  yard/current { json, nonce, updatedAt, uid }  — anyone can read, only the
//              instructor password can write (see firestore.rules).
//   Browser    localStorage copy so the app starts offline with the last yard it saw.
// Local test mode (?fieldlocal) keeps the yard in this browser only.
import { applyYardDoc, checkYardDoc, type YardDoc } from '../sim/texasYard';
import { FIREBASE_CONFIG, useLocalBackend } from './backend';

const CACHE = 'gridops-yard', LOCAL = 'gridops-yard-local';
const REST = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/yard/current?key=${FIREBASE_CONFIG.apiKey}`;

export type YardSource = 'built-in' | 'saved' | 'cached' | 'local';
export let yardSource: YardSource = 'built-in';
export let yardSavedAt: string | null = null;

const readLS = (k: string): { doc: YardDoc; at?: string } | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };
const writeLS = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full / private */ } };

/** Load the saved yard before the network is built. Never blocks more than ~2.5 s. */
export async function initYard(): Promise<void> {
  try {
    if (useLocalBackend()) {
      const l = readLS(LOCAL);
      if (l?.doc && applyYardDoc(l.doc)) { yardSource = 'local'; yardSavedAt = l.at ?? null; }
      return;
    }
    const cached = readLS(CACHE);
    let doc: YardDoc | null = null, at: string | null = null;
    try {
      const r = await fetch(REST, { signal: AbortSignal.timeout(2500), cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        const s = j?.fields?.json?.stringValue;
        if (s) { doc = JSON.parse(s); at = j?.fields?.updatedAt?.stringValue ?? null; writeLS(CACHE, { doc, at }); yardSource = 'saved'; }
      }
    } catch { /* offline — fall back to the cache */ }
    if (!doc && cached?.doc) { doc = cached.doc; at = cached.at ?? null; yardSource = 'cached'; }
    if (doc && !applyYardDoc(doc)) yardSource = 'built-in';
    yardSavedAt = at;
  } catch { /* keep the built-in yard */ }
}

/** Save the yard for everyone (instructor password checked by Firestore rules). */
export async function saveYard(doc: YardDoc, pw: string): Promise<void> {
  const bad = checkYardDoc(doc);
  if (bad.length) throw new Error(bad[0]);
  const at = new Date().toISOString();
  const d = { ...doc, updatedAt: at };
  if (useLocalBackend()) { writeLS(LOCAL, { doc: d, at }); return; }
  const [{ initializeApp, getApps }, auth, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
  const app = getApps()[0] ?? initializeApp(FIREBASE_CONFIG);
  const a = auth.getAuth(app);
  const user = a.currentUser ?? (await auth.signInAnonymously(a)).user;
  const db = fs.getFirestore(app);
  const nonce = crypto.getRandomValues(new Uint32Array(2)).join('-');
  const b = fs.writeBatch(db);
  b.set(fs.doc(db, 'yard', 'current', 'auth', 'key'), { pw, nonce });
  b.set(fs.doc(db, 'yard', 'current'), { json: JSON.stringify(d), nonce, updatedAt: at, uid: user.uid });
  try { await b.commit(); } catch (err: any) {
    if (err?.code === 'permission-denied') throw new Error('Wrong instructor password (or the Firestore rules need the yard section — re-paste firestore.rules).');
    throw err;
  }
  writeLS(CACHE, { doc: d, at });
}
