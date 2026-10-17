// Player accounts: Google sign-in through Supabase, profiles, XP levels, coins and the table theme store.
// Needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY on the server.
// For local testing only, DEV_LOGIN=1 enables a fake sign-in and keeps profiles in memory.

// Keep only https://xxxx.supabase.co even if a longer address (like .../rest/v1/) was pasted
const SB_URL = (() => { const raw = (process.env.SUPABASE_URL || '').trim(); if (!raw) return ''; try { return new URL(raw.includes('://') ? raw : 'https://' + raw).origin; } catch (e) { return raw.replace(/\/+$/, ''); } })();
const ANON = (process.env.SUPABASE_ANON_KEY || '').trim();
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const DEV = process.env.DEV_LOGIN === '1';
const enabled = !!(SB_URL && ANON && SERVICE);

// ---- rules ----
const XP = { hand: 10, handWin: 10, bidMade: 10, sweep: 20, whitewash: 20, game: 20, gameWin: 50 };
const COINS = { game: 5, gameWin: 20, daily: 25, levelUp: 50 };
const STORE = {
  green: { name: 'Classic green', price: 0 },
  royal: { name: 'Royal blue', price: 150 },
  maroon: { name: 'Maroon velvet', price: 150 },
  midnight: { name: 'Midnight', price: 300 },
  gold: { name: 'Gold room', price: 500, level: 5 },
};
// Total XP needed to reach a level: L1 = 0, L2 = 100, L3 = 300, L4 = 600 ...
const xpForLevel = L => 50 * L * (L - 1);
function levelOf(xp) { let L = 1; while (xpForLevel(L + 1) <= xp) L++; return L; }

const cache = new Map(); // uid -> profile
const tokenCache = new Map(); // token -> {user, at}

async function sb(path, opts = {}) {
  const r = await fetch(SB_URL + path, {
    ...opts,
    // New-style secret keys (sb_secret_...) go only in the apikey header; legacy service_role keys also go in Authorization
    headers: { apikey: SERVICE, ...(SERVICE.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SERVICE }), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

async function verify(token) {
  if (!enabled || !token) return null;
  const c = tokenCache.get(token);
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.user;
  const r = await fetch(SB_URL + '/auth/v1/user', { headers: { apikey: ANON, Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const u = await r.json();
  const md = u.user_metadata || {};
  const user = { id: u.id, name: String(md.full_name || md.name || (u.email || 'Player').split('@')[0]).slice(0, 14), avatar: md.avatar_url || md.picture || '' };
  tokenCache.set(token, { user, at: Date.now() });
  if (tokenCache.size > 5000) tokenCache.clear();
  return user;
}

function blank(user) {
  return { id: user.id, name: user.name, avatar: user.avatar || '', xp: 0, coins: 50, games: 0, wins: 0, hands: 0, hand_wins: 0,
    bids_made: 0, bids_total: 0, sweeps: 0, last_daily: null, owned: ['green'], equipped: { felt: 'green' } };
}
async function load(user) {
  if (cache.has(user.id)) return cache.get(user.id);
  let p = null;
  if (enabled) {
    const rows = await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*`);
    p = rows && rows[0];
    if (!p) {
      const created = await sb('/rest/v1/profiles', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(blank(user)) });
      p = created[0];
    }
  } else p = blank(user);
  if (!Array.isArray(p.owned)) p.owned = ['green'];
  if (!p.equipped || typeof p.equipped !== 'object') p.equipped = { felt: 'green' };
  if (user.avatar && p.avatar !== user.avatar) p.avatar = user.avatar;
  cache.set(user.id, p);
  return p;
}
const saveTimers = new Map();
function save(p) {
  if (!enabled) return;
  clearTimeout(saveTimers.get(p.id));
  saveTimers.set(p.id, setTimeout(() => {
    saveTimers.delete(p.id);
    const { id, ...fields } = p;
    sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(fields) }).catch(e => console.error('save profile', e.message));
  }, 800));
}

function today() { return new Date().toISOString().slice(0, 10); }
function claimDaily(p) {
  if (p.last_daily === today()) return 0;
  p.last_daily = today(); p.coins += COINS.daily; save(p); return COINS.daily;
}

// Apply gains; returns what changed so the player can see it
function award(p, xp, coins, stats = {}) {
  const before = levelOf(p.xp);
  p.xp += xp; p.coins += coins;
  for (const [k, v] of Object.entries(stats)) p[k] = (p[k] || 0) + v;
  const after = levelOf(p.xp);
  let bonus = 0;
  if (after > before) { bonus = COINS.levelUp * (after - before); p.coins += bonus; }
  save(p);
  return { xp, coins: coins + bonus, levelUp: after > before ? after : 0 };
}

function view(p) {
  if (!p) return null;
  const L = levelOf(p.xp), base = xpForLevel(L), next = xpForLevel(L + 1);
  return {
    name: p.name, avatar: p.avatar, level: L, xp: p.xp, levelXp: p.xp - base, levelNeed: next - base, coins: p.coins,
    games: p.games, wins: p.wins, hands: p.hands, handWins: p.hand_wins, bidsMade: p.bids_made, bidsTotal: p.bids_total, sweeps: p.sweeps,
    owned: p.owned, equipped: p.equipped,
    store: Object.entries(STORE).map(([id, it]) => ({ id, ...it, owned: p.owned.includes(id), locked: !!(it.level && L < it.level) })),
  };
}

function buy(p, item) {
  const it = STORE[item]; if (!it) return 'Not in the store';
  if (p.owned.includes(item)) return null;
  if (it.level && levelOf(p.xp) < it.level) return `Reach level ${it.level} to unlock this`;
  if (p.coins < it.price) return 'Not enough coins yet';
  p.coins -= it.price; p.owned = [...p.owned, item]; p.equipped = { ...p.equipped, felt: item }; save(p); return null;
}
function equip(p, item) {
  if (!p.owned.includes(item)) return 'Buy it first';
  p.equipped = { ...p.equipped, felt: item }; save(p); return null;
}

// Hand results -> XP per player
function handGains(info, seatIdx) {
  const team = seatIdx % 2, won = info.winner === team;
  let xp = XP.hand, coins = 0; const stats = { hands: 1 };
  if (won) { xp += XP.handWin; stats.hand_wins = 1; }
  if (info.bidSeat === seatIdx) { stats.bids_total = 1; if (won) { xp += XP.bidMade; stats.bids_made = 1; } }
  if (won && info.kind === 'sweep') { xp += XP.sweep; stats.sweeps = 1; }
  if (won && info.kind === 'whitewash') { xp += XP.whitewash; stats.sweeps = 1; }
  if (info.over) {
    xp += XP.game; coins += COINS.game; stats.games = 1;
    if (info.gameWinner === team) { xp += XP.gameWin; coins += COINS.gameWin; stats.wins = 1; }
  }
  return { xp, coins, stats };
}

module.exports = {
  enabled, DEV, config: () => ({ auth: enabled || DEV, supabaseUrl: enabled ? SB_URL : '', anonKey: enabled ? ANON : '', dev: DEV && !enabled }),
  verify, load, view, award, claimDaily, buy, equip, handGains, levelOf, STORE, XP, COINS,
};
