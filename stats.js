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
  let app = [];
  try { const since = dayOf(Date.now() - 30 * 86400000); app = (await sb(`/rest/v1/app_days?select=day,pid,uid&day=gte.${since}&limit=20000`)).data || []; } catch (e) { app = null; }
  return { daily: daily.data || [], top: top.data || [], accounts: total, recent: recent.data || [], app };
}
function memReport() {
  const days = new Set([...mem.days.keys(), ...mem.log.map(l => dayOf(l.at))]);
  const firstSeen = new Map();
  for (const d of [...mem.days.keys()].sort()) for (const pid of mem.days.get(d).keys()) if (!firstSeen.has(pid)) firstSeen.set(pid, d);
  const daily = [...days].sort().reverse().slice(0, 30).map(day => {
    const m = mem.days.get(day) || new Map(), L = mem.log.filter(l => dayOf(l.at) === day), st = L.filter(l => l.kind === 'start'), fin = L.filter(l => l.kind === 'finish');
    return {
      day, players: m.size, signed_players: [...m.values()].filter(Boolean).length, new_players: [...m.keys()].filter(p => firstSeen.get(p) === day).length, signups: 0,
      games_started: st.length, games_finished: fin.length, hands: fin.reduce((a, l) => a + (l.hands || 0), 0),
      joker_games: st.filter(l => l.joker).length, p4: st.filter(l => l.n === 4).length, p6: st.filter(l => l.n === 6).length, p8: st.filter(l => l.n === 8).length,
      bot_games: st.filter(l => l.humans === 1).length,
    };
  });
  const app = [...mem.app.entries()].map(([k, uid]) => ({ day: k.split('|')[0], pid: k.split('|')[1], uid }));
  return { daily, top: [], accounts: 0, memory: true, app };
}

module.exports = { enabled, playerSeen, appSeen, logGame, report, dayOf, sb };
