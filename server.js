// Patta Party online server: serves the game page and runs every table.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Table } = require('./game');
const A = require('./accounts');
const S = require('./stats');
const P = require('./play');
const R = require('./reports');
const F = require('./friends');
// Signed-in players who are online right now: profile id -> Map(socket id -> socket)
const online = new Map();
const goOnline = (id, socket) => { if (!online.has(id)) online.set(id, new Map()); online.get(id).set(socket.id, socket); };
const goOffline = (id, socket) => { const m = online.get(id); if (m) { m.delete(socket.id); if (!m.size) online.delete(id); } };
const emitTo = (id, ev, data) => { const m = online.get(id); if (m) for (const sk of m.values()) sk.emit(ev, data); };
const pidAuth = new Map(); // player id -> { profile } for signed-in players

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

// Always serve the newest version: the page is never cached, and scripts get a version tag that changes on every deploy
const fs = require('fs');
const VERSION = Date.now().toString(36);
const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  .replace('src="/app.js"', `src="/app.js?v=${VERSION}"`).replace('src="/tutorial.js"', `src="/tutorial.js?v=${VERSION}"`);
const sendIndex = (_req, res) => { res.set('Cache-Control', 'no-cache, no-store, must-revalidate'); res.type('html').send(indexHtml); };
app.get(['/', '/index.html'], sendIndex);
// Android App Links: lets www.pattaparty.com links open the Patta Party app. Fingerprints are public certificate hashes:
// the upload key, plus the Play app signing key (Play Console > Test and release > App integrity), or set APP_SHA256 on Render.
const APP_CERTS = ['2F:FE:EE:66:1B:60:B2:4D:79:FE:AA:91:2C:96:83:32:36:C4:38:B0:53:3F:ED:72:34:E8:92:33:F1:AF:7C:E6', // Play app signing key
  '4C:B7:89:8A:6A:CE:2E:50:F6:D9:16:82:6F:48:E8:99:37:F6:F2:34:A1:AD:07:A3:EF:DC:4D:48:26:BA:1A:F1', // upload key
  ...String(process.env.APP_SHA256 || '').split(',').map(s => s.trim().toUpperCase()).filter(s => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s))];
app.get('/.well-known/assetlinks.json', (_req, res) => res.json([{ relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: 'com.dhedhitech.pattaparty', sha256_cert_fingerprints: APP_CERTS } }]));
// Character picture with the team colour as background (table seats): /avatars/3-a.svg (orange) or /avatars/3-b.svg (blue)
const TEAM_BG = { a: '#F4A93A', b: '#6CC4D8' }, teamAvCache = {};
app.get(/^\/avatars\/(\d+)-(a|b)\.svg$/, (req, res) => {
  const key = req.params[0] + '-' + req.params[1];
  if (!teamAvCache[key]) {
    const file = path.join(__dirname, 'public', 'avatars', (+req.params[0]) + '.svg');
    if (!fs.existsSync(file)) return res.sendStatus(404);
    teamAvCache[key] = fs.readFileSync(file, 'utf8').replace(/(<rect width="120" height="120" fill=")#[0-9A-Fa-f]{6}"/, `$1${TEAM_BG[req.params[1]]}"`);
  }
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(teamAvCache[key]);
});
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'], index: false,
  setHeaders: (res, file) => { if (/\.(js|css)$/.test(file)) res.set('Cache-Control', 'no-cache'); },
}));
// Privacy policy and terms pages (CONTACT_EMAIL on Render sets the contact address shown)
const legalShell = fs.readFileSync(path.join(__dirname, 'legal', 'page.html'), 'utf8');
const contactHtml = () => { const e = (process.env.CONTACT_EMAIL || '').replace(/[<>"']/g, ''); return e ? `<a href="mailto:${e}">${e}</a>` : 'the support email shown on the Google sign-in screen'; };
for (const [route, file, title] of [['/privacy', 'privacy.html', 'Privacy Policy'], ['/terms', 'terms.html', 'Terms of Use']]) {
  const body = fs.readFileSync(path.join(__dirname, 'legal', file), 'utf8');
  app.get(route, (_req, res) => res.type('html').send(legalShell.replace('{{TITLE}}', title).replace('{{BODY}}', body.split('{{CONTACT}}').join(contactHtml()))));
}
// Uploaded profile pictures
app.get('/pic/:id', async (req, res) => {
  const d = await A.picData(String(req.params.id));
  if (!d) return res.status(404).end();
  const m = /^data:(image\/jpeg);base64,(.+)$/.exec(d); if (!m) return res.status(404).end();
  res.set('Cache-Control', req.query.v ? 'public, max-age=604800, immutable' : 'public, max-age=3600'); res.type(m[1]).send(Buffer.from(m[2], 'base64'));
});
app.get('/config', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.json(A.config()); });
app.get('/health', (_req, res) => res.json({ ok: true, tables: tables.size }));

const tables = new Map();

// Voice chat connection helpers. STUN works for most home wifi; a TURN server (set on Render as
// TURN_URL, TURN_USER, TURN_PASS) relays audio for mobile networks that block direct connections.
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (process.env.TURN_URL) ICE.push({ urls: process.env.TURN_URL.split(',').map(s => s.trim()), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });

// Cloudflare relay: set CF_TURN_KEY_ID and CF_TURN_API_TOKEN on Render. Short-lived logins are fetched and refreshed here.
let cfIce = null, cfAt = 0;
async function iceServers() {
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return ICE;
  if (cfIce && Date.now() - cfAt < 6 * 60 * 60 * 1000) return cfIce;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }),
    });
    if (!r.ok) throw new Error('Cloudflare TURN ' + r.status);
    const j = await r.json();
    const list = (j.iceServers ? [].concat(j.iceServers) : []).map(sv => ({ ...sv, urls: [].concat(sv.urls).filter(u => !/:53(\?|$)/.test(u)) })).filter(sv => sv.urls.length);
    if (!list.length) throw new Error('Cloudflare TURN: empty list');
    cfIce = [...ICE, ...list]; cfAt = Date.now();
    return cfIce;
  } catch (e) { console.error('TURN credentials failed:', e.message); return ICE; }
}
app.get('/voice-check', async (_req, res) => {
  const list = await iceServers();
  res.json({ relay: list.some(sv => [].concat(sv.urls).some(u => /^turns?:/.test(u))) });
});
const MAX_VOICE = 8;
// Sticker ids come from public/stickers/stickers.json (add a sticker there and its SVG file in the same folder)
const STK = require('./sticker-store');
STK.load();
app.get('/stickers/list', async (_req, res) => { await STK.load(); res.set('Cache-Control', 'no-cache'); res.json({ list: STK.list() }); });
app.get('/sticker-img/:id', (req, res) => {
  const img = STK.image(String(req.params.id)); if (!img) return res.status(404).end();
  // Pictures only: block any script inside an uploaded SVG
  res.set('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
  res.set('Cache-Control', 'public, max-age=604800, immutable'); res.type(img.type).send(img.buf);
});
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (tables.has(c));
  return c;
}
const cleanName = s => String(s || '').replace(/[<>{}&"'`]/g, '').trim().slice(0, 14) || 'Player';
const cleanPid = s => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);

// XP, coins and level badges for signed-in players
function tableInfo(t) {
  const humans = t.seats.filter(s => !s.bot && s.pid);
  return { code: t.code, n: t.n, joker: t.joker, lim: t.limit, humans: humans.length, signed: humans.filter(s => pidAuth.has(s.pid)).length };
}
// Guests: XP and coins they would have got are kept for a while, so signing in mid-game still saves this game's progress
const guestPending = new Map(); // pid -> { xp, coins, stats, at }
const GUEST_KEEP_MS = 3 * 3600 * 1000;
function guestGain(t, pid, g) {
  if (!(A.enabled || A.DEV)) return;
  const old = guestPending.get(pid), p = old && Date.now() - old.at < GUEST_KEEP_MS ? old : { xp: 0, coins: 0, stats: {} };
  p.xp += g.xp; p.coins += g.coins; p.at = Date.now();
  for (const [k, v] of Object.entries(g.stats)) p.stats[k] = (p.stats[k] || 0) + v;
  guestPending.set(pid, p);
  if (guestPending.size > 20000) guestPending.delete(guestPending.keys().next().value);
  for (const { socket, pid: cp } of t.clients.values()) if (cp === pid) socket.emit('guestGain', { xp: g.xp, coins: g.coins, totalXp: p.xp, totalCoins: p.coins });
}
function takeGuestGain(pid, profile) {
  const p = guestPending.get(pid); guestPending.delete(pid);
  if (!p || Date.now() - p.at > GUEST_KEEP_MS || !(p.xp || p.coins)) return null;
  return A.award(profile, p.xp, p.coins, p.stats);
}
// Beginners: guests, or signed in with fewer than 5 finished games. Classic only (Joker locked), longer turn timer, no auto-away
// Skill stage (A.skillOf): 0 beginner, 1 Classic done, 2 Joker done. You move up by winning a game with the tutorial off.
// Guests: the phone keeps it (rb-skill) and tells us on connect and when it changes.
const guestSkill = new Map();
// Guests (not signed in) have a profile too, kept on their phone's player id (A.loadGuest, guest_profiles)
const pidGuest = new Map();
const profOf = p => { const a = pidAuth.get(p); return a ? a.profile : pidGuest.get(p) || null; };
const skillOf = p => { const a = pidAuth.get(p); return a ? A.skillOf(a.profile) : Math.max(guestSkill.get(p) || 0, pidGuest.has(p) ? A.skillOf(pidGuest.get(p)) : 0); };
const isBeginner = p => skillOf(p) < 1;
function levelUp(t, info) {
  for (const s of info.seats) {
    if (!s.pid || info.gameWinner !== s.seat % 2 || t.coachUsed) continue;
    const want = t.joker ? 2 : 1, a = pidAuth.get(s.pid), cur = skillOf(s.pid);
    if (want <= cur) continue;
    if (a) A.setSkill(a.profile, want); else { guestSkill.set(s.pid, want); if (pidGuest.has(s.pid)) A.setSkill(pidGuest.get(s.pid), want); }
    for (const { socket, pid: cp } of t.clients.values()) if (cp === s.pid) socket.emit('skill', { skill: want, up: true });
  }
}
// First games: only write when a try gets further than any earlier try (started 0, bid 1, trump 2, card 3, hands 4, finished 5)
const FIRST_RANK = { started: 0, bid: 1, trump: 2, card: 3, hand: 4, finished: 5 };
const firstBest = new Map();
function firstStep(pid, rank, hands, patch) {
  const b = firstBest.get(pid) || { rank: 0, hands: 0 };
  if (rank < b.rank || (rank === b.rank && hands <= b.hands && rank >= 4)) { S.firstGame(pid, { left_early: false }); return; }
  firstBest.set(pid, { rank, hands });
  S.firstGame(pid, { ...patch, left_early: false });
}
function wireProgress(t) {
  t.isBeginner = isBeginner;
  t.onGameStart = () => S.logGame({ kind: 'start', ...tableInfo(t) });
  t.levelOf = p => { const pr = profOf(p); return pr ? A.levelOf(pr.xp) : null; };
  t.avOf = p => { const pr = profOf(p); return pr ? A.avOf(pr) : null; };
  t.idOf = p => { const a = pidAuth.get(p); return a ? a.profile.id : null; };
  t.onHandEnd = info => {
    if (info.over) S.logGame({ kind: 'finish', ...tableInfo(t), hands: t.G.handNo });
    if (info.over) try { levelUp(t, info); } catch (e) { console.error('skill', e); }
    if (t.first && !t.first.done) {
      const F = t.first, p = t.players.get(F.pid), seat = p && p.seat;
      F.rank = Math.max(F.rank, 4);
      const patch = { step: info.over ? 'finished' : 'hand', hands: t.G.handNo, tutorial: !!t.coachUsed };
      if (info.over) { F.done = true; patch.finished = true; patch.won = seat != null ? info.gameWinner === seat % 2 : null; }
      firstStep(F.pid, info.over ? 5 : 4, t.G.handNo, patch);
    }
    for (const s of info.seats) {
      if (!s.pid) continue;
      const a = pidAuth.get(s.pid);
      if (!a) {
        const gp = pidGuest.get(s.pid);
        if (!gp) { guestGain(t, s.pid, A.handGains(info, s.seat)); continue; }
        const g = A.handGains(info, s.seat), gain = A.award(gp, g.xp, g.coins, g.stats);
        for (const { socket, pid: cp } of t.clients.values()) if (cp === s.pid) socket.emit('profile', { profile: A.view(gp), gain });
        continue;
      }
      const g = A.handGains(info, s.seat);
      const gain = A.award(a.profile, g.xp, g.coins, g.stats);
      for (const { socket, pid: cp } of t.clients.values()) if (cp === s.pid) socket.emit('profile', { profile: A.view(a.profile), gain });
    }
  };
}

io.on('connection', socket => {
  let pid = cleanPid(socket.handshake.auth && socket.handshake.auth.pid);
  let name = cleanName(socket.handshake.auth && socket.handshake.auth.name);
  let table = null;
  if (!pid) { socket.emit('fatal', 'Missing player id'); socket.disconnect(true); return; }
  S.playerSeen(pid, false, name);
  socket.data.app = !!(socket.handshake.auth && socket.handshake.auth.app); // opened in the Android app
  { const k = +(socket.handshake.auth && socket.handshake.auth.skill); if (k >= 0 && k <= 2) guestSkill.set(pid, Math.max(guestSkill.get(pid) || 0, k)); }
  // The phone moved up (guest progress, or merging a guest's progress into a new sign-in)
  socket.on('skill', (k, cb) => {
    k = +k; if (!(k >= 0 && k <= 2)) return reply(cb, 'bad');
    const a = pidAuth.get(pid); if (a) A.setSkill(a.profile, k); else guestSkill.set(pid, Math.max(guestSkill.get(pid) || 0, k));
    reply(cb, null, { skill: skillOf(pid) });
  });
  if (socket.data.app) S.appSeen(pid, null);

  const reply = (cb, err, data) => { if (typeof cb === 'function') cb(err ? { error: err } : { ok: true, ...data }); };
  const leave = () => { socket.data.tableCode = null; if (table) { if (table.first && table.first.pid === pid && !table.first.done) S.firstGame(pid, { left_early: true }); table.removeClient(socket.id); socket.leave(table.code); table = null; } };
  // removeClient also drops this socket from voice chat and tells the others

  socket.on('create', (opts, cb) => {
    const n = [4, 6, 8].includes(opts && opts.n) ? opts.n : 4;
    if (tables.size > 500) return reply(cb, 'Server is busy. Try again in a minute.');
    const code = newCode();
    const guided = !!(opts && opts.guided);
    const t = new Table(code, { n, joker: !!(opts && opts.joker) && (skillOf(pid) >= 2 || (skillOf(pid) >= 1 && !(opts && opts.pub))), hostId: pid, limit: opts && Number(opts.limit), pub: !!(opts && opts.pub) && !guided, swap: !!(opts && opts.swap) && !guided, region: opts && ['pk', 'in', 'bd'].includes(opts.region) ? opts.region : 'pk' }, io);
    t.guided = guided;
    t.beginnerTable = isBeginner(pid); // made by a beginner: only these show in a beginner's Open tables list
    // A new player's very first game: record how far they get (admin "First games")
    if (opts && opts.first) {
      t.first = { pid, rank: 0 };
      const tries = Math.max(1, Math.min(99, +opts.first || 1));
      const base = { name: String(name || '').slice(0, 20), uid: ((pidAuth.get(pid) || {}).profile || {}).id || null, app: !!socket.data.app, code, tries, lim: t.limit || 0, tutorial: guided, left_early: false };
      // A new try keeps the furthest point any earlier try reached (and the first start time)
      if (tries > 1 && !firstBest.has(pid)) S.firstGet(pid).then(r => { if (r && !firstBest.has(pid)) firstBest.set(pid, { rank: FIRST_RANK[r.step] || 0, hands: r.hands || 0 }); });
      if (tries === 1) { firstBest.set(pid, { rank: 0, hands: 0 }); S.firstGame(pid, { ...base, started_at: new Date().toISOString(), step: 'started', hands: 0, finished: false, won: null }); }
      else S.firstGame(pid, base);
    }
    wireProgress(t);
    tables.set(code, t);
    leave(); table = t; socket.data.tableCode = t.code; t.addClient(socket, pid, name);
    t.sit(pid, 0);
    reply(cb, null, { code });
  });

  socket.on('join', (code, cb, opts) => {
    if (typeof cb !== 'function' && typeof opts === 'function') [cb, opts] = [opts, cb];
    const t = tables.get(String(code || '').toUpperCase());
    if (!t) return reply(cb, 'This table has closed. Ask your friend for a new link, or create your own table.');
    leave(); table = t; socket.data.tableCode = t.code;
    // Already seated here from another phone or app? Same Google account: move the seat here. Same name: ask first.
    const acct = pidAuth.get(pid);
    const sameAcct = acct ? t.seats.findIndex(s => !s.bot && s.pid && s.pid !== pid && pidAuth.has(s.pid) && pidAuth.get(s.pid).profile.id === acct.profile.id) : -1;
    const lname = String(name).trim().toLowerCase();
    const sameName = t.seats.some(s => !s.bot && s.pid && s.pid !== pid && String(s.name).trim().toLowerCase() === lname) && !(t.players.get(pid) && t.players.get(pid).seat != null);
    // Beginners never just watch: they take the first empty seat (lobby or mid-game)
    const newbieSeat = isBeginner(pid) && sameAcct < 0 && !sameName;
    t.addClient(socket, pid, name, { noAutoSeat: sameAcct >= 0 || sameName || (!!(opts && opts.watch) && !newbieSeat) });
    if (sameAcct >= 0) t.takeOver(pid, sameAcct);
    // From Open tables during a game: take a free bot seat straight away
    if (((opts && opts.seat === 'auto') || newbieSeat) && t.phase === 'game') {
      const p = t.players.get(pid);
      if (p && p.seat == null) {
        const free = p.lastSeat != null && t.seats[p.lastSeat].bot ? p.lastSeat : t.seats.findIndex(s => s.bot);
        if (free >= 0) t.sit(pid, free);
      }
    }
    reply(cb, null, { code: t.code });
  });
  // Open tables for the home screen: public tables with a free seat and real people still there
  socket.on('rooms', cb => {
    const list = [], newbie = isBeginner(pid);
    for (const t of tables.values()) {
      const mine = t.players.has(pid);
      if (mine && t.phase !== 'over') {
        const host = t.players.get(t.hostId);
        list.push({ code: t.code, host: host ? host.name : 'Player', n: t.n, joker: t.joker, limit: t.limit, free: t.seats.filter(s => s.bot).length,
          humans: t.seats.filter(s => !s.bot).length, playing: t.phase === 'game', hand: t.G ? t.G.handNo : 0, mine: true });
        continue;
      }
      if (!t.pub || t.phase === 'over' || !t.humansConnected()) continue;
      if (newbie && !t.beginnerTable) continue; // beginners only see beginner tables
      const free = t.seats.filter(s => s.bot).length;
      const host = t.players.get(t.hostId);
      const hs = t.seats.filter(s => !s.bot && s.pid);
      const lv = hs.map(s => { const a = pidAuth.get(s.pid); return a ? A.levelOf(a.profile.xp) : 1; });
      list.push({ code: t.code, host: host ? host.name : 'Player', n: t.n, joker: t.joker, limit: t.limit, free,
        beginners: !!t.beginnerTable, lvl: lv.length ? Math.max(...lv) : 1,
        names: t.seats.filter(s => !s.bot && s.pid !== t.hostId).map(s => s.name).slice(0, 3),
        humans: t.seats.filter(s => !s.bot).length, playing: t.phase === 'game', hand: t.G ? t.G.handNo : 0, mine: false });
    }
    list.sort((a, b) => (b.mine - a.mine) || (a.playing - b.playing) || (b.humans - a.humans));
    reply(cb, null, { list: list.slice(0, 20) });
  });

  socket.on('rename', (nm, cb) => {
    name = cleanName(nm);
    S.playerSeen(pid, !!socket.data.uid, name, socket.data.uid);
    if (table) { const p = table.players.get(pid); if (p) { p.name = name; if (p.seat != null && !table.seats[p.seat].bot) table.seats[p.seat].name = name; } table.broadcast(); }
    reply(cb);
  });
  socket.on('claim', cb => {
    if (!table) return reply(cb, 'Not at a table');
    const k = table.sameNameSeat(pid); if (k < 0) return reply(cb, 'That seat is not free to take over');
    reply(cb, table.takeOver(pid, k));
  });
  socket.on('sit', (realSeat, cb) => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.sit(pid, realSeat)); });
  socket.on('away', (on, cb) => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.setAway(pid, !!on)); });
  socket.on('hidden', hidden => { if (table) table.appHidden(pid, !!hidden); });
  socket.on('wait', (on, cb) => { if (!table) return reply(cb, 'Not at a table'); reply(cb, on ? table.joinWait(pid) : table.leaveWait(pid)); });
  socket.on('stand', cb => { if (table) table.stand(pid); reply(cb); });
  socket.on('start', cb => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.start(pid)); });
  socket.on('act', (msg, cb) => {
    if (!table || !msg) return reply(cb, 'Not at a table');
    let val = msg.value;
    if (msg.kind === 'bid') val = val === null || val === 0 ? null : Number(val);
    if (msg.kind === 'play') val = Number(val);
    if (msg.kind === 'trump') val = String(val);
    const err = table.act(pid, msg.kind, val);
    reply(cb, err);
    const F = table.first;
    if (!err && F && F.pid === pid) { const rank = { bid: 1, trump: 2, play: 3 }[msg.kind] || 0; if (rank > F.rank) { F.rank = rank; firstStep(pid, rank, 0, { step: ['started', 'bid', 'trump', 'card'][rank] }); } }
  });
  socket.on('coach', (msg, cb) => { if (table) table.coach(pid, msg); reply(cb); });
  socket.on('hint', cb => { const h = table && table.hint(pid); reply(cb, h ? null : 'No hint', h || {}); });
  socket.on('setLimit', (lim, cb) => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.setLimit(pid, Number(lim))); });
  socket.on('next', cb => { if (table) table.dealNow(pid); reply(cb); });
  socket.on('again', cb => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.playAgain(pid)); });
  // Leave on purpose: free the seat and forget this table, so it no longer shows as "Your game"
  socket.on('leaveTable', cb => { const t = table; if (t) t.stand(pid); leave(); if (t) t.forget(pid); reply(cb); });
  // ---- accounts ----
  const signedIn = async (user, cb) => {
    const profile = await A.load(user);
    if (socket.data.uid && socket.data.uid !== profile.id) goOffline(socket.data.uid, socket);
    pidAuth.set(pid, { profile });
    socket.data.uid = profile.id; goOnline(profile.id, socket);
    F.links(profile.id).then(l => socket.emit('friend:count', [...l.values()].filter(x => x.status === 'pending' && !x.mine).length)).catch(() => {});
    S.playerSeen(pid, true, name, profile.id);
    if (socket.data.app) S.appSeen(pid, profile.id);
    const daily = A.claimDaily(profile);
    let saved = takeGuestGain(pid, profile);
    // Everything earned as a guest on this phone moves into the account
    { let gp = pidGuest.get(pid); if (!gp && A.enabled) { try { gp = await A.loadGuest(pid, name, false); } catch (e) { gp = null; } }
      if (gp && (gp.xp || gp.games || (gp.owned || []).length > 1 || gp.coins > 50)) { const m = A.mergeGuest(profile, gp); if (m) saved = { xp: (saved ? saved.xp : 0) + m.xp, coins: (saved ? saved.coins : 0) + m.coins }; }
      pidGuest.delete(pid); }
    if (table) table.broadcast();
    reply(cb, null, { profile: A.view(profile), daily });
    if (saved) socket.emit('profile', { profile: A.view(profile), gain: saved, saved: true });
  };
  socket.on('auth', async (token, cb) => {
    try { const user = await A.verify(String(token || '')); if (!user) return reply(cb, 'Sign-in expired. Please sign in again.'); await signedIn(user, cb); }
    catch (e) { console.error('auth', e.message); reply(cb, 'Could not load your profile. Try again in a minute.'); }
  });
  socket.on('devLogin', async (nm, cb) => {
    if (!A.DEV || A.enabled) return reply(cb, 'Not available');
    await signedIn({ id: 'dev-' + pid, name: cleanName(nm), avatar: '' }, cb);
  });
  // Not signed in: load (or make) this phone's guest profile
  socket.on('guest', async cb => {
    if (pidAuth.has(pid)) return reply(cb, 'Signed in');
    try {
      const g = await A.loadGuest(pid, name); pidGuest.set(pid, g);
      if (name && name !== 'Player' && g.name !== name) { g.name = name.slice(0, 14); A.save && A.save(g); }
      if (guestSkill.get(pid)) A.setSkill(g, guestSkill.get(pid)); // stage the phone already reached
      const daily = g._unsaved ? 0 : A.claimDaily(g); // daily coins once they have played
      if (table) table.broadcast();
      reply(cb, null, { profile: A.view(g), daily });
    } catch (e) { console.error('guest', e.message); reply(cb, 'Could not load your progress'); }
  });
  socket.on('signout', cb => { if (socket.data.uid) { goOffline(socket.data.uid, socket); socket.data.uid = null; } pidAuth.delete(pid); if (table) table.broadcast(); reply(cb); });
  socket.on('deleteAccount', async cb => {
    const id = socket.data.uid; if (!id) return reply(cb, 'Not signed in');
    const err = await A.deleteAccount(id); if (err) return reply(cb, err);
    const m = online.get(id); if (m) for (const sk of m.values()) sk.data.uid = null;
    online.delete(id);
    for (const [k, v] of pidAuth) if (v.profile && v.profile.id === id) pidAuth.delete(k);
    if (table) table.broadcast();
    reply(cb);
  });
  socket.on('buy', (item, cb) => {
    const pr = profOf(pid); if (!pr) return reply(cb, 'Please wait a moment and try again'); const a = { profile: pr };
    const err = A.buy(a.profile, String(item)); reply(cb, err, { profile: A.view(a.profile) });
  });
  socket.on('setPic', async (val, cb) => {
    const pr = profOf(pid); if (!pr) return reply(cb, 'Please wait a moment and try again'); const a = { profile: pr };
    const now = Date.now(); if (socket.data.lastPic && now - socket.data.lastPic < 1500) return reply(cb, 'Slow down a little'); socket.data.lastPic = now;
    const err = await A.setPic(a.profile, val);
    if (!err && table) table.broadcast();
    reply(cb, err, { profile: A.view(a.profile) });
  });
  socket.on('leaderboard', async (sort, cb) => {
    const now = Date.now(); if (socket.data.lastLb && now - socket.data.lastLb < 800) return reply(cb, 'Slow down a little'); socket.data.lastLb = now;
    if (!A.enabled && !A.DEV) return reply(cb, null, { list: [], mine: null, off: true });
    try { const a = pidAuth.get(pid); reply(cb, null, await A.leaderboard(String(sort), a ? a.profile : null)); }
    catch (e) { console.error('leaderboard', e.message); reply(cb, 'Leaderboard is not available right now'); }
  });
  // ---- friends ----
  const meId = () => { const a = pidAuth.get(pid); return a ? a.profile.id : null; };
  const friendErr = (e, cb) => { console.error('friends', e.message); reply(cb, 'Friends are not available right now. Try again later.'); };
  socket.on('friend:add', async (id, cb) => {
    const me = meId(); if (!me) return reply(cb, 'Sign in to add friends');
    try {
      const r = await F.add(me, String(id)); if (r.error) return reply(cb, r.error);
      const myName = pidAuth.get(pid).profile.name;
      if (r.requested) emitTo(String(id), 'friend:notify', { kind: 'request', name: myName });
      if (r.accepted) emitTo(String(id), 'friend:notify', { kind: 'accepted', name: myName });
      reply(cb, null, { status: r.status });
    } catch (e) { friendErr(e, cb); }
  });
  socket.on('friend:accept', async (id, cb) => {
    const me = meId(); if (!me) return reply(cb, 'Sign in first');
    try { const r = await F.accept(me, String(id)); if (r.error) return reply(cb, r.error); emitTo(String(id), 'friend:notify', { kind: 'accepted', name: pidAuth.get(pid).profile.name }); reply(cb, null, { status: r.status }); }
    catch (e) { friendErr(e, cb); }
  });
  socket.on('friend:remove', async (id, cb) => {
    const me = meId(); if (!me) return reply(cb, 'Sign in first');
    try { await F.remove(me, String(id)); reply(cb, null, { status: 'none' }); } catch (e) { friendErr(e, cb); }
  });
  socket.on('friends', async cb => {
    const me = meId(); if (!me) return reply(cb, 'Sign in to see your friends');
    try {
      const l = await F.links(me), ids = [...l.keys()];
      const ppl = await A.people(ids);
      const list = ppl.map(p => {
        const lk = l.get(p.id), on = online.get(p.id);
        let at = null; if (on) for (const sk of on.values()) if (sk.data.tableCode) at = sk.data.tableCode;
        return { ...p, status: lk.status === 'accepted' ? 'friend' : lk.mine ? 'sent' : 'incoming', online: !!on, here: !!(table && at === table.code) };
      });
      list.sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
      reply(cb, null, { list });
    } catch (e) { friendErr(e, cb); }
  });
  socket.on('invite', async (ids, cb) => {
    const me = meId(); if (!me) return reply(cb, 'Sign in to invite friends');
    if (!table) return reply(cb, 'Open a table first');
    const now = Date.now(); if (socket.data.lastInvite && now - socket.data.lastInvite < 3000) return reply(cb, 'Slow down a little'); socket.data.lastInvite = now;
    try {
      const l = await F.links(me);
      const targets = (Array.isArray(ids) ? ids.map(String) : [...l.keys()]).filter(id => l.get(id) && l.get(id).status === 'accepted' && online.has(id)).slice(0, 50);
      const from = pidAuth.get(pid).profile;
      for (const id of targets) emitTo(id, 'invite', { from: from.name, av: A.avOf(from), code: table.code, n: table.n, joker: table.joker, playing: table.phase === 'game' });
      reply(cb, null, { sent: targets.length });
    } catch (e) { friendErr(e, cb); }
  });
  // Player card: tap a seat to see that player's profile
  socket.on('card', async (realSeat, cb) => {
    if (!table) return reply(cb, 'Not at a table');
    const s = table.seats[Number(realSeat)]; if (!s) return reply(cb, 'No such seat');
    if (s.bot) return reply(cb, null, { card: { name: s.name, bot: true } });
    const a = s.pid && pidAuth.get(s.pid);
    if (!a) return reply(cb, null, { card: { name: s.name, guest: true } });
    const v = A.view(a.profile), mine = pidAuth.get(pid);
    let friend = null;
    if (mine && mine.profile.id !== a.profile.id) { try { friend = await F.status(mine.profile.id, a.profile.id); } catch (e) { friend = null; } }
    reply(cb, null, { card: { fid: a.profile.id, friend, me: !!(mine && mine.profile.id === a.profile.id), name: s.name, fullName: v.name, av: v.av, level: v.level, games: v.games, wins: v.wins, hands: v.hands, handWins: v.handWins, bidsMade: v.bidsMade, bidsTotal: v.bidsTotal, sweeps: v.sweeps, since: a.profile.created_at || null } });
  });
  // Report a player from their player card. Saved with their last chat lines at this table for the admin page.
  socket.on('report', async (msg, cb) => {
    if (!table || !msg) return reply(cb, 'Not at a table');
    const s = table.seats[Number(msg.real)], reason = String(msg.reason || '');
    if (!s || s.bot || !s.pid || s.pid === pid) return reply(cb, 'You can only report other players');
    if (!R.REASONS.includes(reason)) return reply(cb, 'Pick a reason');
    const done = socket.data.reported || (socket.data.reported = new Set()), key = table.code + ':' + s.pid;
    if (done.has(key)) return reply(cb, null, { already: true });
    if (done.size >= 10) return reply(cb, 'Too many reports. Try again later.');
    done.add(key);
    const me = table.players.get(pid), myAuth = pidAuth.get(pid), theirAuth = pidAuth.get(s.pid);
    const chat = table.chatLog.filter(m => m.pid === s.pid).slice(-20).map(m => ({ t: m.text, at: m.ts }));
    try {
      await R.add({ table_code: table.code, reason, reporter_name: me ? me.name : name, reporter_pid: pid, reporter_uid: myAuth ? myAuth.profile.id : null,
        reported_name: s.name, reported_pid: s.pid, reported_uid: theirAuth ? theirAuth.profile.id : null, chat });
      reply(cb);
    } catch (e) { console.error('report', e.message); done.delete(key); reply(cb, 'Could not send the report. Try again in a minute.'); }
  });
  socket.on('equip', (item, cb) => {
    const pr = profOf(pid); if (!pr) return reply(cb, 'Please wait a moment and try again'); const a = { profile: pr };
    const err = A.equip(a.profile, String(item)); reply(cb, err, { profile: A.view(a.profile) });
  });

  socket.on('chat', (text, cb) => {
    if (!table) return reply(cb, 'Not at a table');
    const now = Date.now(); if (socket.data.lastChat && now - socket.data.lastChat < 700) return reply(cb, 'Slow down a little');
    socket.data.lastChat = now;
    reply(cb, table.chat(pid, text));
  });
  socket.on('chatHistory', cb => { reply(cb, null, { list: table ? table.chatHistory(pid) : [] }); });
  socket.on('sticker', (id, cb) => {
    if (!table || !STK.has(String(id))) return reply(cb);
    const now = Date.now(); if (socket.data.lastReact && now - socket.data.lastReact < 1500) return reply(cb, 'Slow down a little');
    socket.data.lastReact = now;
    const p = table.players.get(pid); if (p && p.seat != null) table.fx('sticker', { seat: p.seat, id: String(id) });
    reply(cb);
  });
  socket.on('react', (emo, cb) => {
    const allowed = ['👏', '😂', '😮', '🔥', '😢', '🙏'];
    if (!table || !allowed.includes(emo)) return reply(cb);
    const now = Date.now(); if (socket.data.lastReact && now - socket.data.lastReact < 1200) return reply(cb);
    socket.data.lastReact = now;
    const p = table.players.get(pid); if (p && p.seat != null) table.fx('react', { seat: p.seat, emo });
    reply(cb);
  });
  // ---- voice chat: the server only passes connection messages between players' phones ----
  const voiceLeave = () => {
    if (table && table.voice.delete(socket.id)) { io.to(table.code).emit('voice:left', socket.id); table.broadcast(); }
  };
  socket.on('voice:join', async cb => {
    if (!table) return reply(cb, 'Not at a table');
    if (!table.voice.has(socket.id) && table.voice.size >= MAX_VOICE) return reply(cb, 'Voice chat is full (8 people).');
    const peers = [...table.voice.keys()].filter(id => id !== socket.id);
    table.voice.set(socket.id, { pid, muted: false });
    table.broadcast();
    reply(cb, null, { peers, ice: await iceServers(), me: socket.id });
  });
  socket.on('voice:leave', cb => { voiceLeave(); reply(cb); });
  socket.on('voice:mute', (m, cb) => {
    if (table && table.voice.has(socket.id)) { table.voice.get(socket.id).muted = !!m; table.broadcast(); }
    reply(cb);
  });
  socket.on('voice:talk', on => {
    if (!table || !table.voice.has(socket.id)) return;
    const now = Date.now(); if (socket.data.lastTalk && now - socket.data.lastTalk < 150) return; socket.data.lastTalk = now;
    socket.to(table.code).emit('voice:talk', { sid: socket.id, on: !!on });
  });
  socket.on('voice:signal', msg => {
    if (!table || !msg || typeof msg.to !== 'string') return;
    if (!table.voice.has(socket.id) || !table.voice.has(msg.to)) return;
    const s = JSON.stringify(msg.data || null); if (s.length > 20000) return;
    io.to(msg.to).emit('voice:signal', { from: socket.id, data: msg.data });
  });

  socket.on('disconnect', () => { if (socket.data.uid) goOffline(socket.data.uid, socket); leave(); });
});

// ---- private admin page: set ADMIN_PASS on Render, then open /admin ----
const adminHtml = fs.readFileSync(path.join(__dirname, 'admin', 'admin.html'), 'utf8');
const adminFails = new Map(); // ip -> { n, at }
function adminOk(req) {
  const pass = process.env.ADMIN_PASS || '';
  const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.ip;
  const f = adminFails.get(ip);
  if (f && f.n >= 8 && Date.now() - f.at < 15 * 60 * 1000) return 'locked';
  const given = String(req.headers['x-admin-key'] || '');
  const crypto = require('crypto');
  const ok = pass.length >= 6 && given.length === pass.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pass));
  if (!ok) { adminFails.set(ip, { n: (f && Date.now() - f.at < 15 * 60 * 1000 ? f.n : 0) + 1, at: Date.now() }); if (adminFails.size > 1000) adminFails.clear(); return 'bad'; }
  adminFails.delete(ip); return 'ok';
}
app.get('/admin', (_req, res) => { res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex'); res.type('html').send(adminHtml); });
app.get('/admin/data', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!process.env.ADMIN_PASS) return res.status(503).json({ error: 'Admin page is not set up yet. Add ADMIN_PASS on Render.' });
  const ok = adminOk(req);
  if (ok === 'locked') return res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes.' });
  if (ok !== 'ok') return res.status(401).json({ error: 'Wrong password' });
  let inApp = 0; for (const s of io.of('/').sockets.values()) if (s.data.app) inApp++;
  const live = { inApp, online: io.engine.clientsCount, tables: tables.size, playing: 0, waiting: 0, people: 0, modes: { 4: 0, 6: 0, 8: 0, joker: 0 } };
  for (const t of tables.values()) {
    const humans = t.seats.filter(s => !s.bot && s.pid).length;
    if (t.phase === 'game') { live.playing++; live.people += humans; live.modes[t.n]++; if (t.joker) live.modes.joker++; } else if (t.phase === 'lobby') {
      live.waiting++;
      // Who is behind each waiting table (admin wanted to know why tables sit unstarted)
      const host = t.players.get(t.hostId), now = Date.now();
      (live.waitList = live.waitList || []).push({ host: host ? host.name : '?', hostOnline: !!(host && host.connected), inApp: !!(host && [...t.clients.values()].some(c => c.pid === t.hostId && c.socket.data.app)),
        n: t.n, joker: t.joker, pub: t.pub, beginner: !!t.beginnerTable, seated: humans, online: [...t.players.values()].filter(p => p.connected).length,
        ageMin: Math.round((now - (t.createdAt || now)) / 60000), idleMin: Math.round((now - t.lastActive) / 60000) });
    }
  }
  const play = await Promise.race([P.report(), new Promise(r => setTimeout(() => r({ loading: true }), 8000))]).catch(e => ({ error: e.message }));
  try { res.json({ live, play, ...(await S.report()), today: S.dayOf() }); }
  catch (e) { console.error('admin report', e.message); res.json({ live, daily: [], top: [], accounts: 0, today: S.dayOf(), error: 'Saved stats could not load. Did you run supabase-stats.sql in Supabase?' }); }
});

// Stickers on the admin page: list, upload, remove
const adminGate = (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!process.env.ADMIN_PASS) { res.status(503).json({ error: 'Admin page is not set up yet. Add ADMIN_PASS on Render.' }); return false; }
  const ok = adminOk(req);
  if (ok === 'locked') { res.status(429).json({ error: 'Too many wrong tries. Wait 15 minutes.' }); return false; }
  if (ok !== 'ok') { res.status(401).json({ error: 'Wrong password' }); return false; }
  return true;
};
app.get('/admin/stickers', async (req, res) => { if (!adminGate(req, res)) return; await STK.load(); res.json({ list: STK.list() }); });
app.post('/admin/stickers', express.json({ limit: '500kb' }), async (req, res) => {
  if (!adminGate(req, res)) return;
  try { const r = await STK.add(req.body && req.body.line, req.body && req.body.data); if (r.error) return res.status(400).json(r); res.json({ ok: true, ...r }); }
  catch (e) { console.error('sticker add', e.message); res.status(500).json({ error: 'Could not save. Did you run supabase-stickers.sql in Supabase?' }); }
});
app.delete('/admin/stickers/:id', async (req, res) => {
  if (!adminGate(req, res)) return;
  try { const r = await STK.remove(String(req.params.id)); if (r.error) return res.status(400).json(r); res.json({ ok: true }); }
  catch (e) { console.error('sticker remove', e.message); res.status(500).json({ error: 'Could not remove the sticker' }); }
});

app.get('/admin/reports', async (req, res) => {
  if (!adminGate(req, res)) return;
  try { res.json({ list: await R.list() }); }
  catch (e) { console.error('reports', e.message); res.json({ list: [], error: 'Reports could not load. Did you run supabase-reports.sql in Supabase?' }); }
});

// Close tables nobody has used for a while
setInterval(() => {
  const now = Date.now();
  for (const [code, t] of tables) {
    const idle = now - t.lastActive;
    if ((!t.humansConnected() && idle > 10 * 60 * 1000) || idle > 3 * 60 * 60 * 1000) { t.destroy(); tables.delete(code); }
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Patta Party running on port ' + PORT));
