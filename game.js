// Rung Bid game engine. The server is the referee: it holds every hand, checks every move,
// runs bots for empty or idle seats, and sends each player only what they are allowed to see.

const SUITS = ['S', 'H', 'C', 'D'];
const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SNAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const RL = r => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[r] || String(r);
const BOT_NAMES = ['Sana', 'Bilal', 'Hira', 'Usman', 'Zara', 'Hamza', 'Maham', 'Ali', 'Ayesha', 'Omar'];
const TARGET = 52;
const SPEED = Number(process.env.RB_SPEED) || 1; // test hook: 0.1 runs ten times faster
const PACE = { bot: 800 * SPEED, trick: 1300 * SPEED, trump: 1800 * SPEED, deal: 700 * SPEED };
const TURN_MS = { bid: 20000, trump: 20000, play: 30000 };
const HAND_END_MS = 9000 * SPEED;

const isJ = c => c.s === 'J';
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function buildDeck(n, joker = false) {
  const decks = n === 4 ? 1 : 2, out = []; let id = 0;
  for (let d = 0; d < decks; d++) {
    for (const s of SUITS) for (let r = 2; r <= 14; r++) {
      if (n === 6 && r <= 4) continue;
      if (!joker && n === 6 && r === 5 && s === 'D') continue; // classic 6p: drop both 5♦
      if (joker && n === 6 && r === 5 && d === 0) continue;     // joker 6p: drop one 5 of each suit
      if (joker && n !== 6 && r === 2 && s === 'C') continue;    // joker 4p/8p: drop 2♣ per deck
      out.push({ id: id++, s, r });
    }
    if (joker) out.push({ id: id++, s: 'J', r: 0 });
  }
  return out;
}

function power(cards, trump) {
  let p = 0, tc = 0;
  for (const c of cards) {
    if (c.s === trump) { tc++; p += 0.45 + (c.r - 2) / 12 * 0.9; }
    else p += c.r === 14 ? 1 : c.r === 13 ? 0.45 : c.r === 12 ? 0.15 : 0;
  }
  return p + Math.max(0, tc - cards.length / 4) * 0.45;
}
const calCache = {};
function calibrate(n, joker) {
  const k = n + ':' + joker;
  if (calCache[k]) return calCache[k];
  const base = buildDeck(n, joker), avg = {};
  for (const h of [5, 9, 13]) { let sum = 0; const N = 400; for (let i = 0; i < N; i++) sum += power(shuffle(base.slice()).slice(0, h), 'S'); avg[h] = sum / N; }
  return (calCache[k] = avg);
}
function perms(a) { if (a.length < 2) return [a]; return a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])); }

class Abort extends Error {}

class Table {
  constructor(code, { n, joker, hostId }, io) {
    this.code = code; this.io = io;
    this.n = n; this.joker = !!joker; this.hostId = hostId;
    this.alive = true; this.running = false; this.phase = 'lobby';
    const names = shuffle(BOT_NAMES.slice());
    this.seats = Array.from({ length: n }, (_, i) => ({ pid: null, name: names[i], bot: true }));
    this.clients = new Map(); // socket.id -> {socket, pid}
    this.players = new Map(); // pid -> {name, seat, connected}
    this.pending = null;
    this.lastActive = Date.now();
    this.G = null;
    this.waitNext = null;
  }

  // ---------- membership ----------
  addClient(socket, pid, name) {
    this.clients.set(socket.id, { socket, pid });
    const p = this.players.get(pid);
    if (p) { p.connected = true; p.name = name || p.name; if (p.seat != null) { this.seats[p.seat].name = p.name; } }
    else this.players.set(pid, { name, seat: null, connected: true });
    socket.join(this.code);
    this.touch(); this.broadcast();
  }
  removeClient(socketId) {
    const c = this.clients.get(socketId); if (!c) return;
    this.clients.delete(socketId);
    const stillHere = [...this.clients.values()].some(x => x.pid === c.pid);
    const p = this.players.get(c.pid);
    if (p && !stillHere) {
      p.connected = false;
      if (p.seat != null && this.pending && this.pending.seat === p.seat) this.pending.timeoutSoon();
      if (c.pid === this.hostId) this.passHost();
    }
    this.broadcast();
  }
  passHost() {
    for (const [pid, p] of this.players) if (p.connected && p.seat != null) { this.hostId = pid; return; }
    for (const [pid, p] of this.players) if (p.connected) { this.hostId = pid; return; }
  }
  humansConnected() { return [...this.players.values()].some(p => p.connected); }
  touch() { this.lastActive = Date.now(); }

  sit(pid, seat) {
    const p = this.players.get(pid); if (!p) return 'Not in this table';
    if (!(seat >= 0 && seat < this.n)) return 'No such seat';
    const s = this.seats[seat];
    if (s.pid && s.pid !== pid) {
      const other = this.players.get(s.pid);
      if (other && other.connected) return 'Seat taken';
    }
    if (p.seat != null && p.seat !== seat) {
      if (this.phase !== 'lobby') return 'You already have a seat';
      this.freeSeat(p.seat);
    }
    if (s.pid && s.pid !== pid) { const other = this.players.get(s.pid); if (other) other.seat = null; }
    s.pid = pid; s.bot = false; s.name = p.name; p.seat = seat;
    this.touch(); this.broadcast();
    return null;
  }
  freeSeat(seat) {
    const s = this.seats[seat]; const p = s.pid && this.players.get(s.pid);
    if (p) p.seat = null;
    s.pid = null; s.bot = true; s.name = this.botName(seat);
  }
  stand(pid) {
    const p = this.players.get(pid); if (!p || p.seat == null) return;
    const seat = p.seat; this.freeSeat(seat);
    if (this.pending && this.pending.seat === seat) this.pending.timeoutSoon();
    if (pid === this.hostId) this.passHost();
    this.broadcast();
  }
  botName(seat) {
    const used = new Set(this.seats.map(s => s.name));
    return BOT_NAMES.find(n => !used.has(n)) || ('Bot ' + (seat + 1));
  }
  isHuman(seat) {
    const s = this.seats[seat]; if (s.bot || !s.pid) return false;
    const p = this.players.get(s.pid); return !!(p && p.connected);
  }

  // ---------- pacing ----------
  sleep(ms) {
    return new Promise((res, rej) => setTimeout(() => this.alive ? res() : rej(new Abort()), ms));
  }

  // ---------- text with per-viewer names ----------
  // {n3} name of seat 3, {v3:bid:bids} "You bid" / "Sana bids", {t1} team name, {tl1} lowercase
  fmt(str, me) {
    if (!str) return '';
    const name = s => (s === me ? 'You' : this.seats[s].name);
    const team = t => (me == null || me < 0 ? (t === 0 ? 'Orange team' : 'Blue team') : (t === me % 2 ? 'Your team' : 'Opponents'));
    return str
      .replace(/\{v(\d+):([^:}]*):([^}]*)\}/g, (_, s, a, b) => (+s === me ? 'You ' + a : this.seats[+s].name + ' ' + b))
      .replace(/\{n(\d+)\}/g, (_, s) => name(+s))
      .replace(/\{tl(\d)\}/g, (_, t) => team(+t).toLowerCase())
      .replace(/\{t(\d)\}/g, (_, t) => team(+t));
  }
  log(str) { const G = this.G; G.log.push(str); if (G.log.length > 4) G.log.shift(); }
  setMain(str) { this.G.main = str; }

  // ---------- views ----------
  viewFor(pid) {
    const p = pid && this.players.get(pid);
    const me = p && p.seat != null ? p.seat : -1;
    const base = me < 0 ? 0 : me, n = this.n;
    const rot = s => (s == null || s < 0 ? s : (s - base + n) % n);
    const rotTeam = t => (t - base % 2 + 2) % 2;
    const flip = base % 2 === 1 ? -1 : 1;
    const v = {
      code: this.code, n, joker: this.joker, phase: this.phase, me: me < 0 ? null : 0, spectator: me < 0,
      isHost: pid === this.hostId,
      seats: Array.from({ length: n }, (_, i) => {
        const s = this.seats[(i + base) % n];
        const pl = s.pid && this.players.get(s.pid);
        return { name: s.name, bot: s.bot, human: !s.bot, connected: !!(pl && pl.connected), host: s.pid === this.hostId, real: (i + base) % n };
      }),
      lobbyNames: [...this.players.values()].filter(x => x.connected && x.seat == null).map(x => x.name),
    };
    const G = this.G;
    if (!G) return v;
    Object.assign(v, {
      handNo: G.handNo, dealer: rot(G.dealer), score: G.score * flip, won: [G.won[base % 2], G.won[1 - base % 2]],
      round: G.round, gphase: G.phase, active: rot(G.active),
      bid: G.bid ? { value: G.bid.value, seat: rot(G.bid.seat) } : null,
      trump: G.trump, leadSuit: G.leadSuit,
      tricksWon: [G.tricksWon[base % 2], G.tricksWon[1 - base % 2]],
      acts: Object.fromEntries(Object.entries(G.acts).map(([s, a]) => [rot(+s), a])),
      hist: G.hist.map(h => ({ ...h, seat: rot(h.seat) })),
      roundTrump: Object.fromEntries(Object.entries(G.roundTrump).map(([r, t]) => [r, { ...t, seat: rot(t.seat) }])),
      trick: G.trick.map(t => ({ seat: rot(t.seat), card: t.card })),
      counts: Array.from({ length: n }, (_, i) => G.players[(i + base) % n].hand.length),
      tricks: Array.from({ length: n }, (_, i) => G.players[(i + base) % n].tricks),
      hand: me >= 0 ? G.players[me].hand : [],
      main: this.fmt(G.main, me), log: G.log.map(l => this.fmt(l, me)),
      deadline: G.deadline ? Math.max(0, G.deadline - Date.now()) : 0,
      over: G.over || null,
    });
    if (this.pending && this.pending.seat === me && me >= 0) v.ask = this.pending.askView;
    if (G.result) v.result = this.resultView(G.result, me, base);
    return v;
  }
  resultView(R, me, base) {
    const rotTeam = t => (t - base % 2 + 2) % 2;
    return {
      title: this.fmt(R.title, me), winner: rotTeam(R.winner), pts: R.pts, contract: R.contract, bidder: this.fmt(`{n${R.bidSeat}}`, me),
      tricks: [R.tricks[base % 2], R.tricks[1 - base % 2]], next: R.next != null ? this.fmt(`{n${R.next}}`, me) : null,
      over: R.over, endsAt: R.endsAt ? Math.max(0, R.endsAt - Date.now()) : 0, handNo: R.handNo,
    };
  }
  broadcast() {
    for (const { socket, pid } of this.clients.values()) socket.emit('state', this.viewFor(pid));
  }
  fx(type, data = {}) {
    for (const { socket, pid } of this.clients.values()) {
      const p = this.players.get(pid); const me = p && p.seat != null ? p.seat : -1; const base = me < 0 ? 0 : me;
      const rot = s => (s == null || s < 0 ? s : (s - base + this.n) % this.n);
      const d = { ...data };
      for (const k of ['seat', 'lead', 'credit', 'showSeat']) if (k in d) d[k] = rot(d[k]);
      if ('team' in d) d.team = (d.team - base % 2 + 2) % 2;
      if (d.text) d.text = this.fmt(d.text, me);
      if (d.sub) d.sub = this.fmt(d.sub, me);
      socket.emit('fx', { type, ...d });
    }
  }

  // ---------- asking a seat for a move ----------
  ask(seat, kind, askView, fallback, valid) {
    const G = this.G;
    G.active = seat;
    if (!this.isHuman(seat)) {
      G.deadline = 0; this.broadcast();
      return this.sleep(PACE.bot).then(() => fallback());
    }
    const ms = TURN_MS[kind];
    G.deadline = Date.now() + ms;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = val => { if (done) return; done = true; clearTimeout(timer); this.pending = null; G.deadline = 0; if (!this.alive) reject(new Abort()); else resolve(val); };
      const timer = setTimeout(() => finish(fallback()), ms);
      this.pending = {
        seat, kind, askView,
        submit: val => { if (!valid(val)) return 'Not allowed'; finish(val); return null; },
        timeoutSoon: () => { clearTimeout(timer); setTimeout(() => finish(fallback()), 1200 * SPEED); },
        abort: () => { done = true; clearTimeout(timer); reject(new Abort()); },
      };
      this.broadcast();
    });
  }
  act(pid, kind, value) {
    const p = this.players.get(pid);
    if (!p || p.seat == null) return 'You are not seated';
    if (!this.pending || this.pending.seat !== p.seat || this.pending.kind !== kind) return 'Not your turn';
    this.touch();
    return this.pending.submit(value);
  }

  // ---------- game lifecycle ----------
  start(pid) {
    if (pid !== this.hostId) return 'Only the host can start';
    if (this.running) return 'Already running';
    this.newGame();
    return null;
  }
  newGame() {
    this.G = {
      n: this.n, joker: this.joker, avg: calibrate(this.n, this.joker), players: Array.from({ length: this.n }, () => ({ hand: [], tricks: 0 })),
      dealer: Math.floor(Math.random() * this.n), score: 0, won: [0, 0], handNo: 1,
      bid: null, trump: null, acts: {}, trick: [], leadSuit: null, tricksWon: [0, 0], phase: 'deal', active: -1, log: [], round: 0,
      hist: [], roundTrump: {}, main: '', deadline: 0, over: null, result: null,
    };
    this.phase = 'game'; this.running = true;
    this.run();
  }
  async run() {
    try { while (this.alive) { const over = await this.playHand(); if (over) break; } }
    catch (e) { if (!(e instanceof Abort)) console.error('table', this.code, e); }
    this.running = false;
  }
  destroy() {
    this.alive = false;
    if (this.pending) this.pending.abort();
    if (this.waitNext) this.waitNext();
  }

  // ---------- rules ----------
  need() { return Math.max(7, this.G.bid.value); }
  beats(c, b) { if (c.s === b.s) return c.r >= b.r; return c.s === this.G.trump; }
  currentWinner() { const G = this.G; let w = G.trick[0]; for (let i = 1; i < G.trick.length; i++) if (!isJ(G.trick[i].card) && this.beats(G.trick[i].card, w.card)) w = G.trick[i]; return w; }
  jokerCount() { return this.G.trick.filter(t => isJ(t.card)).length; }
  trickResult() {
    const G = this.G, w = this.currentWinner();
    if (this.jokerCount() % 2 === 0) return { team: w.seat % 2, lead: w.seat, show: w, credit: w.seat, flipped: false };
    const jt = G.trick.find(t => isJ(t.card)), team = 1 - w.seat % 2;
    const key = c => (c.s === G.trump ? 2 : c.s === G.leadSuit ? 1 : 0) * 100 + c.r;
    let best = null; for (const t of G.trick) { if (t.seat % 2 !== team || isJ(t.card)) continue; if (!best || key(t.card) >= key(best.card)) best = t; }
    return { team, lead: jt.seat, show: jt, credit: (best || jt).seat, flipped: true };
  }
  legalCards(hand) {
    const G = this.G;
    if (!G.leadSuit) { const nj = hand.filter(c => !isJ(c)); return nj.length ? nj : hand; }
    const f = hand.filter(c => c.s === G.leadSuit); return f.length ? f : hand;
  }

  // ---------- bots ----------
  botBid(seat, round) {
    const G = this.G, p = G.players[seat], h = p.hand.length, team = G.n / 2, per = 13 / G.n;
    if (G.bid && G.bid.seat === seat) return null;
    const best = Math.max(...SUITS.map(s => power(p.hand, s)));
    const share = best / G.avg[h];
    const mine = per * (1 + (share - 1) * (h / 13));
    const est = mine + (team - 1) * per * 0.95 - [0.6, 0.3, 0.1][round - 1] + (Math.random() - 0.5) * 0.4;
    const cap = [share >= 2.6 ? 7 : 6, 8, 13][round - 1];
    const jk = p.hand.filter(isJ).length;
    const jBonus = jk * (0.3 + 0.5 * Math.max(0, Math.min(1, share - 1)));
    const tricks = Math.floor(est + jBonus);
    const maxBid = tricks >= 7 ? Math.min(cap, tricks) : 5;
    const cur = G.bid ? G.bid.value : 5;
    const partnerHolds = G.bid && G.bid.seat % 2 === seat % 2;
    if (partnerHolds) {
      if (round === 1) return null;
      const tc = p.hand.filter(c => c.s === G.trump);
      const shareT = power(p.hand, G.trump) / G.avg[h];
      const needS = round === 2 ? 1.35 : 1.6;
      if (cur < cap && shareT >= needS && tc.length >= Math.ceil(h / 4) && tc.some(c => c.r >= 13)) { G.supportSeat = seat; return cur + 1; }
      if (maxBid < cur + 2) return null;
    }
    if (maxBid > cur) return Math.max(6, cur + 1);
    return null;
  }
  botTrump(seat) {
    const G = this.G;
    if (G.supportSeat === seat && G.trump) return G.trump;
    const h = G.players[seat].hand; let best = 'S', bp = -1;
    for (const s of SUITS) { const p = power(h, s); if (p > bp) { bp = p; best = s; } }
    return best;
  }
  botPlay(seat) {
    const G = this.G, hand = G.players[seat].hand, legal = this.legalCards(hand), T = G.trump, team = seat % 2;
    const nonJ = legal.filter(c => !isJ(c)), jok = legal.find(isJ);
    const lowest = cs => { const pool = cs.filter(c => !isJ(c)); return (pool.length ? pool : cs).slice().sort((a, b) => ((a.s === T) - (b.s === T)) * 100 + (a.r - b.r))[0]; };
    if (!G.trick.length) return this.botLead(seat, legal);
    const after = G.n - G.trick.length - 1;
    if (G.joker) {
      const eff = this.trickResult();
      if (jok && eff.team !== team && (after === 0 || !nonJ.some(c => c.s === T) || hand.length <= 3)) return jok;
      if (jok && hand.length <= 8 && eff.team !== team) return jok;
      if (!nonJ.length) return jok;
      if (eff.flipped) return lowest(nonJ);
    }
    const cur = this.currentWinner();
    const leader = G.trick[0].seat, partnerLed = leader % 2 === team && leader !== seat;
    if (cur.seat % 2 === team) {
      if (partnerLed && after > 0 && cur.card.r < 14 && cur.card.s === G.leadSuit) {
        const over = legal.filter(c => c.s === G.leadSuit && this.beats(c, cur.card)).sort((a, b) => b.r - a.r);
        if (over.length) return over[0];
      }
      return lowest(legal);
    }
    const winners = legal.filter(c => !isJ(c) && this.beats(c, cur.card));
    if (!winners.length) return lowest(legal);
    const fw = winners.filter(c => c.s !== T).sort((a, b) => a.r - b.r);
    if (fw.length) return after === 0 ? fw[0] : fw[fw.length - 1];
    return winners.sort((a, b) => a.r - b.r)[0];
  }
  botLead(seat, hand) {
    const G = this.G, T = G.trump, team = seat % 2, bidTeam = G.bid.seat % 2 === team;
    const low = cs => cs.slice().sort((a, b) => a.r - b.r)[0];
    const of = s => hand.filter(c => c.s === s);
    const others = [...Array(G.n).keys()].filter(i => i !== seat);
    const partners = others.filter(i => i % 2 === team).sort((a, b) => (b === G.bid.seat) - (a === G.bid.seat));
    const opps = others.filter(i => i % 2 !== team);
    const mayTrump = p => !G.voids[p].has(T);
    const oppCuts = s => opps.some(p => G.voids[p].has(s) && mayTrump(p));
    const r = G.returnTo[seat]; G.returnTo[seat] = null;
    if (r && r.suit !== T && of(r.suit).length && mayTrump(r.partner)) return low(of(r.suit));
    for (const p of partners) { if (!mayTrump(p)) continue; for (const s of G.voids[p]) if (s !== T && of(s).length) return low(of(s)); }
    const trumps = of(T).sort((a, b) => b.r - a.r);
    const safe = hand.filter(c => c.s !== T && !isJ(c) && !oppCuts(c.s));
    const pool = safe.length ? safe : hand.filter(c => c.s !== T && !isJ(c));
    if (seat === G.bid.seat && trumps.length >= 2) {
      const single = SUITS.find(s => s !== T && of(s).length === 1 && of(s)[0].r < 14 && !oppCuts(s));
      if (single) return of(single)[0];
    }
    if (bidTeam && trumps.length >= 4 && trumps[0].r >= 13) return trumps[0];
    const ace = pool.find(c => c.r === 14); if (ace) return ace;
    if (!pool.length) return trumps.length ? trumps[trumps.length - 1] : hand[0];
    const groups = {}; for (const c of pool) (groups[c.s] = groups[c.s] || []).push(c);
    const suits = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    return low(groups[suits[0]]);
  }

  // ---------- flow ----------
  async deal(k) {
    const G = this.G, start = (G.dealer + 1) % G.n;
    for (let i = 0; i < k; i++) for (let j = 0; j < G.n; j++) G.players[(start + j) % G.n].hand.push(G.deck.pop());
    this.broadcast(); this.fx('deal');
    await this.sleep(PACE.deal);
  }
  async biddingRound(r) {
    const G = this.G, start = (G.dealer + 1) % G.n, before = G.bid ? G.bid.value : 0;
    for (let k = 0; k < G.n; k++) {
      const seat = (start + k) % G.n;
      G.main = `Waiting for {n${seat}} to bid`;
      const cur = G.bid ? G.bid.value : 5, maxV = r === 1 ? 7 : 13;
      const options = []; if (!(G.bid && G.bid.seat === seat)) for (let v = Math.max(6, cur + 1); v <= maxV; v++) options.push(v);
      const v = await this.ask(seat, 'bid', { kind: 'bid', round: r, options }, () => this.botBid(seat, r),
        val => val === 0 || val === null || options.includes(val));
      const val = v || null;
      G.hist.push({ r, seat, v: val });
      if (val) {
        const support = G.supportSeat === seat && !this.isHuman(seat);
        G.bid = { value: val, seat }; G.acts[seat] = val;
        this.log(support ? `{n${seat}} raises to ${val} to back partner's ${SNAME[G.trump]}` : `{v${seat}:bid:bids} ${val}`);
        this.fx(support ? 'support' : 'bid', { seat, v: val });
      } else {
        G.acts[seat] = 'Pass'; this.log(`{v${seat}:pass:passes}`); this.fx('pass', { seat });
      }
      if (G.supportSeat === seat && !val) G.supportSeat = -1;
      this.broadcast();
    }
    G.active = -1;
    if (!G.bid) {
      G.bid = { value: 6, seat: start }; G.acts[start] = 6; G.hist.push({ r, seat: start, v: 6, forced: true });
      this.log(`All passed. {v${start}:are:is} forced to bid 6`); this.broadcast();
      await this.sleep(PACE.bot);
    }
    return G.bid.value !== before;
  }
  async callTrump() {
    const G = this.G, seat = G.bid.seat;
    G.main = `Waiting for {n${seat}} to call trump`;
    const s = await this.ask(seat, 'trump', { kind: 'trump', bid: G.bid.value, current: G.trump }, () => this.botTrump(seat), v => SUITS.includes(v));
    const prev = G.trump; G.trump = s;
    const kind = !prev ? 'call' : prev !== s ? 'change' : 'keep';
    this.log(kind === 'call' ? `{v${seat}:call:calls} ${SNAME[s]} trump` : kind === 'change' ? `{v${seat}:change:changes} trump to ${SNAME[s]}` : `Trump stays ${SNAME[s]}`);
    G.active = -1; this.broadcast();
    this.fx('trump', { s, sub: kind === 'call' ? `Called by {n${seat}}` : kind === 'change' ? `Changed by {n${seat}}` : `Kept by {n${seat}}`, seat });
    await this.sleep(PACE.trump);
  }
  playCard(seat, card) {
    const G = this.G, h = G.players[seat].hand; h.splice(h.findIndex(c => c.id === card.id), 1);
    if (!G.trick.length) G.leadSuit = card.s;
    G.trick.push({ seat, card });
    if (G.trick.length > 1 && card.s !== G.leadSuit) G.voids[seat].add(G.leadSuit);
    if (isJ(card)) {
      const cancel = this.jokerCount() === 2;
      this.log(`{v${seat}:throw:throws} a Joker${cancel ? ' (cancels the other)' : ''}`);
      this.broadcast(); this.fx('joker', { seat, cancel }); return;
    }
    const cut = G.trick.length > 1 && card.s === G.trump && G.leadSuit !== G.trump;
    const over = cut && G.trick.slice(0, -1).some(t => t.card.s === G.trump);
    this.log(`{v${seat}:play:plays} ${RL(card.r)}${SYM[card.s]}${cut ? (over ? ' (over cut)' : ' (cut)') : ''}`);
    this.broadcast(); this.fx('card', { seat, cut, over, s: card.s });
  }
  async playTricks() {
    const G = this.G; let leader = G.bid.seat; const bt = G.bid.seat % 2, v = this.need();
    for (let t = 0; t < 13; t++) {
      G.trick = []; G.leadSuit = null;
      const lh = G.players[leader].hand;
      if (lh.length && lh.every(isJ)) {
        const ot = 1 - leader % 2, left = lh.length;
        G.tricksWon[ot] += left;
        this.log(`{v${leader}:are:is} stuck with ${left === 1 ? 'a joker' : left + ' jokers'}`);
        G.main = `{n${leader}} can't lead a joker. {t${ot}} take ${left} trick${left > 1 ? 's' : ''}`;
        this.broadcast(); this.fx('stuck', { seat: leader, left, team: ot });
        await this.sleep(2200 * SPEED);
        break;
      }
      for (let k = 0; k < G.n; k++) {
        const seat = (leader + k) % G.n;
        G.main = `Waiting for {n${seat}} to play`;
        const legal = this.legalCards(G.players[seat].hand);
        const ids = legal.map(c => c.id);
        const cardId = await this.ask(seat, 'play', { kind: 'play', legal: ids }, () => this.botPlay(seat).id, id => ids.includes(id));
        this.playCard(seat, G.players[seat].hand.find(c => c.id === cardId));
      }
      G.active = -1;
      const res = this.trickResult();
      const L = G.trick[0].seat;
      if (!res.flipped && L !== res.lead && L % 2 === res.lead % 2) G.returnTo[res.lead] = { suit: G.trick[0].card.s, partner: L };
      G.tricksWon[res.team]++; G.players[res.credit].tricks++;
      if (res.flipped) { this.log(`Joker flips the trick to {tl${res.team}}`); G.main = `Joker reverses it. {t${res.team}} take the trick, {v${res.lead}:lead:leads} next`; }
      else G.main = `{v${res.lead}:win:wins} the trick`;
      this.broadcast();
      this.fx('trick', { team: res.team, credit: res.credit, lead: res.lead, flipped: res.flipped, showSeat: res.show.seat, showId: res.show.card.id });
      await this.sleep(PACE.trick + (res.flipped ? 500 : 0));
      G.trick = []; G.leadSuit = null; this.broadcast();
      await this.sleep(350 * SPEED);
      leader = res.lead;
      if (G.tricksWon[bt] >= v || G.tricksWon[1 - bt] > 13 - v) break;
    }
  }
  nextDealer() {
    const G = this.G, last = G.bid.seat;
    if (G.score === 0) { G.dealer = (G.dealer + 1) % G.n; return; }
    const behind = G.score > 0 ? 1 : 0;
    G.dealer = last % 2 === behind ? last : (last - 1 + G.n) % G.n;
  }
  async endHand() {
    const G = this.G, bt = G.bid.seat % 2, ot = 1 - bt, v = G.bid.value, tw = G.tricksWon, req = this.need();
    let winner, pts, title;
    if (tw[bt] >= req) { winner = bt; if (tw[ot] === 0) { pts = 2 * v; title = `Clean sweep. {t${bt}} score double`; } else { pts = v; title = `{t${bt}} made the bid`; } }
    else { winner = ot; if (tw[bt] === 0) { pts = 4 * v; title = `Whitewash. {t${ot}} score 4×`; } else { pts = 2 * v; title = `Bid broken. {t${ot}} score double`; } }
    G.score += winner === 0 ? pts : -pts; G.won[winner] += pts;
    const over = Math.abs(G.score) >= TARGET;
    if (!over) this.nextDealer();
    G.phase = 'done'; G.main = title;
    G.result = { title, winner, pts, contract: `${v} ${SYM[G.trump]}`, bidSeat: G.bid.seat, tricks: tw.slice(), next: over ? null : G.dealer, over, endsAt: over ? 0 : Date.now() + HAND_END_MS, handNo: G.handNo };
    if (over) G.over = { winner: G.score > 0 ? 0 : 1 };
    this.broadcast(); this.fx('handEnd', { team: winner });
    if (over) { this.phase = 'over'; this.broadcast(); return true; }
    await new Promise(res => { const t = setTimeout(res, HAND_END_MS); this.waitNext = () => { clearTimeout(t); res(); }; });
    this.waitNext = null;
    if (!this.alive) throw new Abort();
    G.result = null; G.handNo++;
    return false;
  }
  dealNow(pid) { if (pid === this.hostId && this.waitNext) this.waitNext(); }
  playAgain(pid) {
    if (pid !== this.hostId || this.phase !== 'over' || this.running) return 'Only the host can restart';
    this.newGame(); return null;
  }
  async playHand() {
    const G = this.G;
    Object.assign(G, {
      voids: Array.from({ length: G.n }, () => new Set()), returnTo: Array(G.n).fill(null), hist: [], roundTrump: {}, supportSeat: -1,
      bid: null, trump: null, acts: {}, trick: [], leadSuit: null, tricksWon: [0, 0], round: 0, phase: 'deal', active: -1, log: [], result: null,
    });
    G.players.forEach(p => { p.hand = []; p.tricks = 0; });
    G.deck = shuffle(buildDeck(G.n, G.joker));
    this.log(`{v${G.dealer}:deal:deals}`);
    const plan = [5, 4, 4];
    for (let r = 1; r <= 3; r++) {
      G.round = r; G.phase = 'deal'; G.main = `Round ${r}: dealing ${plan[r - 1]} cards each`;
      await this.deal(plan[r - 1]);
      G.phase = 'bid'; G.acts = {};
      const raised = await this.biddingRound(r);
      if (raised || !G.trump) await this.callTrump();
      else { this.log(`No raise. Trump stays ${SNAME[G.trump]}`); this.broadcast(); this.fx('trump', { s: G.trump, sub: 'No raise. Trump stays' }); await this.sleep(PACE.trump); }
      G.roundTrump[r] = { s: G.trump, seat: G.bid.seat, v: G.bid.value };
    }
    G.phase = 'play'; G.acts = {};
    G.main = `{v${G.bid.seat}:lead:leads}`; this.broadcast();
    await this.sleep(500 * SPEED);
    await this.playTricks();
    return this.endHand();
  }
}

module.exports = { Table, buildDeck, isJ };
