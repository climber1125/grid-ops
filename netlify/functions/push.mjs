// Netlify function: send a push notification to field crew phones.
// Only the instructor console that owns the session can call it: the caller's
// Firebase ID token is verified, and its uid must be the session's owner.
// Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (Netlify environment variables).
import webpush from 'web-push';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PROJECT = 'sparks-command';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return json({ error: 'Push keys not configured' }, 500);
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'No token' }, 401);
  let uid;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT });
    uid = payload.sub;
  } catch { return json({ error: 'Bad token' }, 401); }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const code = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const trucks = (Array.isArray(body.trucks) ? body.trucks : []).map(t => String(t).replace(/\D/g, '').slice(0, 4)).filter(Boolean).slice(0, 12);
  if (code.length !== 6 || !trucks.length) return json({ error: 'code and trucks required' }, 400);
  const auth = { headers: { authorization: `Bearer ${token}` } };

  // Caller must own the session.
  const s = await fetch(`${FS}/sessions/${code}`, auth);
  if (!s.ok) return json({ error: 'No session' }, 404);
  const owner = (await s.json())?.fields?.owner?.stringValue;
  if (owner !== uid) return json({ error: 'Not the session owner' }, 403);

  webpush.setVapidDetails('mailto:ditchdigger1125@gmail.com', pub, priv);
  const payload = JSON.stringify({
    title: String(body.title ?? 'Sparks Control').slice(0, 80),
    body: String(body.body ?? '').slice(0, 240),
    tag: String(body.tag ?? 'sparks').slice(0, 60),
    url: String(body.url ?? '/field').slice(0, 120),
  });
  const results = {};
  await Promise.all(trucks.map(async t => {
    try {
      const r = await fetch(`${FS}/sessions/${code}/crews/${t}`, auth);
      if (!r.ok) { results[t] = 'no crew'; return; }
      const sub = (await r.json())?.fields?.push?.stringValue;
      if (!sub) { results[t] = 'notifications off'; return; }
      await webpush.sendNotification(JSON.parse(sub), payload, { TTL: 900, urgency: 'high' });
      results[t] = 'sent';
    } catch (err) { results[t] = err?.statusCode === 404 || err?.statusCode === 410 ? 'subscription expired' : `error ${err?.statusCode ?? ''}`.trim(); }
  }));
  return json({ ok: true, results });
};
