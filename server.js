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

  socket.on('create', (opts, cb) => {
    const n = [4, 6, 8].includes(opts && opts.n) ? opts.n : 4;
    if (tables.size > 500) return reply(cb, 'Server is busy. Try again in a minute.');
    const code = newCode();
    const t = new Table(code, { n, joker: !!(opts && opts.joker), hostId: pid }, io);
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
  socket.on('next', cb => { if (table) table.dealNow(pid); reply(cb); });
  socket.on('again', cb => { if (!table) return reply(cb, 'Not at a table'); reply(cb, table.playAgain(pid)); });
  socket.on('leaveTable', cb => { if (table) table.stand(pid); leave(); reply(cb); });
  socket.on('react', (emo, cb) => {
    const allowed = ['👏', '😂', '😮', '🔥', '😢', '🙏'];
    if (!table || !allowed.includes(emo)) return reply(cb);
    const now = Date.now(); if (socket.data.lastReact && now - socket.data.lastReact < 1200) return reply(cb);
    socket.data.lastReact = now;
    const p = table.players.get(pid); if (p && p.seat != null) table.fx('react', { seat: p.seat, emo });
    reply(cb);
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
