// Friends for signed-in players: requests, friends list, who is online, and table invites.
// Saved in Supabase (table from supabase-friends.sql). Without Supabase (local testing) kept in memory.
const SB_URL = (() => { const raw = (process.env.SUPABASE_URL || '').trim(); if (!raw) return ''; try { return new URL(raw.includes('://') ? raw : 'https://' + raw).origin; } catch (e) { return raw.replace(/\/+$/, ''); } })();
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const enabled = !!(SB_URL && SERVICE && (process.env.SUPABASE_ANON_KEY || '').trim());
const MAX = 200;
const isId = id => /^[0-9a-zA-Z_-]{1,64}$/.test(String(id || ''));

async function sb(path, opts = {}) {
  const r = await fetch(SB_URL + path, {
    ...opts,
    headers: { apikey: SERVICE, ...(SERVICE.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SERVICE }), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

// rows: { a: requester, b: receiver, status: 'pending' | 'accepted' }
const mem = [];
const cache = new Map(); // profile id -> Map(otherId -> { status, mine }) ; mine = I sent the request
async function rowsFor(id) {
  if (!enabled) return mem.filter(r => r.a === id || r.b === id);
  return await sb(`/rest/v1/friends?or=(a.eq.${id},b.eq.${id})&select=a,b,status&limit=${MAX * 2}`) || [];
}
async function links(id) {
  if (cache.has(id)) return cache.get(id);
  const m = new Map();
  for (const r of await rowsFor(id)) { const other = r.a === id ? r.b : r.a; m.set(other, { status: r.status, mine: r.a === id }); }
  cache.set(id, m); if (cache.size > 5000) cache.clear();
  return m;
}
const drop = (...ids) => ids.forEach(i => cache.delete(i));

async function status(me, other) {
  if (!me || !other || me === other) return null;
  const l = (await links(me)).get(other);
  if (!l) return 'none';
  if (l.status === 'accepted') return 'friend';
  return l.mine ? 'sent' : 'incoming';
}

// Send a request, or accept one that is waiting the other way
async function add(me, other) {
  if (!isId(me) || !isId(other) || me === other) return { error: 'Not allowed' };
  const st = await status(me, other);
  if (st === 'friend') return { status: 'friend' };
  if (st === 'sent') return { status: 'sent' };
  if (st === 'incoming') return accept(me, other);
  if ((await links(me)).size >= MAX) return { error: `You can have up to ${MAX} friends` };
  if (enabled) await sb('/rest/v1/friends', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ a: me, b: other, status: 'pending' }) });
  else mem.push({ a: me, b: other, status: 'pending' });
  drop(me, other);
  return { status: 'sent', requested: true };
}
async function accept(me, other) {
  if ((await status(me, other)) !== 'incoming') return { error: 'No request to accept' };
  if (enabled) await sb(`/rest/v1/friends?a=eq.${other}&b=eq.${me}`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) });
  else { const r = mem.find(x => x.a === other && x.b === me); if (r) r.status = 'accepted'; }
  drop(me, other);
  return { status: 'friend', accepted: true };
}
// Decline a request, cancel your own, or remove a friend
async function remove(me, other) {
  if (!isId(me) || !isId(other)) return { error: 'Not allowed' };
  if (enabled) await sb(`/rest/v1/friends?or=(and(a.eq.${me},b.eq.${other}),and(a.eq.${other},b.eq.${me}))`, { method: 'DELETE' });
  else for (let i = mem.length - 1; i >= 0; i--) if ((mem[i].a === me && mem[i].b === other) || (mem[i].a === other && mem[i].b === me)) mem.splice(i, 1);
  drop(me, other);
  return { status: 'none' };
}

module.exports = { enabled, links, status, add, accept, remove };
