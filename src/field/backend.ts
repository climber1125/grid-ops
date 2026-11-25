// ─────────────────────────────────────────────────────────────
// Field session backend. The console (instructor's Sparks Command) and the
// crew phones talk only through this interface.
//
//   firebase — the real thing: Firestore + anonymous sign-in. The instructor
//              password is checked by Firestore security rules (firestore.rules),
//              never by this code, so it can't be bypassed from the browser.
//   local    — same-browser test backend (BroadcastChannel + localStorage).
//              Only used when the page is opened with ?fieldlocal (dev/testing).
//
// Firestore layout (all under sessions/{code}):
//   sessions/{code}                 { owner, status, scenario, created }
//   sessions/{code}/auth/key        { pw }            create-only, unreadable
//   sessions/{code}/crews/{truck}   { uid, foreman, members, t }
//   sessions/{code}/crews/{truck}/inbox/{id}   ToCrew (console → that crew)
//   sessions/{code}/fromCrew/{id}   FromCrew (crew → console)
//   sessions/{code}/public/state    yard snapshot for the phone map
// ─────────────────────────────────────────────────────────────
import type { FromCrew, ToCrew } from '../sim/types';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBbqail8UNeUICSJeeGCGM1B3KUaEhnvRM',
  authDomain: 'sparks-command.firebaseapp.com',
  projectId: 'sparks-command',
  storageBucket: 'sparks-command.firebasestorage.app',
  messagingSenderId: '908623663663',
  appId: '1:908623663663:web:ff0ae917ac71b43dca2cda',
};

export type YardSnap = { dev: Record<string, { open: boolean; tags: number; ctl?: string }>; live: Record<string, boolean>; spans?: Record<string, boolean>; t: number; clock: string; trucks?: Record<string, { status: string; at: string; dest?: string }> };
export interface CrewInfo { truck: string; foreman: string; members: string[]; t: number; }
type Unsub = () => void;

export interface FieldBackend {
  kind: 'firebase' | 'local';
  uid(): Promise<string>;
  // console side
  createSession(code: string, pw: string): Promise<void>;
  closeSession(code: string): Promise<void>;
  sendToCrew(code: string, msgs: ToCrew[]): Promise<void>;
  publishState(code: string, snap: YardSnap): Promise<void>;
  onFromCrew(code: string, cb: (ev: FromCrew) => void): Unsub;
  // crew side
  sessionOpen(code: string): Promise<boolean>;
  join(code: string, crew: CrewInfo, ev: FromCrew): Promise<void>;
  sendFromCrew(code: string, ev: FromCrew): Promise<void>;
  onInbox(code: string, truck: string, cb: (msgs: ToCrew[]) => void): Unsub;
  onState(code: string, cb: (s: YardSnap | null) => void): Unsub;
}

/** Remembers ?fieldlocal so tag links (/t/DEV) opened later in the same browser stay on the test backend. */
export function useLocalBackend(): boolean {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('fieldlocal')) localStorage.setItem('gridops-fieldlocal', q.get('fieldlocal') === '0' ? '0' : '1');
    return localStorage.getItem('gridops-fieldlocal') === '1';
  } catch { return false; }
}

let cached: FieldBackend | null = null;
export function getBackend(): FieldBackend {
  return (cached ??= useLocalBackend() ? new LocalBackend() : new FirebaseBackend());
}

export function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const r = crypto.getRandomValues(new Uint32Array(6));
  for (const x of r) s += A[x % A.length];
  return s;
}
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const strip = <T extends object>(o: T): T => JSON.parse(JSON.stringify(o)); // Firestore rejects undefined

// ── Firebase ─────────────────────────────────────────────────
class FirebaseBackend implements FieldBackend {
  kind = 'firebase' as const;
  private ready: Promise<{ db: any; fs: typeof import('firebase/firestore'); uid: string }> | null = null;

  private init() {
    return (this.ready ??= (async () => {
      const [{ initializeApp }, auth, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
      const app = initializeApp(FIREBASE_CONFIG);
      const a = auth.getAuth(app);
      const cred = a.currentUser ?? (await new Promise<any>(res => { const u = auth.onAuthStateChanged(a, x => { u(); res(x); }); })) ?? (await auth.signInAnonymously(a)).user;
      let db: any;
      try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
      catch { db = fs.getFirestore(app); }
      return { db, fs, uid: cred.uid as string };
    })().catch(err => { this.ready = null; throw friendly(err); }));
  }
  async uid() { return (await this.init()).uid; }

  async createSession(code: string, pw: string) {
    const { db, fs, uid } = await this.init();
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, 'sessions', code), { owner: uid, status: 'open', scenario: 'Z', created: fs.serverTimestamp() });
    b.set(fs.doc(db, 'sessions', code, 'auth', 'key'), { pw });
    try { await b.commit(); } catch (err: any) {
      if (err?.code === 'permission-denied') throw new Error('Wrong instructor password.');
      throw friendly(err);
    }
  }
  async closeSession(code: string) {
    const { db, fs } = await this.init();
    await fs.updateDoc(fs.doc(db, 'sessions', code), { status: 'closed' }).catch(() => {});
  }
  async sendToCrew(code: string, msgs: ToCrew[]) {
    if (!msgs.length) return;
    const { db, fs } = await this.init();
    const b = fs.writeBatch(db);
    for (const m of msgs) b.set(fs.doc(db, 'sessions', code, 'crews', m.truck, 'inbox', m.id), strip(m));
    await b.commit();
  }
  async publishState(code: string, snap: YardSnap) {
    const { db, fs } = await this.init();
    await fs.setDoc(fs.doc(db, 'sessions', code, 'public', 'state'), strip(snap));
  }
  onFromCrew(code: string, cb: (ev: FromCrew) => void): Unsub {
    let un: Unsub | null = null, dead = false;
    this.init().then(({ db, fs }) => {
      if (dead) return;
      un = fs.onSnapshot(fs.collection(db, 'sessions', code, 'fromCrew'), snap => {
        for (const ch of snap.docChanges()) if (ch.type === 'added') cb(ch.doc.data() as FromCrew);
      }, err => console.warn('fromCrew listener', err));
    });
    return () => { dead = true; un?.(); };
  }
  async sessionOpen(code: string) {
    const { db, fs } = await this.init();
    try { const d = await fs.getDoc(fs.doc(db, 'sessions', code)); return d.exists() && d.data().status === 'open'; } catch { return false; }
  }
  async join(code: string, crew: CrewInfo, ev: FromCrew) {
    const { db, fs, uid } = await this.init();
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, 'sessions', code, 'crews', crew.truck), strip({ ...crew, uid }));
    b.set(fs.doc(db, 'sessions', code, 'fromCrew', ev.id), strip({ ...ev, uid }));
    try { await b.commit(); } catch (err: any) {
      if (err?.code === 'permission-denied') throw new Error('Could not join — check the session code with your instructor.');
      throw friendly(err);
    }
  }
  async sendFromCrew(code: string, ev: FromCrew) {
    const { db, fs, uid } = await this.init();
    // Resolves when written to the local cache; Firestore syncs when signal comes back.
    fs.setDoc(fs.doc(db, 'sessions', code, 'fromCrew', ev.id), strip({ ...ev, uid })).catch(err => console.warn('send failed', err));
  }
  onInbox(code: string, truck: string, cb: (msgs: ToCrew[]) => void): Unsub {
    let un: Unsub | null = null, dead = false;
    this.init().then(({ db, fs }) => {
      if (dead) return;
      un = fs.onSnapshot(fs.collection(db, 'sessions', code, 'crews', truck, 'inbox'), snap => cb(snap.docs.map(d => d.data() as ToCrew)), err => console.warn('inbox listener', err));
    });
    return () => { dead = true; un?.(); };
  }
  onState(code: string, cb: (s: YardSnap | null) => void): Unsub {
    let un: Unsub | null = null, dead = false;
    this.init().then(({ db, fs }) => {
      if (dead) return;
      un = fs.onSnapshot(fs.doc(db, 'sessions', code, 'public', 'state'), d => cb(d.exists() ? d.data() as YardSnap : null), () => cb(null));
    });
    return () => { dead = true; un?.(); };
  }
}

function friendly(err: any): Error {
  const c = err?.code ?? '';
  if (c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation') return new Error('Anonymous sign-in is turned off in Firebase (Authentication → Sign-in method → Anonymous).');
  if (c === 'auth/network-request-failed' || c === 'unavailable') return new Error('No connection to the field server. Check signal / Wi-Fi.');
  if (c === 'auth/requests-from-referer-are-blocked' || c === 'auth/unauthorized-domain') return new Error('This web address is not allowed in Firebase (Authentication → Settings → Authorized domains).');
  return err instanceof Error ? err : new Error(String(err));
}

// ── Local test backend (same browser, any tabs) ─────────────
interface LocalDb { session: { owner: string; status: string } | null; crews: Record<string, CrewInfo & { uid: string }>; inbox: Record<string, Record<string, ToCrew>>; from: Record<string, FromCrew>; state: YardSnap | null; }
class LocalBackend implements FieldBackend {
  kind = 'local' as const;
  private chan: BroadcastChannel | null = (() => { try { return new BroadcastChannel('gridops-field'); } catch { return null; } })();
  private subs = new Set<() => void>();
  private me = (() => { try { return sessionStorage.getItem('gridops-field-uid') ?? (sessionStorage.setItem('gridops-field-uid', 'u' + Math.random().toString(36).slice(2, 9)), sessionStorage.getItem('gridops-field-uid')!); } catch { return 'u-local'; } })();
  constructor() {
    if (this.chan) this.chan.onmessage = () => this.fire();
    try { addEventListener('storage', ev => { if (ev.key?.startsWith('gridops-fieldlocal:')) this.fire(); }); } catch { /* no window */ }
  }
  private fire() { for (const f of this.subs) f(); }
  private key = (code: string) => `gridops-fieldlocal:${code}`;
  private read(code: string): LocalDb { try { const v = localStorage.getItem(this.key(code)); if (v) return JSON.parse(v); } catch { /* empty */ } return { session: null, crews: {}, inbox: {}, from: {}, state: null }; }
  private write(code: string, fn: (d: LocalDb) => void) { const d = this.read(code); fn(d); localStorage.setItem(this.key(code), JSON.stringify(d)); this.chan?.postMessage(code); this.fire(); }
  private watch(fn: () => void): Unsub { this.subs.add(fn); queueMicrotask(fn); return () => { this.subs.delete(fn); }; }
  async uid() { return this.me; }
  async createSession(code: string, pw: string) {
    if (!pw.trim()) throw new Error('Enter the instructor password.');
    this.write(code, d => { d.session = { owner: this.me, status: 'open' }; });
  }
  async closeSession(code: string) { this.write(code, d => { if (d.session) d.session.status = 'closed'; }); }
  async sendToCrew(code: string, msgs: ToCrew[]) { if (msgs.length) this.write(code, d => { for (const m of msgs) (d.inbox[m.truck] ??= {})[m.id] = strip(m); }); }
  async publishState(code: string, snap: YardSnap) { this.write(code, d => { d.state = strip(snap); }); }
  onFromCrew(code: string, cb: (ev: FromCrew) => void): Unsub {
    const seen = new Set<string>();
    return this.watch(() => { for (const ev of Object.values(this.read(code).from)) if (!seen.has(ev.id)) { seen.add(ev.id); cb(ev); } });
  }
  async sessionOpen(code: string) { return this.read(code).session?.status === 'open'; }
  async join(code: string, crew: CrewInfo, ev: FromCrew) {
    if (!(await this.sessionOpen(code))) throw new Error('Could not join — check the session code with your instructor.');
    this.write(code, d => { d.crews[crew.truck] = { ...crew, uid: this.me }; d.from[ev.id] = { ...ev, uid: this.me }; });
  }
  async sendFromCrew(code: string, ev: FromCrew) { this.write(code, d => { d.from[ev.id] = strip({ ...ev, uid: this.me }); }); }
  onInbox(code: string, truck: string, cb: (msgs: ToCrew[]) => void): Unsub {
    let last = '';
    return this.watch(() => { const v = Object.values(this.read(code).inbox[truck] ?? {}); const j = JSON.stringify(v); if (j !== last) { last = j; cb(v); } });
  }
  onState(code: string, cb: (s: YardSnap | null) => void): Unsub {
    let last = '';
    return this.watch(() => { const s = this.read(code).state; const j = JSON.stringify(s); if (j !== last) { last = j; cb(s); } });
  }
}
