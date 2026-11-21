// Push notifications to the Android app through Firebase Cloud Messaging (FCM).
// Phones register a token (socket 'pushToken'), saved in Supabase push_tokens (supabase-push.sql), one row per phone (pid).
// Sends: a friend's table invite when the friend's app is closed, and a "come back" reminder at 8 pm Pakistan time
// to players away 2+ days (at most once every 3 days, stops after 3 unanswered reminders).
// Needs env FCM_SA_KEY = the Firebase service account JSON key (Firebase project settings > Service accounts).
const crypto = require('crypto');
const S = require('./stats');

function key() {
  try { const k = JSON.parse(process.env.FCM_SA_KEY || ''); return k.client_email && k.private_key && k.project_id ? k : null; } catch (e) { return null; }
}
const enabled = () => !!(S.enabled && key());
let warned = false;
const quiet = e => { if (!warned) { warned = true; console.error('push:', e.message, '(run supabase-push.sql in Supabase?)'); } };

// ---- Google sign-in for the Firebase key (same JWT method as play.js) ----
const b64 = x => Buffer.from(x).toString('base64url');
let tok = { v: null, until: 0 };
async function token() {
  if (tok.v && Date.now() < tok.until) return tok.v;
  const k = key(), now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(k.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + sig });
  const j = await r.json();
  if (!j.access_token) throw new Error('Firebase key sign-in failed: ' + (j.error_description || j.error || r.status));
  tok = { v: j.access_token, until: Date.now() + 50 * 60 * 1000 };
  return tok.v;
}

// Send one notification. Returns 'ok', 'gone' (app removed / token dead) or 'error'
async function sendOne(fcmToken, { title, body, url }) {
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${key().project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: fcmToken, notification: { title, body }, data: url ? { url } : {}, android: { priority: 'high' } } }),
    });
    if (r.ok) return 'ok';
    const t = await r.text();
    if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(t)) return 'gone';
    console.error('push send', r.status, t.slice(0, 200)); return 'error';
  } catch (e) { console.error('push send', e.message); return 'error'; }
}
const drop = pid => S.sb(`/rest/v1/push_tokens?pid=eq.${encodeURIComponent(pid)}`, { method: 'DELETE' }).catch(quiet);

// ---- tokens ----
function saveToken(pid, uid, fcmToken) {
  if (!S.enabled || !fcmToken) return;
  const row = { pid, uid: uid || null, token: String(fcmToken).slice(0, 4096), last_seen: new Date().toISOString(), pushes_since_seen: 0, updated_at: new Date().toISOString() };
  S.sb('/rest/v1/push_tokens?on_conflict=pid', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) }).catch(quiet);
}
function linkUid(pid, uid) {
  if (!S.enabled) return;
  S.sb(`/rest/v1/push_tokens?pid=eq.${encodeURIComponent(pid)}`, { method: 'PATCH', body: JSON.stringify({ uid: uid || null }) }).catch(quiet);
}
// The player opened the app: they are back, so the reminder count starts again (once per phone per day)
const seenToday = new Map();
function seen(pid) {
  if (!S.enabled) return;
  const d = S.dayOf(); if (seenToday.get(pid) === d) return; seenToday.set(pid, d); if (seenToday.size > 50000) seenToday.clear();
  S.sb(`/rest/v1/push_tokens?pid=eq.${encodeURIComponent(pid)}`, { method: 'PATCH', body: JSON.stringify({ last_seen: new Date().toISOString(), pushes_since_seen: 0 }) }).catch(quiet);
}

// Which of these accounts can get a notification (have the app with notifications allowed)
async function reachable(uids) {
  if (!enabled() || !uids.length) return new Set();
  try { return new Set(((await S.sb(`/rest/v1/push_tokens?select=uid&uid=in.(${uids.map(encodeURIComponent).join(',')})`)).data || []).map(r => r.uid)); }
  catch (e) { quiet(e); return new Set(); }
}

// ---- friend invite to someone whose app is closed ----
async function invite(uids, from, code, n, joker) {
  if (!enabled() || !uids.length) return 0;
  let rows = [];
  try { rows = (await S.sb(`/rest/v1/push_tokens?select=pid,token&uid=in.(${uids.map(encodeURIComponent).join(',')})`)).data || []; } catch (e) { quiet(e); return 0; }
  let sent = 0;
  for (const r of rows) {
    const res = await sendOne(r.token, { title: `🃏 ${from} invited you to play`, body: `${n} players${joker ? ', Joker' : ''}. Tap to join the table.`, url: 'https://www.pattaparty.com/?t=' + code });
    if (res === 'ok') sent++; else if (res === 'gone') drop(r.pid);
  }
  return sent;
}

// ---- come-back reminder, 8 pm Pakistan time ----
const REMIND = { title: '🪙 Your daily coins are waiting', body: 'Come play a quick game of Rung with the bots or your friends.' };
let lastRun = '';
async function reminders() {
  if (!enabled()) return;
  const pk = new Date(Date.now() + 5 * 3600 * 1000), day = pk.toISOString().slice(0, 10);
  if (pk.getUTCHours() !== 20 || lastRun === day) return;
  lastRun = day;
  const now = Date.now(), away = new Date(now - 2 * 864e5).toISOString(), gap = new Date(now - 3 * 864e5).toISOString();
  let rows = [];
  try { rows = (await S.sb(`/rest/v1/push_tokens?select=pid,token,pushes_since_seen&last_seen=lt.${away}&pushes_since_seen=lt.3&or=(last_push.is.null,last_push.lt.${gap})&limit=1000`)).data || []; } catch (e) { quiet(e); return; }
  let sent = 0;
  for (const r of rows) {
    const res = await sendOne(r.token, { ...REMIND, url: 'https://www.pattaparty.com/' });
    if (res === 'gone') { drop(r.pid); continue; }
    if (res !== 'ok') continue;
    sent++;
    S.sb(`/rest/v1/push_tokens?pid=eq.${encodeURIComponent(r.pid)}`, { method: 'PATCH', body: JSON.stringify({ last_push: new Date().toISOString(), pushes_since_seen: (r.pushes_since_seen || 0) + 1 }) }).catch(quiet);
  }
  if (rows.length) console.log(`push reminders: ${sent} sent of ${rows.length}`);
}
setInterval(() => reminders().catch(e => console.error('push reminders', e.message)), 10 * 60 * 1000).unref();

module.exports = { enabled, reachable, saveToken, linkUid, seen, invite, reminders, sendOne };
