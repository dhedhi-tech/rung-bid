// Rung Bid online server: serves the game page and runs every table.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Table } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
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

io.on('connection', socket => {
  let pid = cleanPid(socket.handshake.auth && socket.handshake.auth.pid);
  let name = cleanName(socket.handshake.auth && socket.handshake.auth.name);
  let table = null;
  if (!pid) { socket.emit('fatal', 'Missing player id'); socket.disconnect(true); return; }

  const reply = (cb, err, data) => { if (typeof cb === 'function') cb(err ? { error: err } : { ok: true, ...data }); };
  const leave = () => { if (table) { table.removeClient(socket.id); socket.leave(table.code); table = null; } };
  // removeClient also drops this socket from voice chat and tells the others

  socket.on('create', (opts, cb) => {
    const n = [4, 6, 8].includes(opts && opts.n) ? opts.n : 4;
    if (tables.size > 500) return reply(cb, 'Server is busy. Try again in a minute.');
    const code = newCode();
    const t = new Table(code, { n, joker: !!(opts && opts.joker), hostId: pid, limit: opts && Number(opts.limit) }, io);
    tables.set(code, t);
    leave(); table = t; t.addClient(socket, pid, name);
    t.sit(pid, 0);
    reply(cb, null, { code });
  });

  socket.on('join', (code, cb) => {
    const t = tables.get(String(code || '').toUpperCase());
    if (!t) return reply(cb, 'This table has closed. Ask your friend for a new link, or create your own table.');
    leave(); table = t; t.addClient(socket, pid, name);
    reply(cb, null, { code: t.code });
  });

  socket.on('rename', (nm, cb) => {
    name = cleanName(nm);
    if (table) { const p = table.players.get(pid); if (p) { p.name = name; if (p.seat != null && !table.seats[p.seat].bot) table.seats[p.seat].name = name; } table.broadcast(); }
    reply(cb);
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

  socket.on('disconnect', leave);
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
server.listen(PORT, () => console.log('Rung Bid running on port ' + PORT));
