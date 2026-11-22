// Game stats for the private admin page: who played each day (guests too) and every game started or finished.
// Saved to Supabase (tables from supabase-stats.sql). Without Supabase, kept in memory for local testing.
const SB_URL = (() => { const raw = (process.env.SUPABASE_URL || '').trim(); if (!raw) return ''; try { return new URL(raw.includes('://') ? raw : 'https://' + raw).origin; } catch (e) { return raw.replace(/\/+$/, ''); } })();
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const enabled = !!(SB_URL && SERVICE);

// Days follow Pakistan time
const dayOf = (ms = Date.now()) => new Date(ms + 5 * 3600 * 1000).toISOString().slice(0, 10);

async function sb(path, opts = {}) {
  const r = await fetch(SB_URL + path, {
    ...opts,
    headers: { apikey: SERVICE, ...(SERVICE.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SERVICE }), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const t = await r.text(); return { data: t ? JSON.parse(t) : null, range: r.headers.get('content-range') };
}
let warned = false;
const quiet = e => { if (!warned) { warned = true; console.error('stats:', e.message, '(run supabase-stats.sql in Supabase)'); } };

// ---- memory copy (local testing only) ----
const mem = { days: new Map(), log: [], app: new Map() }; // days: day -> Map(pid -> signed)

// Each player is recorded once per day; again only if they sign in later that day
// The typed name is saved too, so one person on a new browser or phone counts once (see the admin_daily view)
const seen = new Map(); // pid -> 'day|signed|name'
let noNameCols = false; // supabase-stats.sql not re-run yet: save without name and uid
function playerSeen(pid, signed, name, uid) {
  const nm = String(name || '').trim().slice(0, 20), day = dayOf(), key = day + '|' + (signed ? 1 : 0) + '|' + nm, prev = seen.get(pid);
  if (prev === key || (!signed && prev && prev.startsWith(day + '|1|') && prev.endsWith('|' + nm))) return;
  seen.set(pid, key);
  if (seen.size > 50000) seen.clear();
  if (!enabled) { if (!mem.days.has(day)) mem.days.set(day, new Map()); const m = mem.days.get(day); m.set(pid, m.get(pid) || !!signed); return; }
  const body = { day, pid };
  if (signed) body.signed = true;
  if (!noNameCols) { if (nm && nm.toLowerCase() !== 'player') body.name = nm; if (uid) body.uid = String(uid); }
  const send = b => sb('/rest/v1/player_days?on_conflict=day,pid', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(b) });
  send(body).catch(e => {
    if (!noNameCols && /name|uid|column/i.test(e.message)) { noNameCols = true; console.error('stats: run supabase-stats.sql again to save player names'); const { name: _n, uid: _u, ...old } = body; return send(old).catch(quiet); }
    quiet(e);
  });
}

// Players using the Android app: one row per player per day (account id added once they sign in)
const appSeenMap = new Map(); // pid -> 'day|uid'
function appSeen(pid, uid) {
  const day = dayOf(), key = day + '|' + (uid || ''), prev = appSeenMap.get(pid);
  if (prev === key || (prev && prev.startsWith(day + '|') && prev !== day + '|' && !uid)) return;
  appSeenMap.set(pid, key);
  if (appSeenMap.size > 50000) appSeenMap.clear();
  if (!enabled) { mem.app.set(day + '|' + pid, uid || (mem.app.get(day + '|' + pid) || null)); return; }
  sb('/rest/v1/app_days?on_conflict=day,pid', {
    method: 'POST', headers: { Prefer: (uid ? 'resolution=merge-duplicates' : 'resolution=ignore-duplicates') + ',return=minimal' },
    body: JSON.stringify(uid ? { day, pid, uid } : { day, pid }),
  }).catch(e => { if (!appWarned) { appWarned = true; console.error('app stats:', e.message, '(run supabase-app.sql in Supabase)'); } });
}
let appWarned = false;

function logGame(row) {
  const r = { kind: row.kind, code: row.code, n: row.n, joker: !!row.joker, lim: row.lim, humans: row.humans, signed: row.signed, hands: row.hands || null };
  if (!enabled) { mem.log.push({ ...r, at: Date.now() }); if (mem.log.length > 20000) mem.log.shift(); return; }
  sb('/rest/v1/game_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(r) }).catch(quiet);
}

// ---- first games: how far a new player gets in their very first game (supabase-first.sql) ----
const firstMem = new Map(); let firstWarned = false;
function firstGame(pid, patch) {
  const row = { pid, ...patch, updated_at: new Date().toISOString() };
  firstNone.delete(pid);
  if (!enabled) { firstMem.set(pid, { ...(firstMem.get(pid) || { started_at: row.updated_at }), ...row }); return; }
  sb('/rest/v1/first_games?on_conflict=pid', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) })
    .catch(e => { if (!firstWarned) { firstWarned = true; console.error('first games:', e.message, '(run supabase-first.sql in Supabase)'); } });
}

// After the first game: when a new player was last seen and what they did (opened the app, joined a table, played a hand…)
// Only players who have a first_games row; the rest are remembered here so we stop asking.
const firstNone = new Set();
function firstSeen(pid, did, extra) {
  if (!pid || firstNone.has(pid)) return;
  const row = { last_at: new Date().toISOString(), last_did: String(did || '').slice(0, 120), ...(extra || {}) };
  if (!enabled) { const r = firstMem.get(pid); if (r) Object.assign(r, row); else firstNone.add(pid); return; }
  sb(`/rest/v1/first_games?pid=eq.${encodeURIComponent(pid)}&select=pid`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) })
    .then(r => { if (!(r.data || []).length) { firstNone.add(pid); if (firstNone.size > 50000) firstNone.clear(); } })
    .catch(e => { if (!firstWarned) { firstWarned = true; console.error('first games:', e.message, '(run supabase-first.sql in Supabase)'); } });
}

async function firstGet(pid) {
  if (!enabled) return firstMem.get(pid) || null;
  try { const r = await sb(`/rest/v1/first_games?pid=eq.${encodeURIComponent(pid)}&select=step,hands,started_at,play_secs`); return (r.data || [])[0] || null; } catch (e) { return null; }
}

// ---- install source: where a new player came from (supabase-source.sql) ----
// ref is the raw Play referrer, e.g. "utm_source=share_win" or "utm_source=google-play&utm_medium=organic"
const srcMem = new Map(); let srcWarned = false;
function parseRef(ref) {
  const q = new URLSearchParams(String(ref || '')), src = (q.get('utm_source') || '').slice(0, 40), med = (q.get('utm_medium') || '').slice(0, 40);
  return { source: src || (ref ? 'other' : 'unknown'), medium: med || null };
}
function sourceSeen(pid, o) {
  const row = { pid, app: !!o.app, ref: o.ref || '', ...parseRef(o.ref), installed_at: o.at ? new Date(o.at * 1000).toISOString() : null };
  if (!enabled) { if (!srcMem.has(pid)) srcMem.set(pid, { ...row, at: new Date().toISOString() }); return; }
  sb('/rest/v1/install_sources?on_conflict=pid', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(row) })
    .catch(e => { if (!srcWarned) { srcWarned = true; console.error('install sources:', e.message, '(run supabase-source.sql in Supabase)'); } });
}

// ---- report for the admin page ----
async function report() {
  if (!enabled) return memReport();
  const [daily, top, count, recent] = await Promise.all([
    sb('/rest/v1/admin_daily?select=*&order=day.desc&limit=30'),
    sb('/rest/v1/profiles?select=name,xp,coins,games,wins,created_at&order=games.desc,xp.desc&limit=15'),
    sb('/rest/v1/profiles?select=id&limit=1', { headers: { Prefer: 'count=exact' } }),
    sb('/rest/v1/profiles?select=id,name,created_at,games,xp&order=created_at.desc&limit=30'),
  ]);
  const total = count.range ? Number(count.range.split('/')[1]) || 0 : 0;
  // Players list (named or signed-in people seen in the last 30 days, longest absent first) and return rate
  let people = null, retention = null;
  try {
    const since = dayOf(Date.now() - 30 * 86400000);
    const [pp, rr] = await Promise.all([
      sb(`/rest/v1/admin_people?select=name,first_day,last_day,days,signed,app&who=not.like.p:*&last_day=gte.${since}&order=last_day.asc,days.desc&limit=300`),
      sb('/rest/v1/admin_retention?select=*'),
    ]);
    people = pp.data || []; retention = (rr.data || [])[0] || null;
  } catch (e) { people = null; }
  let app = [];
  try { const since = dayOf(Date.now() - 30 * 86400000); app = (await sb(`/rest/v1/app_days?select=day,pid,uid&day=gte.${since}&limit=20000`)).data || []; } catch (e) { app = null; }
  // Table size x Joker, games started in the last 30 days
  let modes = null;
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    modes = countModes((await sb(`/rest/v1/game_log?select=n,joker,lim&kind=eq.start&at=gte.${since}&limit=50000`)).data || []);
  } catch (e) { modes = null; }
  let first = null;
  try { first = (await sb('/rest/v1/first_games?select=*&order=started_at.desc&limit=40')).data || []; } catch (e) { first = null; }
  // Signed in later? Show the account name next to "Guest NNN"
  try {
    const ids = [...new Set((first || []).map(f => f.uid).filter(Boolean))];
    if (ids.length) { const pr = (await sb(`/rest/v1/profiles?select=id,name,created_at&id=in.(${ids.map(encodeURIComponent).join(',')})`)).data || [];
      const by = new Map(pr.map(p => [p.id, p])); for (const f of first) { const p = by.get(f.uid); if (p) { f.acct = p.name; f.acct_at = p.created_at; } } }
  } catch (e) {}
  let sources = null;
  try {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const rows = (await sb(`/rest/v1/install_sources?select=pid,app,source,medium,at&at=gte.${since}&order=at.desc&limit=2000`)).data || [];
    sources = countSources(rows);
    if (first) { const by = new Map(rows.map(r => [r.pid, r])); for (const f of first) { const r = by.get(f.pid); if (r) f.source = srcLabel(r); } }
  } catch (e) { sources = null; }
  return { daily: daily.data || [], top: top.data || [], accounts: total, recent: recent.data || [], app, people, retention, modes, first, sources };
}
function countModes(rows) {
  const m = {}; for (const n of [4, 6, 8]) m[n] = { joker: 0, plain: 0 };
  for (const r of rows) if (m[r.n]) m[r.n][r.joker ? 'joker' : 'plain']++;
  // Game length chosen: 6 hands (Quick), 10 (Normal), 0 = no limit (Full)
  m.lim = { 6: 0, 10: 0, 0: 0 };
  for (const r of rows) if (r.lim in m.lim) m.lim[r.lim]++;
  return m;
}
function memReport() {
  const days = new Set([...mem.days.keys(), ...mem.log.map(l => dayOf(l.at))]);
  const firstDay = new Map();
  for (const d of [...mem.days.keys()].sort()) for (const pid of mem.days.get(d).keys()) if (!firstDay.has(pid)) firstDay.set(pid, d);
  const daily = [...days].sort().reverse().slice(0, 30).map(day => {
    const m = mem.days.get(day) || new Map(), L = mem.log.filter(l => dayOf(l.at) === day), st = L.filter(l => l.kind === 'start'), fin = L.filter(l => l.kind === 'finish');
    return {
      day, players: m.size, signed_players: [...m.values()].filter(Boolean).length, new_players: [...m.keys()].filter(p => firstDay.get(p) === day).length, signups: 0,
      games_started: st.length, games_finished: fin.length, hands: fin.reduce((a, l) => a + (l.hands || 0), 0),
      joker_games: st.filter(l => l.joker).length, p4: st.filter(l => l.n === 4).length, p6: st.filter(l => l.n === 6).length, p8: st.filter(l => l.n === 8).length,
      bot_games: st.filter(l => l.humans === 1).length,
    };
  });
  const app = [...mem.app.entries()].map(([k, uid]) => ({ day: k.split('|')[0], pid: k.split('|')[1], uid }));
  const modes = countModes(mem.log.filter(l => l.kind === 'start' && Date.now() - l.at < 30 * 86400000));
  const first = [...firstMem.values()].sort((a, b) => (b.started_at > a.started_at ? 1 : -1));
  for (const f of first) { const r = srcMem.get(f.pid); if (r) f.source = srcLabel(r); }
  return { daily, top: [], accounts: 0, memory: true, app, modes, first, sources: countSources([...srcMem.values()]) };
}

// Plain names for the admin page
function srcLabel(r) {
  const s = r.source, m = r.medium;
  if (s === 'google-play' && m === 'organic') return 'Play Store search / browse';
  if (s === 'google-play') return 'Play Store' + (m ? ' (' + m + ')' : '');
  if (s === 'share_win') return 'Shared win';
  if (s === 'share_sweep') return 'Shared sweep';
  if (s === 'share_whitewash') return 'Shared whitewash';
  if (s === 'website') return 'Website' + (m ? ' (' + m.replace(/_/g, ' ') + ')' : '');
  if (s === 'unknown') return 'Not from Play';
  return s + (m ? ' / ' + m : '');
}
function countSources(rows) {
  const c = {};
  for (const r of rows) { const k = (r.app ? '' : 'Web: ') + srcLabel(r); c[k] = (c[k] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }));
}

module.exports = { enabled, sourceSeen, playerSeen, appSeen, logGame, firstGame, firstSeen, firstGet, report, dayOf, sb };
