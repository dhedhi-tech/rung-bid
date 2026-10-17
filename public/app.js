/* Rung Bid online client. The server runs the game; this page draws it and sends your moves. */
const SUITS = ['S', 'H', 'C', 'D'];
const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SNAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const RED = s => s === 'H' || s === 'D';
const RL = r => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' })[r] || String(r);
const isJ = c => c.s === 'J';
const TARGET = 52;
const $ = id => document.getElementById(id);
const coarse = matchMedia('(pointer: coarse)').matches;
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* ---------- identity ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
let pid = store.get('rb-pid');
if (!pid) { pid = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('rb-pid', pid); }
let myName = store.get('rb-name') || '';
let tableCode = (new URLSearchParams(location.search).get('t') || '').toUpperCase() || null;
let homeN = 4, homeJ = false;

/* ---------- sound ---------- */
let AC = null, muted = store.get('rb-muted') === '1';
function ac() { if (muted) return null; try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; } catch (e) { return null; } }
function tone(f, t0, dur, { type = 'sine', vol = .18, slide = 0 } = {}) {
  const c = ac(); if (!c) return; const t = c.currentTime + t0;
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + .02);
}
function noise(t0, dur, { vol = .25, freq = 2500, q = .8, type = 'bandpass' } = {}) {
  const c = ac(); if (!c) return; const t = c.currentTime + t0;
  const len = Math.ceil(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); src.buffer = buf; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
  src.connect(f).connect(g).connect(c.destination); src.start(t);
}
const SFX = {
  deal() { for (let i = 0; i < 4; i++) noise(i * .07, .05, { vol: .12, freq: 3500 }); },
  card() { noise(0, .07, { vol: .3, freq: 1800, q: 1.2 }); tone(180, 0, .06, { type: 'triangle', vol: .08 }); },
  bid(v) { const base = 330 * Math.pow(2, (v - 6) / 12 * 2); tone(base, 0, .14, { type: 'triangle', vol: .16 }); tone(base * 1.5, .09, .22, { type: 'triangle', vol: .16 }); },
  support() { tone(523, 0, .12, { type: 'triangle' }); tone(659, .08, .12, { type: 'triangle' }); tone(784, .16, .25, { type: 'triangle' }); },
  pass() { tone(220, 0, .12, { type: 'sine', vol: .08, slide: .8 }); },
  trump() { [392, 494, 587].forEach((f, i) => tone(f, i * .06, .6, { type: 'triangle', vol: .11 })); tone(784, .2, .5, { type: 'sine', vol: .08 }); },
  cut() { noise(0, .28, { vol: .35, freq: 900, q: .6, type: 'highpass' }); tone(140, .18, .25, { type: 'square', vol: .12, slide: .5 }); tone(880, .2, .18, { type: 'sawtooth', vol: .05, slide: .6 }); },
  trickUs() { tone(784, 0, .12, { vol: .14 }); tone(1047, .09, .22, { vol: .14 }); },
  trickThem() { tone(392, 0, .12, { vol: .11 }); tone(330, .09, .2, { vol: .11 }); },
  turn() { tone(988, 0, .08, { vol: .07 }); },
  joker() { [880, 660, 440, 660, 880].forEach((f, i) => tone(f, i * .06, .12, { type: 'square', vol: .06 })); noise(0, .3, { vol: .15, freq: 600, q: 2 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .11, .35, { type: 'triangle', vol: .16 })); },
  lose() { [392, 349, 311, 262].forEach((f, i) => tone(f, i * .14, .35, { type: 'triangle', vol: .12 })); },
  pop() { tone(660, 0, .08, { vol: .08 }); },
};
function sfx(name, ...a) { try { SFX[name](...a); } catch (e) {} }

/* ---------- state ---------- */
let S = null;              // latest view from the server
let deadlineAt = 0, deadlineTotal = 1;
let prevHandIds = new Set(), newIds = null;
let selected = null, sweepTo = null, lastAskKey = '';
let modalKind = null, leaveArmed = false, shownHand = null, shownHost = null;

const me0 = () => S && !S.spectator;
const nm = s => (s === 0 && me0() ? 'You' : (S.seats[s] ? S.seats[s].name : '?'));
const tcls = s => (s % 2 === 0 ? 'ta' : 'tb');
const teamName = t => (S && S.spectator ? (t === 0 ? 'Orange team' : 'Blue team') : (t === 0 ? 'Your team' : 'Opponents'));
const teamTag = s => (S.spectator ? (s % 2 === 0 ? 'Orange' : 'Blue') : s === 0 ? 'Your team' : s % 2 === 0 ? 'Partner' : 'Opponent');
const pnShort = s => `<span class="pn ${tcls(s)}">${esc(nm(s))}</span>`;
const pn = s => `<span class="pn ${tcls(s)}">${esc(nm(s))}${s !== 0 || !me0() ? `<small> · ${S.spectator ? teamTag(s).toLowerCase() : s % 2 === 0 ? 'your team' : 'opponent'}</small>` : ''}</span>`;
const need = () => Math.max(7, S.bid.value);

function perms(a) { if (a.length < 2) return [a]; return a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])); }
function suitOrder(h) {
  const present = SUITS.filter(s => h.some(c => c.s === s)); let best = present, bs = -1;
  for (const p of perms(present)) {
    if (S.trump && present.includes(S.trump) && p[0] !== S.trump) continue;
    let sc = 0; for (let i = 1; i < p.length; i++) if (RED(p[i]) !== RED(p[i - 1])) sc++;
    if (sc > bs) { bs = sc; best = p; }
  }
  return best;
}
function sortHand(h) { const order = suitOrder(h), ix = s => (s === 'J' ? 99 : order.indexOf(s)); return h.slice().sort((a, b) => ix(a.s) - ix(b.s) || b.r - a.r); }
function seatAngle(seat) { return Math.PI / 2 + seat * 2 * Math.PI / S.n; }
function halfW() { const tw = ($('table') && $('table').clientWidth) || 800; return Math.min(44, Math.max(30, 50 - (62 / tw) * 100)); }
function seatPos(seat) { const a = seatAngle(seat); return { x: 50 + halfW() * Math.cos(a), y: 50 + 42 * Math.sin(a) }; }
function trickPos(seat) { const a = seatAngle(seat), r = S.n === 4 ? 16 : 20, rx = Math.min(r, halfW() - 19); return { x: 50 + rx * Math.cos(a), y: 50 + (r + 2) * Math.sin(a) }; }
function cardHTML(c, extra = '') {
  if (isJ(c)) return `<div class="card joker ${extra}" data-id="${c.id}"><span class="j-word">JOKER</span><span class="j-star">⇄</span></div>`;
  return `<div class="card ${RED(c.s) ? 'red' : ''} ${extra}" data-id="${c.id}"><span class="c-idx">${RL(c.r)}<small>${SYM[c.s]}</small></span><span class="c-pip">${SYM[c.s]}</span></div>`;
}

/* ---------- rendering ---------- */
function sizeCards() {
  const w = Math.min(window.innerWidth, 1120);
  const cw = Math.round(Math.max(46, Math.min(78, w * 0.11, window.innerHeight * 0.12)));
  document.documentElement.style.setProperty('--cw', cw + 'px');
  document.documentElement.style.setProperty('--tw', Math.round(cw * (S && S.n === 8 ? 0.74 : 0.82)) + 'px');
  return cw;
}
const sv = (t, one, many) => (teamName(t) === 'Opponents' ? many : one);
function scoreText() { const s = S.score || 0; return s > 0 ? `${teamName(0)} ${sv(0, 'leads', 'lead')} by ${s}` : s < 0 ? `${teamName(1)} ${sv(1, 'leads', 'lead')} by ${-s}` : 'Level'; }
function renderHeader() {
  const watching = S.phase !== 'lobby' && S.lobbyNames && S.lobbyNames.length ? `<span class="watchn"> · 👀 ${S.lobbyNames.length}<span class="wl"> watching</span></span>` : '';
  $('handNo').innerHTML = esc(S.handNo ? `Hand ${S.handNo} · ${S.n} players` : `Table ${S.code} · ${S.n} players`) + watching;
  $('handNo').title = watching ? 'Watching: ' + S.lobbyNames.join(', ') : '';
  document.querySelector('.sbox.ta .sname').textContent = teamName(0);
  document.querySelector('.sbox.tb .sname').textContent = teamName(1);
  const score = S.score || 0, s = Math.max(-TARGET, Math.min(TARGET, score)), pos = 50 - s / TARGET * 50;
  $('tiltKnob').style.left = pos + '%';
  const f = $('tiltFill');
  if (s >= 0) { f.style.left = pos + '%'; f.style.width = (50 - pos) + '%'; f.style.background = 'var(--team-a)'; }
  else { f.style.left = '50%'; f.style.width = (pos - 50) + '%'; f.style.background = 'var(--team-b)'; }
  $('tiltText').textContent = scoreText();
  for (const [id, val, lead] of [['scoreA', Math.max(score, 0), score > 0], ['scoreB', Math.max(-score, 0), score < 0]]) {
    const el = $(id); if (el.textContent !== String(val)) { el.textContent = val; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 300); }
    el.parentElement.classList.toggle('lead', lead);
  }
  const c = $('contract');
  if (S.phase === 'lobby') c.innerHTML = `<div class="c1">Table ${esc(S.code)}</div><div class="c2">Waiting to start</div>`;
  else if (!S.bid) c.innerHTML = `<div class="c1">${S.gphase === 'bid' ? 'Bidding' : 'Dealing'}</div><div class="c2">Round ${S.round || 1} of 3</div>`;
  else {
    const bt = S.bid.seat % 2;
    const ts = S.trump ? `<span class="tpill ${RED(S.trump) ? 'red' : ''}"><span class="tsuit">${SYM[S.trump]}</span>${SNAME[S.trump]}</span>` : '';
    const line2 = S.gphase === 'play' || S.gphase === 'done'
      ? `Tricks ${S.tricksWon[0]}–${S.tricksWon[1]} · ${teamName(bt)} need ${need()}${S.bid.value === 6 ? ' (bid 6)' : ''}`
      : `Round ${S.round} of 3 · ${pnShort(S.bid.seat)}`;
    c.innerHTML = `<div class="c1">Bid ${S.bid.value} ${ts}</div><div class="c2">${line2}</div>`;
  }
  const wm = $('watermark'); wm.textContent = S.trump ? SYM[S.trump] : ''; wm.className = 'watermark' + (S.trump && RED(S.trump) ? ' red' : '');
}
function renderSeats() {
  let html = '';
  for (let i = 0; i < S.n; i++) {
    const p = S.seats[i], pos = seatPos(i), t = tcls(i);
    let chips = '';
    if (S.phase !== 'lobby') {
      if (i === S.dealer) chips += `<span class="chip dealer"><span class="long">Dealer</span><span class="short">D</span></span>`;
      if (S.bid && S.bid.seat === i) chips += `<span class="chip holder ${t}">Bid ${S.bid.value}${S.trump ? ' ' + SYM[S.trump] : ''}</span>`;
      else if (S.gphase === 'bid' && S.acts && S.acts[i] !== undefined) chips += S.acts[i] === 'Pass' ? `<span class="chip pass">Pass</span>` : `<span class="chip bid">${S.acts[i]}</span>`;
      if (S.gphase === 'play' || S.gphase === 'done') chips += `<span class="chip tricks">${S.tricks[i]} won</span>`;
    }
    const cnt = S.counts ? S.counts[i] : 0;
    const backs = (i === 0 && me0()) || S.phase === 'lobby' ? '' : `<span class="backs"><span class="mini-back"></span>${cnt}</span>`;
    const tag = (p.bot ? '<span class="tag-bot">BOT</span>' : (!p.connected ? '<span class="tag-bot">AWAY</span>' : ''))
      + (p.voice ? `<span class="vmic" title="${p.voice.muted ? 'Mic off' : 'In voice chat'}">${p.voice.muted ? '🔇' : '🎙'}</span>` : '');
    const active = S.active === i && S.phase === 'game';
    const tmr = active && deadlineAt ? `<span class="tmr" data-tmr><i></i></span>` : '';
    const talking = p.voice && !p.voice.muted && (talkers.has(p.voice.sid) || (i === 0 && me0() && V.talking));
    html += `<div class="seat ${t} ${active ? 'active' : ''} ${talking ? 'speaking' : ''} ${!p.bot && !p.connected ? 'offline' : ''}" data-seat="${i}" style="left:${pos.x}%;top:${pos.y}%"><div class="s-name"><span class="dot"></span>${esc(i === 0 && me0() ? 'You' : p.name)}${tag}${backs ? ' ' : ''}${backs}</div><span class="s-role">${teamTag(i)}</span><div class="s-row">${chips}</div>${tmr}</div>`;
  }
  $('seats').innerHTML = html;
  tickTimers();
}
function renderHand() {
  const el = $('hand');
  if (!me0()) {
    el.innerHTML = ''; el.style.height = 'auto';
    if (S.phase === 'game' || S.phase === 'over') {
      const open = S.seats.map((p, i) => ({ p, i })).filter(x => x.p.bot);
      el.innerHTML = `<div class="watchbar">You're watching.${open.length ? ' Take a bot seat:' : ''} ${open.map(x => `<button data-take="${x.p.real}"><span class="pn ${tcls(x.i)}">${esc(x.p.name)}</span></button>`).join('')}</div>`;
    }
    return;
  }
  el.style.height = '';
  const hand = sortHand(S.hand || []), cw = sizeCards();
  const W = el.clientWidth, k = hand.length;
  const step = k > 1 ? Math.min(cw + 6, (W - cw) / (k - 1)) : 0;
  const start = (W - (cw + step * (k - 1))) / 2;
  const legal = S.ask && S.ask.kind === 'play' ? new Set(S.ask.legal) : null;
  el.classList.toggle('playing', !!legal);
  el.innerHTML = hand.map((c, i) => {
    const isNew = newIds && newIds.has(c.id);
    const cls = [legal && legal.has(c.id) ? 'legal' : '', selected === c.id ? 'sel' : '', isNew ? 'in' : ''].join(' ');
    return cardHTML(c, cls).replace('class="card', 'style="left:' + (start + i * step) + 'px;animation-delay:' + (isNew ? i * 25 : 0) + 'ms;z-index:' + i + '" class="card');
  }).join('');
  newIds = null;
}
let prevTW = null;
function renderTricks() {
  const el = $('tboard');
  if (!S.bid || !(S.gphase === 'play' || S.gphase === 'done')) { el.hidden = true; prevTW = null; return; }
  el.hidden = false;
  const bt = S.bid.seat % 2, req = need(), target = [0, 0]; target[bt] = req; target[1 - bt] = 14 - req;
  el.innerHTML = [0, 1].map(t => {
    const n = S.tricksWon[t], tgt = target[t];
    const pips = Array.from({ length: tgt }, (_, i) => `<span class="pip ${i < n ? 'on' : ''}"></span>`).join('');
    return `<div class="tb-team ${t === 0 ? 'ta' : 'tb'} ${prevTW && prevTW[t] !== n ? 'bump' : ''}"><span class="dot"></span><span class="tb-lbl">${teamName(t)}</span><span class="tb-num">${n}<small>/${tgt}</small></span><span class="pips">${pips}</span></div>`;
  }).join('');
  prevTW = S.tricksWon.slice();
}
function colourNames(t) {
  let out = esc(t);
  if (!S || !S.seats) return out;
  const map = {}; S.seats.forEach((p, i) => { map[i === 0 && me0() ? 'You' : p.name] = tcls(i); });
  const keys = Object.keys(map).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  if (!keys.length) return out;
  const re = new RegExp('\\b(' + keys.join('|') + ')\\b', 'g');
  return out.replace(re, m => `<span class="pn ${map[m]}">${m}</span>`);
}
function renderStatus() {
  if (S.phase === 'lobby') { $('stMain').textContent = 'Waiting for the host to start'; $('stLog').textContent = ''; return; }
  $('stMain').innerHTML = colourNames(S.main || '');
  $('stLog').innerHTML = (S.log || []).map(colourNames).join('  ·  ');
}
function renderTrickCards() {
  const box = $('trick');
  const trick = S.trick || [];
  const existing = [...box.querySelectorAll('.tcard')];
  if (!trick.length) {
    if (existing.length && sweepTo != null) {
      const wp = seatPos(sweepTo); sweepTo = null;
      existing.forEach(e => { e.style.left = wp.x + '%'; e.style.top = wp.y + '%'; e.classList.add('gone'); });
      setTimeout(() => existing.forEach(e => e.remove()), 380);
    } else existing.forEach(e => e.remove());
    return;
  }
  const have = new Set(existing.map(e => e.dataset.key));
  const want = new Set(trick.map(t => t.seat + '-' + t.card.id));
  existing.forEach(e => { if (!want.has(e.dataset.key)) e.remove(); });
  trick.forEach((t, idx) => {
    const key = t.seat + '-' + t.card.id;
    if (have.has(key)) { const e = box.querySelector(`[data-key="${key}"]`); const to = trickPos(t.seat); e.style.left = to.x + '%'; e.style.top = to.y + '%'; return; }
    const from = seatPos(t.seat), to = trickPos(t.seat);
    const wrap = document.createElement('div'); wrap.innerHTML = cardHTML(t.card, 'tcard');
    const el = wrap.firstChild; el.style.left = from.x + '%'; el.style.top = from.y + '%'; el.style.zIndex = idx + 1;
    el.dataset.seat = t.seat; el.dataset.key = key; box.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.left = to.x + '%'; el.style.top = to.y + '%'; }));
  });
}

/* ---------- panels ---------- */
function showPanel(title, html, onClick) {
  $('panelTitle').textContent = title; $('panelBody').innerHTML = html;
  $('panelBody').onclick = onClick; $('panel').hidden = false;
  const f = $('panelBody').querySelector('button'); if (f && !coarse) f.focus({ preventScroll: true });
}
function hidePanel() { $('panel').hidden = true; $('panelBody').onclick = null; }
function bidHistoryHTML() {
  if (!S.hist || !S.hist.length) return '';
  let out = '<div class="hist">';
  for (let r = 1; r <= 3; r++) {
    const rows = S.hist.filter(h => h.r === r); if (!rows.length) continue;
    out += `<div class="hist-row"><span class="hist-r">Round ${r}</span>`;
    out += rows.map(h => (h.v ? `<span class="hb">${pnShort(h.seat)} <b>${h.v}</b>${h.forced ? ' (forced)' : ''}</span>` : `<span class="hb pass">${pnShort(h.seat)} pass</span>`)).join('');
    const t = S.roundTrump && S.roundTrump[r];
    if (t) out += `<span class="hb trump ${RED(t.s) ? 'red' : ''}">${SYM[t.s]} ${SNAME[t.s]} · ${t.v} by ${pnShort(t.seat)}</span>`;
    out += '</div>';
  }
  return out + '</div>';
}
function renderAsk() {
  const a = S.ask;
  const key = a ? a.kind + ':' + (S.round || 0) + ':' + (S.hist ? S.hist.length : 0) + ':' + (S.trick ? S.trick.length : 0) : '';
  if (key && key !== lastAskKey) sfx('turn');
  lastAskKey = key;
  if (!a || a.kind === 'play') { hidePanel(); return; }
  const timer = `<div class="ptimer" data-tmr><i></i></div>`;
  if (a.kind === 'bid') {
    let html = timer + `<div class="panel-sub">${S.bid ? `Highest: <b>${S.bid.value}</b> by ${pn(S.bid.seat)}${S.trump ? ` · trump so far <b>${SNAME[S.trump]}</b>` : ''}` : 'No bids yet. Minimum is 6.'}${a.round === 1 ? ' Round 1 max is 7.' : ''}</div>` + bidHistoryHTML();
    if (a.options.length) html += '<div class="bid-grid">' + a.options.map(v => `<button class="chip-btn" data-v="${v}">${v}</button>`).join('') + '</div>';
    html += `<button class="pass-btn" data-v="0">Pass</button>`;
    showPanel(`Round ${a.round} · Your bid`, html, e => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      hidePanel(); send('act', { kind: 'bid', value: +b.dataset.v || null });
    });
  } else if (a.kind === 'trump') {
    const cnt = {}; SUITS.forEach(s => cnt[s] = (S.hand || []).filter(c => c.s === s).length);
    const html = timer + `<div class="panel-sub">${a.current ? `Trump is ${SYM[a.current]} ${SNAME[a.current]}. Keep it or change it.` : 'Pick the trump suit.'}</div><div class="suit-grid">` +
      SUITS.map(s => `<button class="suit-btn ${RED(s) ? 'red' : ''} ${a.current === s ? 'current' : ''}" data-s="${s}"><span class="big">${SYM[s]}</span><span>${SNAME[s]}</span><span class="cnt">${cnt[s]} in hand</span></button>`).join('') + '</div>';
    showPanel(`You hold the bid at ${a.bid}`, html, e => {
      const b = e.target.closest('button[data-s]'); if (!b) return;
      hidePanel(); send('act', { kind: 'trump', value: b.dataset.s });
    });
  }
  tickTimers();
}
function myTurnText() {
  const a = S.ask; if (!a || a.kind !== 'play') return null;
  const hand = S.hand || [], tip = coarse ? ' Tap a card twice to play.' : '';
  if (!S.leadSuit) return (hand.some(isJ) ? 'Your lead. Any card except the joker.' : 'Your lead. Play any card.') + tip;
  if (hand.some(c => c.s === S.leadSuit)) return `Your turn. Follow ${SYM[S.leadSuit]}.` + tip;
  return `Your turn. No ${SYM[S.leadSuit]}, play any card.` + tip;
}

/* ---------- timers ---------- */
function tickTimers() {
  const left = deadlineAt ? Math.max(0, deadlineAt - Date.now()) : 0;
  const frac = deadlineTotal ? left / deadlineTotal : 0;
  document.querySelectorAll('[data-tmr]').forEach(el => {
    const i = el.querySelector('i'); if (i) i.style.transform = `scaleX(${frac})`;
    el.classList.toggle('low', left < 5000);
  });
  const cd = document.querySelector('[data-countdown]');
  if (cd && S && S.result) { const ms = Math.max(0, resultAt - Date.now()); cd.textContent = Math.ceil(ms / 1000); }
}
setInterval(tickTimers, 250);
let resultAt = 0;

/* ---------- modals ---------- */
function openModal(kind, html) { modalKind = kind; $('sheet').innerHTML = html; $('modal').hidden = false; }
function closeModal() { modalKind = null; $('modal').hidden = true; }

function homeScreen(err) {
  openModal('home', `<div class="eyebrow">Team bidding card game</div>
    <h1 class="display">Rung<em>·</em>Bid</h1>
    <p>Play with friends on any phone. Create a table, share the link on WhatsApp, and bots fill any empty seats.</p>
    ${store.get('rb-tut-seen') ? '' : '<div class="tut-banner"><b>New to Rung Bid?</b><span>Learn the rules in 2 minutes with a hands-on tutorial.</span></div>'}
    <button class="secondary tut-open" id="tutBtn">${store.get('rb-tut-seen') ? 'How to play' : 'Start the tutorial'}</button>
    <div class="field"><span>Your name</span><input type="text" id="nameIn" maxlength="14" autocomplete="nickname" placeholder="e.g. Atif" value="${esc(myName)}"></div>
    <div class="field"><span>Players</span><div class="seg" id="segN">
      <button data-n="4">4<small>1 deck</small></button><button data-n="6">6<small>78 cards</small></button><button data-n="8">8<small>2 decks</small></button></div></div>
    <div class="field"><span>Mode</span><div class="seg text" id="segJ"><button data-j="0">Classic</button><button data-j="1">Joker mode</button></div></div>
    <div class="btn-col">
      <button class="primary" id="createBtn">Create table</button>
      <button class="secondary" id="practiceBtn">Practice with bots</button>
    </div>
    <div class="field" style="margin-top:16px"><span>Got a table code?</span><div class="row2"><input type="text" id="codeIn" maxlength="5" placeholder="ABCDE" autocapitalize="characters"><button class="secondary" id="joinBtn">Join</button></div></div>
    <div class="err" id="homeErr">${err ? esc(err) : ''}</div>
    <button class="linkbtn" id="rulesLink">Read the rules</button>`);
  $('tutBtn').onclick = () => { const v = $('nameIn').value.trim(); if (v) setName(v); openTutorial('home'); };
  const sync = () => {
    document.querySelectorAll('#segN button').forEach(b => b.classList.toggle('on', +b.dataset.n === homeN));
    document.querySelectorAll('#segJ button').forEach(b => b.classList.toggle('on', (b.dataset.j === '1') === homeJ));
  };
  sync();
  $('segN').onclick = e => { const b = e.target.closest('button'); if (b) { homeN = +b.dataset.n; sync(); } };
  $('segJ').onclick = e => { const b = e.target.closest('button'); if (b) { homeJ = b.dataset.j === '1'; sync(); } };
  const takeName = () => {
    const v = $('nameIn').value.trim();
    if (!v) { $('homeErr').textContent = 'Type your name first so friends know who you are.'; $('nameIn').focus(); return false; }
    setName(v); return true;
  };
  $('createBtn').onclick = () => { if (takeName()) createTable(false); };
  $('practiceBtn').onclick = () => { if (takeName()) createTable(true); };
  $('joinBtn').onclick = () => {
    const c = $('codeIn').value.trim().toUpperCase(); if (!c) return;
    if (takeName()) { tableCode = c; joinTable(); }
  };
  $('rulesLink').onclick = () => { $('rules').hidden = false; };
}
function nameScreen() {
  openModal('name', `<div class="eyebrow">You're invited</div>
    <h2>Join table ${esc(tableCode)}</h2>
    <p>Rung Bid is a team bidding card game. Type your name, then pick a seat.</p>
    <div class="field"><span>Your name</span><input type="text" id="nameIn" maxlength="14" autocomplete="nickname" placeholder="e.g. Atif" value="${esc(myName)}"></div>
    <button class="primary" id="goBtn">Join table</button>
    <div class="err" id="homeErr"></div>
    <button class="linkbtn" id="tutLink">New to Rung Bid? Take the 2 minute tutorial</button>`);
  $('tutLink').onclick = () => openTutorial('invite');
  const go = () => { const v = $('nameIn').value.trim(); if (!v) { $('homeErr').textContent = 'Type your name first.'; return; } setName(v); closeModal(); joinTable(); };
  $('goBtn').onclick = go;
  $('nameIn').onkeydown = e => { if (e.key === 'Enter') go(); };
}
function shareLink() { return location.origin + '/?t=' + S.code; }
function lobbyScreen() {
  const mySeat = S.seats.find((p, i) => i === 0 && me0());
  const ordered = S.seats.map((p, i) => ({ p, i })).sort((a, b) => a.p.real - b.p.real);
  const link = shareLink();
  const wa = 'https://wa.me/?text=' + encodeURIComponent(`Join my Rung Bid table (${S.n} players${S.joker ? ', Joker mode' : ''}): ${link}`);
  const seats = ordered.map(({ p, i }) => {
    const mine = i === 0 && me0();
    const team = S.spectator ? (i % 2 === 0 ? 'Orange team' : 'Blue team') : (i % 2 === 0 ? 'Your team' : 'Opponents');
    let act = '';
    if (mine) act = 'You · tap an empty seat to move';
    else if (p.bot) act = 'Empty · tap to sit';
    else act = p.connected ? 'Taken' : 'Away';
    return `<button class="seatbtn ${tcls(i)} ${mine ? 'mine' : ''}" data-sit="${p.real}" ${!p.bot && !mine ? 'disabled' : ''}>
      <span class="st">Seat ${p.real + 1} · ${team}</span>
      <span class="sn">${p.bot ? 'Bot' : esc(p.name)}${p.host ? ' ★' : ''}</span>
      <span class="act">${act}</span></button>`;
  }).join('');
  const watchers = S.lobbyNames.length ? `<p class="hint">Not seated yet: ${S.lobbyNames.map(esc).join(', ')}</p>` : '';
  openModal('lobby', `<div class="eyebrow">Table code</div>
    <div class="codebig">${esc(S.code)}</div>
    <p class="hint" style="margin-top:6px">${S.n} players · ${S.joker ? 'Joker mode' : 'Classic'} · teams sit alternately</p>
    <div class="share"><span class="link" id="linkTxt">${esc(link)}</span>
      <div class="btns"><button class="secondary" id="copyBtn">Copy link</button><a class="secondary" href="${wa}" target="_blank" rel="noopener">WhatsApp</a></div></div>
    <div class="eyebrow">Pick your seat</div>
    <div class="seatgrid" id="seatGrid">${seats}</div>
    ${watchers}
    ${S.isHost ? `<button class="primary" id="startBtn">Start game</button><p class="hint" style="margin-top:8px">Bots play any empty seat. Friends can still take a bot's seat after the game starts.</p>`
      : `<p class="hint">${me0() ? 'Waiting for the host (★) to start the game.' : 'Tap an empty seat to sit down.'}</p>`}
    <button class="linkbtn" id="leaveLobby">Leave table</button>`);
  $('seatGrid').onclick = e => { const b = e.target.closest('button[data-sit]'); if (!b || b.disabled) return; send('sit', +b.dataset.sit); };
  $('copyBtn').onclick = () => {
    const done = () => { $('copyBtn').textContent = 'Copied'; setTimeout(() => { const b = $('copyBtn'); if (b) b.textContent = 'Copy link'; }, 1500); };
    try { navigator.clipboard.writeText(link).then(done, () => selectLink()); } catch (e) { selectLink(); }
  };
  if ($('startBtn')) $('startBtn').onclick = () => { ac(); send('start'); };
  $('leaveLobby').onclick = leaveTable;
}
function selectLink() { const r = document.createRange(); r.selectNodeContents($('linkTxt')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function resultScreen() {
  const R = S.result;
  const you = R.winner === 0 && me0();
  const good = S.spectator ? '' : (R.winner === 0 ? 'good' : 'bad');
  const grid = `<div class="res-grid">
      <div><span>Contract</span><b>${esc(R.contract)} · ${esc(R.bidder)}</b></div>
      <div><span>Tricks</span><b>${teamName(0)} ${R.tricks[0]} · ${teamName(1)} ${R.tricks[1]}</b></div>
      <div><span>Points</span><b class="${good}">${teamName(R.winner)} +${R.pts}</b></div>
      <div><span>Score</span><b>${scoreText()}</b></div>
      <div><span>${teamName(0)} total won</span><b>${S.won[0]}</b></div>
      <div><span>${teamName(1)} total won</span><b>${S.won[1]}</b></div></div>`;
  if (S.phase === 'over' || R.over) {
    const w = (S.score || 0) > 0 ? 0 : 1;
    openModal('over', `<div class="eyebrow">Game over · ${S.handNo} hands</div><h2 class="${S.spectator ? '' : w === 0 ? 'good' : 'bad'}">${teamName(w)} ${sv(w, 'wins', 'win')}</h2>${grid}
      ${S.isHost ? '<button class="primary" id="againBtn">Play again</button>' : '<p class="hint">Waiting for the host to start a new game.</p>'}
      <button class="linkbtn" id="leaveOver">Leave table</button>`);
    if ($('againBtn')) $('againBtn').onclick = () => send('again');
    $('leaveOver').onclick = leaveTable;
    return;
  }
  resultAt = Date.now() + (R.endsAt || 0);
  openModal('result', `<div class="eyebrow">Hand ${R.handNo} result</div><h2 class="${good}">${colourNames(R.title)}</h2>${grid}
    <p>Next dealer: ${colourNames(R.next || '')}. Next hand in <b class="countdown" data-countdown>${Math.ceil((R.endsAt || 0) / 1000)}</b>s.</p>
    ${S.isHost ? '<button class="primary" id="nextBtn">Deal now</button>' : ''}`);
  if ($('nextBtn')) $('nextBtn').onclick = () => send('next');
}

/* ---------- main render ---------- */
function render() {
  if (!S) return;
  const handIds = new Set((S.hand || []).map(c => c.id));
  const added = [...handIds].filter(id => !prevHandIds.has(id));
  if (added.length && added.length < handIds.size + 1) newIds = new Set(added);
  prevHandIds = handIds;
  if (S.deadline) { deadlineAt = Date.now() + S.deadline; deadlineTotal = S.gphase === 'play' ? 30000 : 20000; } else deadlineAt = 0;
  if (!S.ask || S.ask.kind !== 'play') selected = null;

  renderTricks(); renderHeader(); renderSeats(); renderHand(); renderStatus(); renderTrickCards();
  const t = myTurnText() || (S.ask && S.ask.kind === 'bid' ? 'Your bid' : S.ask && S.ask.kind === 'trump' ? 'Call trump' : null);
  if (t) $('stMain').textContent = t;
  renderAsk();
  $('reacts').hidden = S.phase === 'lobby';
  $('reacts').classList.toggle('watching', !me0());

  if (S.phase === 'lobby') lobbyScreen();
  else if (S.phase === 'over' && S.result) { if (modalKind !== 'over' || shownHost !== S.isHost) { resultScreen(); shownHost = S.isHost; } }
  else if (S.result) { if (modalKind !== 'result' || shownHand !== S.result.handNo || shownHost !== S.isHost) { resultScreen(); shownHand = S.result.handNo; shownHost = S.isHost; } }
  else if (modalKind) closeModal();
}

/* ---------- effects ---------- */
function announce(eye, sym, name, sub, cls, ms = 1700) {
  const a = $('announce'); a.className = 'announce ' + cls;
  a.innerHTML = `<span class="an-eye">${eye}</span><span class="an-sym">${sym}</span><span class="an-name">${name}</span><span class="an-sub">${sub}</span>`;
  a.hidden = false; clearTimeout(announce.t); announce.t = setTimeout(() => { a.hidden = true; }, ms);
}
function showCut(seat, s, over) {
  const to = trickPos(seat), t = tcls(seat);
  const fx = document.createElement('div');
  fx.className = `cut-fx ${t}`; fx.style.left = to.x + '%'; fx.style.top = to.y + '%';
  fx.innerHTML = `<span class="cut-ring"></span><span class="cut-slash"></span><span class="cut-label ${RED(s) ? 'red' : ''}">${over ? 'OVER CUT' : 'CUT'} <b>${SYM[s]}</b></span>`;
  $('trick').appendChild(fx);
  const felt = document.querySelector('.felt'); felt.classList.remove('jolt'); void felt.offsetWidth; felt.classList.add('jolt');
  setTimeout(() => fx.remove(), 1400);
}
function showJoker(seat, cancel) {
  const to = trickPos(seat), t = tcls(seat);
  const fx = document.createElement('div');
  fx.className = `cut-fx jfx ${t}`; fx.style.left = to.x + '%'; fx.style.top = to.y + '%';
  fx.innerHTML = `<span class="cut-ring"></span><span class="cut-label jlabel">${cancel ? 'CANCELLED' : 'REVERSE ⇄'}</span>`;
  $('trick').appendChild(fx);
  const felt = document.querySelector('.felt'); felt.classList.remove('spin'); void felt.offsetWidth; felt.classList.add('spin');
  setTimeout(() => fx.remove(), 1500);
}
function onFx(f) {
  if (!S) return;
  switch (f.type) {
    case 'deal': sfx('deal'); break;
    case 'watch': toast(f.text); sfx('pop'); break;
    case 'bid': sfx('bid', f.v); break;
    case 'support': sfx('support'); break;
    case 'pass': sfx('pass'); break;
    case 'trump': sfx('trump'); announce('Trump', SYM[f.s], SNAME[f.s], colourNames(f.sub || ''), RED(f.s) ? 'red' : ''); break;
    case 'card': if (f.cut) { showCut(f.seat, f.s, f.over); sfx('cut'); } else sfx('card'); break;
    case 'joker': showJoker(f.seat, f.cancel); sfx('joker'); break;
    case 'trick': {
      const el = $('trick').querySelector(`[data-key="${f.showSeat}-${f.showId}"]`);
      if (el) el.classList.add('win', f.team === 0 ? 'ta' : 'tb');
      sweepTo = f.credit;
      sfx(f.team === 0 && me0() ? 'trickUs' : 'trickThem');
      break;
    }
    case 'stuck': sfx('lose'); announce('Stuck', '⇄', `${esc(nm(f.seat))} can't lead`, `${teamName(f.team)} take ${f.left} trick${f.left > 1 ? 's' : ''}`, 'jann', 2000); break;
    case 'handEnd': sfx(f.team === 0 && me0() ? 'win' : 'lose'); break;
    case 'react': {
      const pos = seatPos(f.seat); const d = document.createElement('div');
      d.className = 'react-pop'; d.textContent = f.emo; d.style.left = pos.x + '%'; d.style.top = pos.y + '%';
      $('table').appendChild(d); setTimeout(() => d.remove(), 1900); sfx('pop'); break;
    }
  }
}

/* ---------- input ---------- */
$('hand').addEventListener('click', e => {
  const take = e.target.closest('button[data-take]');
  if (take) { send('sit', +take.dataset.take); return; }
  const el = e.target.closest('.card'); if (!el || !S || !S.ask || S.ask.kind !== 'play') return;
  const id = +el.dataset.id;
  if (!S.ask.legal.includes(id)) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); return; }
  if (coarse && selected !== id) { selected = id; renderHand(); return; }
  selected = null;
  S.ask = null; renderHand();
  send('act', { kind: 'play', value: id });
});
const sock = io({ auth: { pid, name: myName || 'Player' }, autoConnect: false });
$('reacts').innerHTML = '<span class="voicectl" id="voiceCtl"></span><button class="vbtn chatbtn" id="chatBtn" aria-label="Open chat">💬<span class="lbl"> Chat</span><span class="cbadge" id="chatBadge" hidden></span></button>' + ['👏', '😂', '😮', '🔥', '😢', '🙏'].map(e => `<button data-r="${e}" aria-label="React ${e}">${e}</button>`).join('');
$('reacts').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.r) send('react', b.dataset.r);
  else if (b.id === 'chatBtn') openChat();
  else if (b.id === 'vJoin') voiceJoin();
  else if (b.id === 'vMute') voiceMute(!V.muted);
  else if (b.id === 'vLeave') voiceLeave(true);
};

/* ---------- voice chat (phone to phone audio; the server only passes connection messages) ---------- */
const V = { on: false, want: false, muted: false, stream: null, peers: new Map(), ice: [], me: null, talking: false, joining: false };
const talkers = new Set();
function renderVoice() {
  const el = $('voiceCtl'); if (!el) return;
  if (!V.on) el.innerHTML = `<button class="vbtn" id="vJoin" ${V.joining ? 'disabled' : ''}>${V.joining ? 'Connecting…' : '🎙 Voice'}</button>`;
  else el.innerHTML = `<button class="vbtn ${V.muted ? 'off' : 'live'}" id="vMute" aria-label="${V.muted ? 'Turn mic on' : 'Turn mic off'}">${V.muted ? '🔇 Mic off' : '🎙 Mic on'}</button><button class="vbtn" id="vLeave" aria-label="Leave voice chat">✕</button>`;
}
async function voiceJoin() {
  if (V.on || V.joining) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) { flash('Voice chat needs a newer browser.'); return; }
  V.joining = true; renderVoice();
  try { V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }); }
  catch (e) { V.joining = false; renderVoice(); flash('Microphone is blocked. Allow the mic for this site in your browser settings, then try again.'); return; }
  const r = await send('voice:join');
  V.joining = false;
  if (!r || !r.ok) { stopStream(); renderVoice(); return; }
  V.on = true; V.want = true; V.muted = false; V.ice = r.ice; V.me = r.me;
  startLevel();
  r.peers.forEach(id => makePeer(id));
  renderVoice();
}
function stopStream() { if (V.stream) V.stream.getTracks().forEach(t => t.stop()); V.stream = null; }
function closePeer(id) {
  const P = V.peers.get(id); if (!P) return;
  try { P.pc.close(); } catch (e) {}
  if (P.audio) { P.audio.srcObject = null; P.audio.remove(); }
  V.peers.delete(id); talkers.delete(id);
}
function voiceLeave(byUser) {
  if (byUser) V.want = false;
  if (V.on && sock.connected) send('voice:leave');
  [...V.peers.keys()].forEach(closePeer);
  stopStream(); stopLevel();
  V.on = false; V.muted = false; V.talking = false;
  renderVoice(); if (S) renderSeats();
}
function voiceMute(m) {
  V.muted = m;
  if (V.stream) V.stream.getAudioTracks().forEach(t => { t.enabled = !m; });
  send('voice:mute', m); renderVoice();
}
function makePeer(id) {
  if (V.peers.has(id)) return V.peers.get(id);
  const pc = new RTCPeerConnection({ iceServers: V.ice });
  const P = { pc, audio: null, polite: V.me > id, makingOffer: false, ignoreOffer: false };
  V.peers.set(id, P);
  V.stream.getTracks().forEach(t => {
    const sender = pc.addTrack(t, V.stream);
    // Speech-quality audio keeps relay data low
    try { const prm = sender.getParameters(); prm.encodings = prm.encodings && prm.encodings.length ? prm.encodings : [{}]; prm.encodings[0].maxBitrate = 32000; sender.setParameters(prm).catch(() => {}); } catch (e) {}
  });
  pc.onicecandidate = e => { if (e.candidate) sock.emit('voice:signal', { to: id, data: { c: e.candidate } }); };
  pc.ontrack = e => {
    if (!P.audio) { P.audio = document.createElement('audio'); P.audio.autoplay = true; P.audio.setAttribute('playsinline', ''); P.audio.hidden = true; document.body.appendChild(P.audio); }
    P.audio.srcObject = e.streams[0]; P.audio.play().catch(() => {});
  };
  pc.onnegotiationneeded = async () => {
    try { P.makingOffer = true; await pc.setLocalDescription(); sock.emit('voice:signal', { to: id, data: { d: pc.localDescription } }); }
    catch (e) {} finally { P.makingOffer = false; }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== 'failed') return;
    if (!P.retried && pc.restartIce) { P.retried = true; pc.restartIce(); return; }
    const seat = S && S.seats ? S.seats.find(x => x.voice && x.voice.sid === id) : null;
    toast(`Voice can't reach ${seat ? seat.name : 'a player'} on their network`);
  };
  return P;
}
sock.on('voice:signal', async ({ from, data }) => {
  if (!V.on || !data) return;
  const P = makePeer(from), pc = P.pc;
  try {
    if (data.d) {
      const collision = data.d.type === 'offer' && (P.makingOffer || pc.signalingState !== 'stable');
      P.ignoreOffer = !P.polite && collision;
      if (P.ignoreOffer) return;
      await pc.setRemoteDescription(data.d);
      if (data.d.type === 'offer') { await pc.setLocalDescription(); sock.emit('voice:signal', { to: from, data: { d: pc.localDescription } }); }
    } else if (data.c) {
      try { await pc.addIceCandidate(data.c); } catch (e) { if (!P.ignoreOffer) console.warn(e); }
    }
  } catch (e) { console.warn('voice', e); }
});
sock.on('voice:left', id => { closePeer(id); });
sock.on('voice:talk', ({ sid, on }) => { if (on) talkers.add(sid); else talkers.delete(sid); markTalkers(); });
function markTalkers() {
  if (!S || !S.seats) return;
  document.querySelectorAll('#seats .seat').forEach(el => {
    const i = +el.dataset.seat, p = S.seats[i];
    const t = p && p.voice && !p.voice.muted && (talkers.has(p.voice.sid) || (i === 0 && me0() && V.talking));
    el.classList.toggle('speaking', !!t);
  });
}
// Detect when I'm speaking (from my own mic only) and tell the table
let VAC = null, vTimer = null;
function startLevel() {
  try {
    VAC = VAC || new (window.AudioContext || window.webkitAudioContext)(); if (VAC.state === 'suspended') VAC.resume();
    const an = VAC.createAnalyser(); an.fftSize = 512; VAC.createMediaStreamSource(V.stream).connect(an);
    const buf = new Uint8Array(an.fftSize); let quietFor = 0;
    vTimer = setInterval(() => {
      an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      const loud = !V.muted && Math.sqrt(sum / buf.length) > 0.04;
      quietFor = loud ? 0 : quietFor + 1;
      const talking = loud || (V.talking && quietFor < 4);
      if (talking !== V.talking) { V.talking = talking; if (sock.connected) sock.emit('voice:talk', talking); markTalkers(); }
    }, 120);
  } catch (e) {}
}
function stopLevel() { clearInterval(vTimer); vTimer = null; if (V.talking && sock.connected) sock.emit('voice:talk', false); }
renderVoice();
/* ---------- text chat ---------- */
let chatMsgs = [], chatUnread = 0, chatOpen = false;
(function buildChat() {
  const d = document.createElement('div'); d.className = 'chatpanel'; d.id = 'chat'; d.hidden = true;
  d.innerHTML = `<div class="chat-head"><b>Table chat</b><button class="tut-x" id="chatClose" aria-label="Close chat">✕</button></div>
    <div class="chat-list" id="chatList"></div>
    <form class="chat-form" id="chatForm" autocomplete="off"><input type="text" id="chatIn" maxlength="200" placeholder="Type a message" aria-label="Message"><button class="primary" type="submit">Send</button></form>`;
  document.body.appendChild(d);
  $('chatClose').onclick = closeChat;
  $('chatForm').onsubmit = e => {
    e.preventDefault();
    const v = $('chatIn').value.trim(); if (!v) return;
    $('chatIn').value = '';
    send('chat', v);
  };
})();
function openChat() { chatOpen = true; chatUnread = 0; $('chat').hidden = false; renderChat(); if (!coarse) $('chatIn').focus(); }
function closeChat() { chatOpen = false; if ($('chat')) $('chat').hidden = true; }
function renderChat() {
  const b = $('chatBadge'); if (b) { b.hidden = !chatUnread; b.textContent = chatUnread > 9 ? '9+' : chatUnread; }
  if (!chatOpen) return;
  const list = $('chatList');
  list.innerHTML = chatMsgs.length ? chatMsgs.map(m => {
    const cls = m.seat == null ? 'aud' : tcls(m.seat);
    const who = m.seat == null && !m.mine ? `${esc(m.name)} <small>(audience)</small>` : esc(m.name);
    return `<div class="cmsg ${m.mine ? 'mine' : ''}"><span class="pn ${cls}">${who}</span> ${esc(m.text)}</div>`;
  }).join('') : '<p class="hint">No messages yet. Say hi to the table.</p>';
  list.scrollTop = list.scrollHeight;
}
async function loadChat() {
  const r = await send('chatHistory');
  if (r && r.ok) { chatMsgs = r.list; renderChat(); }
}
function chatBubble(m) {
  if (m.seat == null || !S || S.phase === 'lobby') return;
  const pos = seatPos(m.seat), d = document.createElement('div');
  d.className = 'chat-bubble ' + tcls(m.seat); d.textContent = m.text.length > 60 ? m.text.slice(0, 57) + '…' : m.text;
  d.style.left = pos.x + '%'; d.style.top = pos.y + '%';
  $('table').appendChild(d); setTimeout(() => d.remove(), 3600);
}
sock.on('chat', m => {
  chatMsgs.push(m); if (chatMsgs.length > 50) chatMsgs.shift();
  if (!chatOpen && !m.mine) { chatUnread++; sfx('pop'); }
  renderChat(); chatBubble(m);
});

/* ---------- connection ---------- */
function setName(v) { myName = v.slice(0, 14); store.set('rb-name', myName); sock.auth.name = myName; if (sock.connected) sock.emit('rename', myName); }
function send(ev, data) {
  return new Promise(res => {
    if (!sock.connected) { flash('Reconnecting… try again in a moment'); return res(null); }
    const cb = r => { if (r && r.error) flash(r.error); res(r); };
    if (data === undefined) sock.emit(ev, cb); else sock.emit(ev, data, cb);
  });
}
function toast(msg) {
  let t = $('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3500);
}
function flash(msg) { const c = $('conn'); c.innerHTML = esc(msg); c.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => { if (sock.connected) c.hidden = true; }, 2600); }
let waking = null;
function connecting() {
  const c = $('conn'); c.hidden = false;
  c.innerHTML = '<span class="spin"></span>Connecting…';
  clearTimeout(waking); waking = setTimeout(() => { if (!sock.connected) c.innerHTML = '<span class="spin"></span>Waking the game server. This can take up to a minute…'; }, 3500);
}
let awaitingCreate = false;
async function createTable(practice) {
  awaitingCreate = true;
  const r = await send('create', { n: homeN, joker: homeJ });
  awaitingCreate = false;
  if (!r || !r.ok) return;
  tableCode = r.code; history.replaceState(null, '', '/?t=' + r.code);
  if (practice) { ac(); send('start'); }
}
async function joinTable() {
  const r = await send('join', tableCode);
  if (r && r.ok) { history.replaceState(null, '', '/?t=' + r.code); if (V.want && !V.on) setTimeout(voiceJoin, 600); loadChat(); }
  else { tableCode = null; history.replaceState(null, '', '/'); S = null; homeScreen(r && r.error); }
}
function leaveTable() {
  voiceLeave(true); chatMsgs = []; chatUnread = 0; closeChat(); renderChat();
  send('leaveTable'); tableCode = null; S = null; history.replaceState(null, '', '/');
  $('trick').innerHTML = ''; hidePanel(); homeScreen();
  boot();
}
sock.on('connect', () => {
  clearTimeout(waking); $('conn').hidden = true;
  if (tableCode && myName) joinTable();
});
sock.on('disconnect', () => { connecting(); if (V.on) { const w = V.want; voiceLeave(false); V.want = w; } });
sock.on('connect_error', () => connecting());
sock.on('state', st => {
  if (awaitingCreate && !tableCode) tableCode = st.code;
  if (!tableCode || st.code !== tableCode) return;
  S = st; render();
});
sock.on('fx', f => onFx(f));

/* ---------- header buttons ---------- */
function syncSound() { $('soundBtn').classList.toggle('muted', muted); $('soundBtn').textContent = muted ? 'Sound off' : 'Sound'; }
$('soundBtn').onclick = () => { muted = !muted; store.set('rb-muted', muted ? '1' : '0'); syncSound(); if (!muted) sfx('turn'); };
syncSound();
$('rulesBtn').onclick = () => { $('rules').hidden = false; };
$('rulesClose').onclick = () => { $('rules').hidden = true; };
$('rulesTut').onclick = () => { $('rules').hidden = true; openTutorial(S ? 'game' : 'home'); };
window.tutorialPractice = () => {
  const inp = $('nameIn'), v = (inp && inp.value.trim()) || myName;
  if (v) { setName(v); createTable(true); }
  else if (inp) { $('homeErr').textContent = 'Type your name, then tap Practice with bots.'; inp.focus(); }
};
$('leaveBtn').onclick = () => {
  if (!S) { homeScreen(); return; }
  const b = $('leaveBtn');
  if (!leaveArmed) { leaveArmed = true; b.textContent = 'Tap to leave'; b.classList.add('leave-confirm'); setTimeout(() => { leaveArmed = false; b.textContent = 'Leave'; b.classList.remove('leave-confirm'); }, 3000); return; }
  leaveArmed = false; b.textContent = 'Leave'; b.classList.remove('leave-confirm'); leaveTable();
};
window.addEventListener('resize', () => { if (S) { renderHand(); renderSeats(); renderTrickCards(); } });
document.addEventListener('pointerdown', () => ac(), { once: true });

/* ---------- boot: a sample table behind the home screen ---------- */
function boot() {
  S = { n: 4, code: '', phase: 'demo', spectator: false, seats: [{ name: 'You', bot: false, connected: true, real: 0 }, { name: 'Sana', bot: true, real: 1 }, { name: 'Bilal', bot: true, real: 2 }, { name: 'Hira', bot: true, real: 3 }], score: 0, won: [0, 0], hand: [], counts: [5, 5, 5, 5], tricks: [0, 0, 0, 0], log: [], main: '', trick: [] };
  renderHeader(); renderSeats(); renderHand();
  $('stMain').textContent = 'Create a table or join one to play'; $('stLog').textContent = '';
  $('contract').innerHTML = '<div class="c1">Rung Bid</div><div class="c2">4, 6 or 8 players</div>';
  S = null;
}
boot();
if (tableCode) { if (myName) { connecting(); } else nameScreen(); }
else homeScreen();
sock.connect();
