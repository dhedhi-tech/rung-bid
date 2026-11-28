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
      sb('/rest/v1/replays?created_at=lt.' + new Date(Date.now() - KEEP_DAYS * 864e5).toISOString(), { method: 'DELETE' }).catch(quiet);
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

module.exports = { save, get };
