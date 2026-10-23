// Patta Party online server: serves the game page and runs every table.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Table } = require('./game');
const A = require('./accounts');
const S = require('./stats');
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
function wireProgress(t) {
  t.onGameStart = () => S.logGame({ kind: 'start', ...tableInfo(t) });
  t.levelOf = p => { const a = pidAuth.get(p); return a ? A.levelOf(a.profile.xp) : null; };
  t.avOf = p => { const a = pidAuth.get(p); return a ? A.avOf(a.profile) : null; };
  t.onHandEnd = info => {
    if (info.over) S.logGame({ kind: 'finish', ...tableInfo(t), hands: t.G.handNo });
    for (const s of info.seats) {
      if (!s.pid) continue;
      const a = pidAuth.get(s.pid); if (!a) continue;
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
  S.playerSeen(pid, false);

  const reply = (cb, err, data) => { if (typeof cb === 'function') cb(err ? { error: err } : { ok: true, ...data }); };
  const leave = () => { socket.data.tableCode = null; if (table) { table.removeClient(socket.id); socket.leave(table.code); table = null; } };
  // removeClient also drops this socket from voice chat and tells the others

  socket.on('create', (opts, cb) => {
    const n = [4, 6, 8].includes(opts && opts.n) ? opts.n : 4;
    if (tables.size > 500) return reply(cb, 'Server is busy. Try again in a minute.');
    const code = newCode();
    const t = new Table(code, { n, joker: !!(opts && opts.joker), hostId: pid, limit: opts && Number(opts.limit), pub: !!(opts && opts.pub) }, io);
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
    t.addClient(socket, pid, name, { noAutoSeat: sameAcct >= 0 || sameName });
    if (sameAcct >= 0) t.takeOver(pid, sameAcct);
    // From Open tables during a game: take a free bot seat straight away
    if (opts && opts.seat === 'auto' && t.phase === 'game') {
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
    const list = [];
    for (const t of tables.values()) {
      const mine = t.players.has(pid);
      if (mine && t.phase !== 'over') {
        const host = t.players.get(t.hostId);
        list.push({ code: t.code, host: host ? host.name : 'Player', n: t.n, joker: t.joker, limit: t.limit, free: t.seats.filter(s => s.bot).length,
          humans: t.seats.filter(s => !s.bot).length, playing: t.phase === 'game', hand: t.G ? t.G.handNo : 0, mine: true });
        continue;
      }
      if (!t.pub || t.phase === 'over' || !t.humansConnected()) continue;
      const free = t.seats.filter(s => s.bot).length; if (!free) continue;
      const host = t.players.get(t.hostId);
      list.push({ code: t.code, host: host ? host.name : 'Player', n: t.n, joker: t.joker, limit: t.limit, free,
        names: t.seats.filter(s => !s.bot && s.pid !== t.hostId).map(s => s.name).slice(0, 3),
        humans: t.seats.filter(s => !s.bot).length, playing: t.phase === 'game', hand: t.G ? t.G.handNo : 0, mine: false });
    }
    list.sort((a, b) => (b.mine - a.mine) || (a.playing - b.playing) || (b.humans - a.humans));
    reply(cb, null, { list: list.slice(0, 20) });
  });

  socket.on('rename', (nm, cb) => {
    name = cleanName(nm);
    if (table) { const p = table.players.get(pid); if (p) { p.name = name; if (p.seat != null && !table.seats[p.seat].bot) table.seats[p.seat].name = name; } table.broadcast(); }
    reply(cb);
  });
  socket.on('claim', cb => {
    if (!table) return reply(cb, 'Not at a table');
    const k = table.sameNameSeat(pid); if (k < 0) return reply(cb, 'That seat is not free to take over');
    reply(cb, table.takeOver(pid, k));
  });
  socket.on('sit', (realSeat, cb) => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.sit(pid, realSeat)); });
  socket.on('stand', cb => { if (table) table.stand(pid); reply(cb); });
  socket.on('start', cb => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.start(pid)); });
  socket.on('act', (msg, cb) => {
    if (!table || !msg) return reply(cb, 'Not at a table');
    let val = msg.value;
    if (msg.kind === 'bid') val = val === null || val === 0 ? null : Number(val);
    if (msg.kind === 'play') val = Number(val);
    if (msg.kind === 'trump') val = String(val);
    reply(cb, table.act(pid, msg.kind, val));
  });
  socket.on('setLimit', (lim, cb) => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.setLimit(pid, Number(lim))); });
  socket.on('next', cb => { if (table) table.dealNow(pid); reply(cb); });
  socket.on('again', cb => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.playAgain(pid)); });
  socket.on('leaveTable', cb => { if (table) table.stand(pid); leave(); reply(cb); });
  // ---- accounts ----
  const signedIn = async (user, cb) => {
    const profile = await A.load(user);
    if (socket.data.uid && socket.data.uid !== profile.id) goOffline(socket.data.uid, socket);
    pidAuth.set(pid, { profile });
    socket.data.uid = profile.id; goOnline(profile.id, socket);
    F.links(profile.id).then(l => socket.emit('friend:count', [...l.values()].filter(x => x.status === 'pending' && !x.mine).length)).catch(() => {});
    S.playerSeen(pid, true);
    const daily = A.claimDaily(profile);
    if (table) table.broadcast();
    reply(cb, null, { profile: A.view(profile), daily });
  };
  socket.on('auth', async (token, cb) => {
    try { const user = await A.verify(String(token || '')); if (!user) return reply(cb, 'Sign-in expired. Please sign in again.'); await signedIn(user, cb); }
    catch (e) { console.error('auth', e.message); reply(cb, 'Could not load your profile. Try again in a minute.'); }
  });
  socket.on('devLogin', async (nm, cb) => {
    if (!A.DEV || A.enabled) return reply(cb, 'Not available');
    await signedIn({ id: 'dev-' + pid, name: cleanName(nm), avatar: '' }, cb);
  });
  socket.on('signout', cb => { if (socket.data.uid) { goOffline(socket.data.uid, socket); socket.data.uid = null; } pidAuth.delete(pid); if (table) table.broadcast(); reply(cb); });
  socket.on('buy', (item, cb) => {
    const a = pidAuth.get(pid); if (!a) return reply(cb, 'Sign in to collect coins');
    const err = A.buy(a.profile, String(item)); reply(cb, err, { profile: A.view(a.profile) });
  });
  socket.on('setPic', async (val, cb) => {
    const a = pidAuth.get(pid); if (!a) return reply(cb, 'Sign in to choose a picture');
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
  socket.on('equip', (item, cb) => {
    const a = pidAuth.get(pid); if (!a) return reply(cb, 'Sign in first');
    const err = A.equip(a.profile, String(item)); reply(cb, err, { profile: A.view(a.profile) });
  });

  socket.on('chat', (text, cb) => {
    if (!table) return reply(cb, 'Not at a table');
    const now = Date.now(); if (socket.data.lastChat && now - socket.data.lastChat < 700) return reply(cb, 'Slow down a little');
    socket.data.lastChat = now;
    reply(cb, table.chat(pid, text));
  });
  socket.on('chatHistory', cb => { reply(cb, null, { list: table ? table.chatHistory(pid) : [] }); });
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
  const live = { online: io.engine.clientsCount, tables: tables.size, playing: 0, waiting: 0, people: 0, modes: { 4: 0, 6: 0, 8: 0, joker: 0 } };
  for (const t of tables.values()) {
    const humans = t.seats.filter(s => !s.bot && s.pid).length;
    if (t.phase === 'game') { live.playing++; live.people += humans; live.modes[t.n]++; if (t.joker) live.modes.joker++; } else if (t.phase === 'lobby') live.waiting++;
  }
  try { res.json({ live, ...(await S.report()), today: S.dayOf() }); }
  catch (e) { console.error('admin report', e.message); res.json({ live, daily: [], top: [], accounts: 0, today: S.dayOf(), error: 'Saved stats could not load. Did you run supabase-stats.sql in Supabase?' }); }
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
