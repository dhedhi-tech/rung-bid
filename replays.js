// Hand replays (Nov 28 2026): every finished hand is saved (moves only, a few KB) so it can be played back at /replay?id=...
// Saved to Supabase table `replays` (supabase-replays.sql) and kept 7 days. Without Supabase, kept in memory for local testing.
const crypto = require('crypto');
const SB_URL = (() => { const raw = (process.env.SUPABASE_URL || '').trim(); if (!raw) return ''; try { return new URL(raw.includes('://') ? raw : 'https://' + raw).origin; } catch (e) { return raw.replace(/\/+$/, ''); } })();
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const enabled = !!(SB_URL && SERVICE);
const KEEP_DAYS = 7;

async function sb(path, opts = {}) {
  const r = await fetch(SB_URL + path, {
    ...opts,
    headers: { apikey: SERVICE, ...(SERVICE.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SERVICE }), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
let warned = false;
const quiet = e => { if (!warned) { warned = true; console.error('replays:', e.message, '(run supabase-replays.sql in Supabase)'); } };

// Recent replays also stay in memory, so the replay opens even before Supabase has it (and for local testing)
const mem = new Map();
let cleanAt = 0;

function save(rec, code) {
  const id = crypto.randomBytes(9).toString('base64url');
  mem.set(id, rec); if (mem.size > 300) mem.delete(mem.keys().next().value);
  if (enabled) {
    sb('/rest/v1/replays', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id, code, n: rec.n, joker: !!rec.joker, data: rec }) }).catch(quiet);
    if (Date.now() - cleanAt > 3600e3) {
      cleanAt = Date.now();
      const old = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString();
      sb('/rest/v1/replays?created_at=lt.' + old, { method: 'DELETE' }).catch(quiet);
      sb('/rest/v1/replay_games?upd=lt.' + old, { method: 'DELETE' }).catch(quiet);
    }
  }
  return id;
}

async function get(id) {
  if (!/^[\w-]{6,30}$/.test(id)) return null;
  if (mem.has(id)) return mem.get(id);
  if (!enabled) return null;
  try { const rows = await sb('/rest/v1/replays?select=data&id=eq.' + encodeURIComponent(id)); return rows && rows[0] ? rows[0].data : null; }
  catch (e) { quiet(e); return null; }
}

// ---- My last games: one summary per game (who played, each hand with its replay id, score) ----
const games = new Map(); // recent games in memory (also the only copy without Supabase)
function noteGame(gid, info) {
  if (!gid) return;
  let g = games.get(gid);
  if (!g) { g = { id: gid, code: info.code, n: info.n, joker: !!info.joker, limit: info.limit, at: info.at, people: [], hands: [] }; games.set(gid, g); if (games.size > 500) games.delete(games.keys().next().value); }
  for (const p of info.people) { // everyone who played any hand of this game (seat = their last seat)
    const old = g.people.find(x => x.pid === p.pid);
    if (old) Object.assign(old, p); else g.people.push(p);
  }
  g.hands.push(info.hand); g.seats = info.seats; g.score = info.score; g.over = !!info.over; g.upd = Date.now();
  if (enabled) {
    const row = { id: gid, pids: [...new Set(g.people.map(p => p.pid))], uids: [...new Set(g.people.map(p => p.uid).filter(Boolean))], data: g, upd: new Date(g.upd).toISOString() };
    sb('/rest/v1/replay_games?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) }).catch(quiet);
  }
}
// The last 5 games this phone (pid) or Google account (uid) played in, newest first
async function myGames(pid, uid, max = 5) {
  const mine = g => g.people.some(p => p.pid === pid || (uid && p.uid === uid));
  let list = [];
  if (enabled) {
    try {
      const q = s => '"' + String(s).replace(/["\\]/g, '') + '"';
      const or = `(pids.cs.{${q(pid)}}${uid ? `,uids.cs.{${q(uid)}}` : ''})`;
      const rows = await sb('/rest/v1/replay_games?select=data&order=upd.desc&limit=' + max + '&or=' + encodeURIComponent(or));
      list = (rows || []).map(r => r.data);
    } catch (e) { quiet(e); }
  }
  for (const g of games.values()) if (mine(g) && !list.some(x => x.id === g.id)) list.push(g); // newest copy may not be in Supabase yet
  list = list.map(g => games.get(g.id) || g).sort((a, b) => b.upd - a.upd).slice(0, max);
  return list.map(g => {
    const me = g.people.filter(p => p.pid === pid || (uid && p.uid === uid)).pop();
    return { id: g.id, at: g.at, upd: g.upd, n: g.n, joker: g.joker, limit: g.limit, over: g.over, score: g.score, me: me ? me.seat : 0, seats: g.seats, hands: g.hands };
  });
}

module.exports = { save, get, noteGame, myGames };
