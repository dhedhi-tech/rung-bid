/* Patta Party online client. The server runs the game; this page draws it and sends your moves. */
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
// A link opened from the "open in browser" help carries the player id, so the seat comes along
const urlPid = (new URLSearchParams(location.search).get('p') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
if (urlPid) { store.set('rb-pid', urlPid); }
const urlName = (new URLSearchParams(location.search).get('n') || '').slice(0, 14);
if (urlName && !store.get('rb-name')) store.set('rb-name', urlName);
let pid = store.get('rb-pid');
if (!pid) { pid = 'p' + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('rb-pid', pid); }
let myName = store.get('rb-name') || '';
let tableCode = (new URLSearchParams(location.search).get('t') || '').toUpperCase() || null;
let homeN = 4, homeJ = false, homeL = 10, homePub = true, homeCoach = true;
const limitName = l => (l === 6 ? 'Quick · 6 hands' : l === 10 ? 'Normal · 10 hands' : 'Full · no hand limit');

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
  joker() {
    // Missile: a falling whistle and rising whoosh, then a loud blast with a long rumble
    const c = ac(); if (!c) return;
    const t = c.currentTime, out = c.createDynamicsCompressor(), boost = c.createGain();
    out.threshold.value = -18; out.ratio.value = 6; out.attack.value = .002; out.release.value = .3; boost.gain.value = .9;
    out.connect(boost).connect(c.destination);
    const osc = (type, f0, f1, t0, dur, vol) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = type;
      o.frequency.setValueAtTime(f0, t + t0); o.frequency.exponentialRampToValueAtTime(f1, t + t0 + dur);
      g.gain.setValueAtTime(.0001, t + t0); g.gain.exponentialRampToValueAtTime(vol, t + t0 + Math.min(.08, dur / 3)); g.gain.exponentialRampToValueAtTime(.0001, t + t0 + dur);
      o.connect(g).connect(out); o.start(t + t0); o.stop(t + t0 + dur + .05);
    };
    const nz = (t0, dur, vol, type, f0, f1, attack = .01) => {
      const len = Math.ceil(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); src.buffer = buf; f.type = type; f.Q.value = .7;
      f.frequency.setValueAtTime(f0, t + t0); f.frequency.exponentialRampToValueAtTime(f1, t + t0 + dur);
      g.gain.setValueAtTime(.0001, t + t0); g.gain.exponentialRampToValueAtTime(vol, t + t0 + attack); g.gain.exponentialRampToValueAtTime(.0001, t + t0 + dur);
      src.connect(f).connect(g).connect(out); src.start(t + t0);
    };
    const hit = .75;
    osc('sine', 2200, 520, 0, hit, .22);                 // incoming whistle
    osc('triangle', 2210, 525, 0, hit, .08);             // slight wobble in the whistle
    nz(0, hit, .35, 'bandpass', 600, 3000, hit * .9);    // rising whoosh
    nz(hit, .12, 1.2, 'bandpass', 2400, 1200, .003);     // slap
    nz(hit, .06, .7, 'highpass', 5000, 3000, .002);      // crack
    osc('sine', 150, 32, hit, .9, .9);                   // boom
    osc('triangle', 70, 28, hit + .02, 1.6, .6);         // sub rumble
    nz(hit + .02, 2.0, 1, 'lowpass', 1400, 120, .02);    // blast rumble that fades out
    nz(hit + .3, 1.4, .25, 'bandpass', 900, 300, .05);   // debris
  },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .11, .35, { type: 'triangle', vol: .16 })); },
  lose() { [392, 349, 311, 262].forEach((f, i) => tone(f, i * .14, .35, { type: 'triangle', vol: .12 })); },
  pop() { tone(660, 0, .08, { vol: .08 }); },
  fanfare() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * .12, i === 6 ? .7 : .22, { type: 'triangle', vol: .16 })); [262, 392, 523].forEach(f => tone(f, .84, .9, { type: 'sine', vol: .07 })); },
};
// No game sounds from a tab or app that isn't on screen (e.g. an old table left open in WhatsApp's browser)
function sfx(name, ...a) { if (document.hidden) return; try { SFX[name](...a); } catch (e) {} }

const sockReady = []; // socket listeners registered once the connection object exists
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
// Round seats sit on the edge of the table, leaving the middle free for the cards
function seatHalfW() { const tw = ($('table') && $('table').clientWidth) || 800; return Math.min(45, Math.max(36, 50 - (36 / tw) * 100)); }
function seatPos(seat) { const a = seatAngle(seat); return { x: 50 + seatHalfW() * Math.cos(a), y: 50 + 44.5 * Math.sin(a) }; }
// Played cards sit close to the player who played them
function trickPos(seat) { const a = seatAngle(seat), rx = seatHalfW() - 15, ry = S.n === 4 ? 29 : 31; return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) }; }
let jokerN = 0;
const JOKER_SVG = '<svg class="j-art" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"> <defs> <radialGradient id="rBg_@" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f7f3ec"/><stop offset="1" stop-color="#e4ddd1"/></radialGradient> <radialGradient id="rFace_@" cx="50%" cy="62%" r="60%"><stop offset="0" stop-color="#f1e9dc"/><stop offset=".6" stop-color="#c9bfb1"/><stop offset="1" stop-color="#5b524a"/></radialGradient> <radialGradient id="rEye_@" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#000"/><stop offset=".7" stop-color="#1a1210" stop-opacity=".9"/><stop offset="1" stop-color="#3a302a" stop-opacity="0"/></radialGradient> <linearGradient id="rCoat_@" x1="0" x2="1"><stop offset="0" stop-color="#7a0f1c"/><stop offset=".35" stop-color="#1a0b0e"/><stop offset=".7" stop-color="#0b0607"/><stop offset="1" stop-color="#5a0a15"/></linearGradient> <linearGradient id="rLimb_@" x1="0" x2="1"><stop offset="0" stop-color="#8e1222"/><stop offset=".5" stop-color="#120809"/><stop offset="1" stop-color="#3d0710"/></linearGradient> <pattern id="rDia_@" width="6" height="8" patternUnits="userSpaceOnUse"><path d="M3 0 L6 4 L3 8 L0 4 Z" fill="#b3172a" opacity=".22"/></pattern> <filter id="rGrain_@" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .22 0"/><feComposite in2="SourceGraphic" operator="in"/></filter> <filter id="rGlow_@"><feGaussianBlur stdDeviation=".6"/></filter> </defs> <rect width="100" height="140" fill="url(#rBg_@)"/> <rect x="3" y="3" width="94" height="134" rx="6" fill="none" stroke="#b3172a" stroke-width="1.2"/> <rect x="6" y="6" width="88" height="128" rx="4" fill="none" stroke="#b3172a" stroke-width=".35" opacity=".45"/> <g id="rIdx_@" fill="#c81c30" font-family="Georgia,Times New Roman,serif" font-weight="700" font-size="6.4" text-anchor="middle"> <text x="11" y="15">J</text><text x="11" y="21.5">O</text><text x="11" y="28">K</text><text x="11" y="34.5">E</text><text x="11" y="41">R</text> </g> <use href="#rIdx_@" transform="rotate(180 50 70)"/> <ellipse cx="50" cy="124" rx="20" ry="2.5" fill="#000" opacity=".25"/> <path d="M46 92 L43 121 L45.5 121.5 L49 93 Z" fill="url(#rLimb_@)"/> <path d="M52 93 L55.5 121.5 L58 121 L55 92 Z" fill="url(#rLimb_@)"/> <path d="M45.5 121.5 Q38 124 33 120.5 Q37 121 43 120.5 Z" fill="#0d0708" stroke="#8e1222" stroke-width=".4"/> <path d="M55.5 121.5 Q63 124 68 120.5 Q63 121 57.5 120.5 Z" fill="#0d0708" stroke="#8e1222" stroke-width=".4"/> <path d="M41 56 Q50 52 59 56 L62 80 L64.5 98 L57 95 L54 99 L50 95 L46 99 L43 95 L35.5 98 L38 80 Z" fill="url(#rCoat_@)"/> <path d="M41 56 Q50 52 59 56 L62 80 L64.5 98 L57 95 L54 99 L50 95 L46 99 L43 95 L35.5 98 L38 80 Z" fill="url(#rDia_@)"/> <path d="M50 56 L50 95" stroke="#000" stroke-width=".5" opacity=".6"/> <path d="M41 56 L38 80 L35.5 98" fill="none" stroke="#d0283c" stroke-width=".35" opacity=".8"/> <path d="M41.5 58 Q35 70 34 86" fill="none" stroke="url(#rLimb_@)" stroke-width="3" stroke-linecap="round"/> <path d="M34 86 q-1.2 4 -1.6 7.5 M34.6 86.4 q-.2 4.2 -.4 8 M35.3 86.4 q.6 3.8 .8 7.2 M33.4 85.8 q-2 2.4 -2.8 4.8" stroke="#d9cfc0" stroke-width=".7" fill="none" stroke-linecap="round"/> <path d="M58.5 58 Q67 64 68 52 Q68.5 46 66 42" fill="none" stroke="url(#rLimb_@)" stroke-width="3" stroke-linecap="round"/> <g transform="translate(66 36) rotate(14)"><rect x="-4" y="-6" width="8" height="11.5" rx=".8" fill="#e6dccb"/><rect x="-3.2" y="-5.2" width="6.4" height="9.9" rx=".5" fill="none" stroke="#b3172a" stroke-width=".3"/><path d="M0 -2.2 l2 2.6 l-2 2.6 l-2 -2.6 Z" fill="#b3172a"/></g> <path d="M65.5 42.5 q-1.8 -1.5 -2.4 -4.5 M66.4 42 q-.8 -2.4 -.6 -5.4 M67.2 42.2 q.4 -2.4 1 -4.8 M64.8 43.2 q-2.4 0 -3.4 -1.4" stroke="#d9cfc0" stroke-width=".7" fill="none" stroke-linecap="round"/> <path d="M39 57 L36 50 L42 54 L44 47.5 L47 53 L50 48 L53 53 L56 47.5 L58 54 L64 50 L61 57 Q50 60 39 57 Z" fill="#100809" stroke="#b3172a" stroke-width=".45"/> <path d="M43 40 Q43 52 50 54.5 Q57 52 57 40 Q57 31 50 31 Q43 31 43 40 Z" fill="url(#rFace_@)"/> <path d="M43.5 41 Q45 49 47 51" fill="none" stroke="#5b524a" stroke-width=".5" opacity=".7"/> <path d="M56.5 41 Q55 49 53 51" fill="none" stroke="#5b524a" stroke-width=".5" opacity=".7"/> <ellipse cx="46.6" cy="40.6" rx="2.6" ry="2" fill="url(#rEye_@)"/> <ellipse cx="53.4" cy="40.6" rx="2.6" ry="2" fill="url(#rEye_@)"/> <circle cx="47.2" cy="40.8" r=".7" fill="#ff2a40" filter="url(#rGlow_@)"/><circle cx="47.2" cy="40.8" r=".35" fill="#ffb3bc"/> <circle cx="54" cy="40.8" r=".7" fill="#ff2a40" filter="url(#rGlow_@)"/><circle cx="54" cy="40.8" r=".35" fill="#ffb3bc"/> <path d="M44 38 Q46.5 37.6 48.6 39.2 M56 38 Q53.5 37.6 51.4 39.2" stroke="#2a201c" stroke-width=".55" fill="none"/> <path d="M43.6 44.8 Q50 52.6 56.4 44.8 Q53.5 48.6 50 48.9 Q46.5 48.6 43.6 44.8 Z" fill="#0a0506"/> <path d="M44.6 45.9 Q50 51.3 55.4 45.9 Q53 47.9 50 48.1 Q47 47.9 44.6 45.9 Z" fill="#d8d0c2"/> <path d="M45.6 46.7 v1 M46.6 47.3 v1.1 M47.7 47.8 v1.1 M48.8 48 v1.1 M50 48.1 v1.1 M51.2 48 v1.1 M52.3 47.8 v1.1 M53.4 47.3 v1.1 M54.4 46.7 v1" stroke="#2a1d1a" stroke-width=".28"/> <path d="M45.2 49 Q50 51.4 54.8 49" stroke="#0a0506" stroke-width=".35" fill="none"/> <path d="M43.6 44.8 q-.9 -.4 -1.3 -1.4 M56.4 44.8 q.9 -.4 1.3 -1.4" stroke="#3a2f2a" stroke-width=".45" fill="none"/> <path d="M42.5 36 Q48 29 50 30 Q52 29 57.5 36 Q56 33 50 32.4 Q44 33 42.5 36 Z" fill="#0c0607"/> <path d="M43 35 Q36 30 33 22 Q31 17 27 19 Q31 19 31.5 25 Q33 32 42 37 Z" fill="#7d0e1b" stroke="#c81c30" stroke-width=".3"/> <path d="M47 32 Q46 22 50 14 Q53 9 56 12 Q52 12 52 20 Q52 26 53 32 Z" fill="#0d0708" stroke="#7d0e1b" stroke-width=".4"/> <path d="M57 35 Q64 30 67 22 Q69 17 73 19 Q69 19 68.5 25 Q67 32 58 37 Z" fill="#120809" stroke="#c81c30" stroke-width=".3"/> <circle cx="27" cy="19.3" r="1.3" fill="#6e6458"/><circle cx="56" cy="12" r="1.3" fill="#6e6458"/><circle cx="73" cy="19.3" r="1.3" fill="#6e6458"/> <rect width="100" height="140" filter="url(#rGrain_@)" opacity=".3"/> </svg>';
const jokerArt = () => JOKER_SVG.replace(/_@/g, '_' + (++jokerN));
function cardHTML(c, extra = '') {
  if (isJ(c)) return `<div class="card joker ${extra}" data-id="${c.id}">${jokerArt()}</div>`;
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
  const hn = !S.handNo ? '' : S.decider ? 'Decider hand' : S.limit ? `Hand ${S.handNo} of ${S.limit}` : `Hand ${S.handNo}`;
  $('handNo').innerHTML = esc(S.handNo ? `${hn} · ${S.n} players` : `Table ${S.code} · ${S.n} players`) + watching;
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
    const backs = ''; // card counts removed: not needed
    const tag = (p.bot ? '<span class="tag-bot">BOT</span>' : (!p.connected ? '<span class="tag-bot">AWAY</span>' : ''))
      + (p.lvl ? `<span class="lvl-badge" title="Level ${p.lvl}">${p.lvl}</span>` : '')
      + (p.voice ? `<span class="vmic" title="${p.voice.muted ? 'Mic off' : 'In voice chat'}">${p.voice.muted ? '🔇' : '🎙'}</span>` : '');
    const active = S.active === i && S.phase === 'game';
    const tmr = active && deadlineAt ? `<span class="tmr" data-tmr><i></i></span>` : '';
    const talking = p.voice && !p.voice.muted && (talkers.has(p.voice.sid) || (i === 0 && me0() && V.talking));
    const bidding = active && (S.gphase === 'bid' || S.gphase === 'trump');
    const spot = S.bid && S.bid.seat === i && S.gphase === 'play';
    const pic = p.av ? avatarHTML({ name: p.name, av: p.av }, 's-av') : '<span class="dot"></span>';
    {
      // Small round picture with the name only. Tap it for details.
      let badge = '';
      if (S.phase !== 'lobby') {
        if (S.bid && S.bid.seat === i) badge = `<span class="cb holder ${t}">${S.bid.value}${S.trump ? SYM[S.trump] : ''}</span>`;
        else if (S.gphase === 'bid' && S.acts && S.acts[i] !== undefined) badge = S.acts[i] === 'Pass' ? `<span class="cb pass">–</span>` : `<span class="cb bid">${S.acts[i]}</span>`;
      }
      const won = (S.gphase === 'play' || S.gphase === 'done') && S.tricks[i] ? `<span class="cb won">${S.tricks[i]}</span>` : '';
      const dealer = S.phase !== 'lobby' && i === S.dealer ? `<span class="cb dealer">D</span>` : '';
      const who = p.bot ? `<span class="cb who" title="Bot">🤖</span>` : !p.connected ? `<span class="cb who away" title="Away">💤</span>` : '';
      const face = p.av ? avatarHTML({ name: p.name, av: p.av }, 'c-av') : `<span class="avatar c-av">${esc((i === 0 && me0() ? 'You' : p.name)[0].toUpperCase())}</span>`;
      html += `<div class="seat compact ${t} ${active ? 'active' : ''} ${bidding ? 'bidding' : ''} ${spot ? 'spot' : ''} ${talking ? 'speaking' : ''} ${!p.bot && !p.connected ? 'offline' : ''}" data-seat="${i}" data-real="${p.real}" style="left:${pos.x}%;top:${pos.y}%">${spot ? '<span class="spot-light"></span>' : ''}<span class="c-face">${face}${badge}${dealer}${won}${who}</span><span class="c-name">${esc(i === 0 && me0() ? 'You' : p.name)}</span>${tmr}</div>`;
      continue;
    }
    html += `<div class="seat ${t} ${active ? 'active' : ''} ${bidding ? 'bidding' : ''} ${spot ? 'spot' : ''} ${talking ? 'speaking' : ''} ${!p.bot && !p.connected ? 'offline' : ''}" data-seat="${i}" data-real="${p.real}" style="left:${pos.x}%;top:${pos.y}%;transform-origin:${pos.x < 30 ? 'left' : pos.x > 70 ? 'right' : 'center'} ${pos.y < 30 ? 'top' : pos.y > 70 ? 'bottom' : 'center'}">${spot ? '<span class="spot-light"></span>' : ''}<div class="s-name">${pic}${esc(i === 0 && me0() ? 'You' : p.name)}${tag}${backs ? ' ' : ''}${backs}</div><span class="s-role">${teamTag(i)}</span><div class="s-row">${chips}</div>${tmr}</div>`;
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
      if (S.dup) { el.innerHTML = `<div class="watchbar"><b>${esc(S.dup.name)}</b> is away. Is that you? <button id="dupClaim">Yes, play here</button></div>`; $('dupClaim').onclick = () => send('claim'); return; }
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
  const bids = (S.hist || []).filter(h => h.v); // only bids and raises, not passes
  if (!bids.length) return '';
  let out = '<div class="hist">';
  for (let r = 1; r <= 3; r++) {
    const rows = bids.filter(h => h.r === r); if (!rows.length) continue;
    out += `<div class="hist-row"><span class="hist-r">Round ${r}</span>`;
    out += rows.map(h => `<span class="hb">${pnShort(h.seat)} <b>${h.v}</b>${h.forced ? ' (forced)' : ''}</span>`).join('');
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

/* ---------- welcome screen ---------- */
function homeScreen(err) { welcomeScreen(err); }
function welcomeScreen(err) {
  closeModal();
  let w = $('welcome');
  if (!w) { w = document.createElement('div'); w.id = 'welcome'; w.className = 'welcome'; document.body.appendChild(w); }
  const fan = [{ r: 14, s: 'S' }, { r: 13, s: 'H' }, { r: 12, s: 'C' }, { r: 11, s: 'D' }, { r: 10, s: 'S' }]
    .map((c, i) => `<div class="wfan-card" style="--i:${i - 2}">${cardHTML({ ...c, id: 'w' + i })}</div>`).join('');
  const firstTime = !store.get('rb-tut-seen');
  w.innerHTML = `<div class="wtop"><div id="wChip"></div></div>
    <div class="whero">
      <div class="wfan">${fan}</div>
      <h1 class="wlogo">Patta<em>·</em>Party</h1>
      <p class="wtag">The team bidding card game for 4, 6 or 8 players</p>
    </div>
    <div class="wmenu">
      ${firstTime ? '<div class="tut-banner"><b>New to Patta Party?</b><span>Learn the rules in 2 minutes with a hands-on tutorial.</span></div>' : ''}
      <button class="primary" id="wPlay">Play with friends</button>
      <button class="secondary" id="wPractice">Practice with bots</button>
      <div class="wrow"><button class="secondary" id="wJoin">Join with a code</button><button class="secondary" id="wTut">${firstTime ? 'Tutorial' : 'How to play'}</button></div>
      <button class="secondary" id="wLb">🏆 Leaderboard</button>
      <div id="wRooms" class="wrooms"></div>
      <div class="err" id="wErr">${err ? esc(err) : ''}</div>
      <div class="wlegal"><a href="/privacy">Privacy Policy</a><span>·</span><a href="/terms">Terms of Use</a></div>
    </div>`;
  w.hidden = false;
  $('wPlay').onclick = () => createSheet(false);
  $('wPractice').onclick = () => createSheet(true);
  $('wJoin').onclick = joinSheet;
  $('wTut').onclick = () => openTutorial('home');
  $('wLb').onclick = () => lbSheet('xp');
  renderChip();
  loadRooms();
}
// Open tables: public tables with a free seat, refreshed while the home screen is showing
let roomsTimer = null, autoSeat = false;
async function loadRooms() {
  clearTimeout(roomsTimer);
  const w = $('welcome'), box = $('wRooms');
  if (!w || w.hidden || !box || S) return;
  if (sock.connected) {
    const r = await new Promise(res => sock.emit('rooms', res));
    if (r && r.ok && $('wRooms')) renderRooms(r.list || []);
  }
  roomsTimer = setTimeout(loadRooms, 5000);
}
function renderRooms(list) {
  const box = $('wRooms');
  if (!list.length) { box.innerHTML = ''; return; }
  const mine = list.filter(r => r.mine), open = list.filter(r => !r.mine);
  const item = r => `<button class="wroom ${r.mine ? 'mine' : ''}" data-code="${esc(r.code)}">
      <span class="wr-main"><b>${esc(r.host)}'s table</b>
        <span class="wr-tags"><i class="${r.joker ? 'jk' : ''}">${r.joker ? '🃏 Joker' : 'No Joker'}</i><i>${r.n} players</i><i>${r.limit === 6 ? 'Quick · 6 hands' : r.limit === 10 ? 'Normal · 10 hands' : 'Full game'}</i></span>
        <span>${r.playing ? `Playing, hand ${r.hand}${r.limit ? ' of ' + r.limit : ''}` : 'Waiting to start'}${r.names && r.names.length ? ` · with ${r.names.map(esc).join(', ')}` : ''}</span></span>
      ${r.mine ? '' : `<span class="wr-free">${r.free} seat${r.free > 1 ? 's' : ''} free</span>`}<span class="wr-go">${r.mine ? 'Continue' : 'Join'}</span></button>`;
  box.innerHTML = (mine.length ? `<div class="wr-head">Your game</div>` + mine.map(item).join('') : '') + (open.length ? `<div class="wr-head">Open tables</div>` + open.map(item).join('') : '');
  box.querySelectorAll('.wroom').forEach(b => b.onclick = () => joinRoom(b.dataset.code, b.classList.contains('mine') ? 'auto' : 'watch'));
}
function joinRoom(code, how) {
  ac(); tableCode = code; autoSeat = how || false; clearTimeout(roomsTimer);
  if (myName || PROFILE) joinTable();
  else { invitePending = true; nameScreen(); }
}
function hideWelcome() { const w = $('welcome'); if (w) w.hidden = true; }
function nameField() { return `<div class="field"><span>Your name</span><input type="text" id="nameIn" maxlength="14" autocomplete="nickname" placeholder="e.g. Atif" value="${esc(myName)}"></div>`; }
function takeName() {
  const v = $('nameIn').value.trim();
  if (!v) { $('homeErr').textContent = 'Type your name first so friends know who you are.'; $('nameIn').focus(); return false; }
  setName(v); return true;
}
function createSheet(practice) {
  openModal('create', `<div class="eyebrow">${practice ? 'Practice with bots' : 'New table'}</div>
    <h2>${practice ? 'Set up a practice game' : 'Create a table'}</h2>
    ${nameField()}
    <div class="field"><span>Players</span><div class="seg" id="segN">
      <button data-n="4">4<small>1 deck</small></button><button data-n="6">6<small>78 cards</small></button><button data-n="8">8<small>2 decks</small></button></div></div>
    <div class="field"><span>Mode</span><div class="seg text" id="segJ"><button data-j="0">Classic</button><button data-j="1">Joker mode</button></div></div>
    <div class="field"><span>Game length</span><div class="seg" id="segL">
      <button data-l="6">Quick<small>6 hands</small></button><button data-l="10">Normal<small>10 hands</small></button><button data-l="0">Full<small>no limit</small></button></div></div>
    ${practice ? '<div class="field"><span>Coach tips</span><div class="seg text" id="segC"><button data-c="1">On</button><button data-c="0">Off</button></div></div>' : ''}
    <div class="field"><span>Who can join</span><div class="seg text" id="segP"><button data-p="1">Anyone</button><button data-p="0">Only with link</button></div></div>
    <button class="primary" id="goCreate">${practice ? 'Start practice' : 'Create table'}</button>
    <div class="err" id="homeErr"></div>
    <button class="linkbtn" id="backHome">Back</button>`);
  const sync = () => {
    document.querySelectorAll('#segN button').forEach(b => b.classList.toggle('on', +b.dataset.n === homeN));
    document.querySelectorAll('#segJ button').forEach(b => b.classList.toggle('on', (b.dataset.j === '1') === homeJ));
    document.querySelectorAll('#segL button').forEach(b => b.classList.toggle('on', +b.dataset.l === homeL));
    document.querySelectorAll('#segP button').forEach(b => b.classList.toggle('on', (b.dataset.p === '1') === homePub));
    document.querySelectorAll('#segC button').forEach(b => b.classList.toggle('on', (b.dataset.c === '1') === homeCoach));
  };
  homePub = !practice;
  homeCoach = !store.get('rb-coached'); // on until the player has finished one guided hand
  if ($('segC')) $('segC').onclick = e => { const b = e.target.closest('button'); if (b) { homeCoach = b.dataset.c === '1'; sync(); } };
  sync();
  $('segP').onclick = e => { const b = e.target.closest('button'); if (b) { homePub = b.dataset.p === '1'; sync(); } };
  $('segN').onclick = e => { const b = e.target.closest('button'); if (b) { homeN = +b.dataset.n; sync(); } };
  $('segJ').onclick = e => { const b = e.target.closest('button'); if (b) { homeJ = b.dataset.j === '1'; sync(); } };
  $('segL').onclick = e => { const b = e.target.closest('button'); if (b) { homeL = +b.dataset.l; sync(); } };
  $('goCreate').onclick = () => { if (takeName()) { ac(); createTable(practice); } };
  $('backHome').onclick = closeModal;
}
function joinSheet() {
  openModal('join', `<div class="eyebrow">Join a table</div><h2>Got a table code?</h2>
    ${nameField()}
    <div class="field"><span>Table code</span><input type="text" id="codeIn" maxlength="5" placeholder="ABCDE" autocapitalize="characters"></div>
    <button class="primary" id="goJoin">Join table</button>
    <div class="err" id="homeErr"></div>
    <button class="linkbtn" id="backHome">Back</button>`);
  $('goJoin').onclick = () => {
    const c = $('codeIn').value.trim().toUpperCase();
    if (!c) { $('homeErr').textContent = 'Type the 5 letter table code.'; return; }
    if (takeName()) { tableCode = c; closeModal(); joinTable(); }
  };
  $('backHome').onclick = closeModal;
}

/* ---------- accounts: sign in, profile, levels, coins ---------- */
let FRQ = 0; // friend requests waiting
let AUTH = { auth: false }, PROFILE = null, sbClient = null, sbToken = null;
// Running inside the Patta Party Android app (the app adds "PattaPartyApp" to the user agent)
const NATIVE_APP = /PattaPartyApp/.test(navigator.userAgent || '');
const APP_AUTH_URL = 'com.dhedhitech.pattaparty://auth';
const capPlugin = n => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[n]) || null;
// Google blocks sign-in inside app webviews, so the app signs in through the phone's browser and comes back with a code
async function appAuthReturn(url) {
  if (!url || url.indexOf(APP_AUTH_URL) !== 0 || !sbClient) return;
  const B = capPlugin('Browser'); if (B) { try { await B.close(); } catch (e) {} }
  const code = new URL(url).searchParams.get('code');
  if (!code) return;
  const { data, error } = await sbClient.auth.exchangeCodeForSession(code);
  if (error) { flash('Sign-in did not finish. Please try again.'); return; }
  setToken(data.session ? data.session.access_token : null);
}
function initAppAuth() {
  const A = capPlugin('App'); if (!A) return;
  A.addListener('appUrlOpen', e => appAuthReturn(e && e.url));
  if (A.getLaunchUrl) A.getLaunchUrl().then(r => appAuthReturn(r && r.url)).catch(() => {});
}
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
function loadScript(src) { return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); }
async function initAuth() {
  try { AUTH = await (await fetch('/config')).json(); } catch (e) { AUTH = { auth: false }; }
  renderChip();
  if (AUTH.supabaseUrl) {
    try {
      await loadScript(SUPABASE_JS);
      sbClient = window.supabase.createClient(AUTH.supabaseUrl, AUTH.anonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } });
      sbClient.auth.onAuthStateChange((_ev, sess) => setToken(sess ? sess.access_token : null));
      const { data } = await sbClient.auth.getSession();
      setToken(data.session ? data.session.access_token : null);
      if (NATIVE_APP) initAppAuth();
    } catch (e) { console.warn('auth', e); }
  } else if (AUTH.dev && store.get('rb-dev')) authNow();
}
function setToken(t) {
  if (t === sbToken) return;
  sbToken = t;
  if (t) authNow(); else { PROFILE = null; applyFelt(); renderChip(); }
}
async function authNow() {
  if (!sock.connected) return;
  let r = null;
  if (sbToken) r = await send('auth', sbToken);
  else if (AUTH.dev && store.get('rb-dev')) r = await send('devLogin', store.get('rb-dev'));
  if (r && r.ok) gotProfile(r.profile, r.daily);
}
function gotProfile(p, daily) {
  PROFILE = p;
  if (!myName && p.name) setName(p.name.split(' ')[0]);
  applyFelt(); renderChip();
  if (modalKind === 'profile') profileSheet();
  // Signed in from the invite popup: go straight to the table
  if (invitePending) { invitePending = false; if (modalKind === 'name') closeModal(); if (tableCode && !S) joinTable(); }
  else if (tableCode && !S && sock.connected && modalKind !== 'name') joinTable();
  if (daily) setTimeout(() => gainToast(`Daily reward · +${daily} coins`), 600);
}
function signIn() {
  if (AUTH.dev && !sbClient) {
    openModal('devlogin', `<div class="eyebrow">Test sign-in</div><h2>Sign in (test mode)</h2>${nameField()}<button class="primary" id="goDev">Sign in</button><div class="err" id="homeErr"></div>`);
    $('goDev').onclick = () => { if (takeName()) { store.set('rb-dev', myName); closeModal(); authNow(); } };
    return;
  }
  if (!sbClient) { flash('Sign-in is not set up yet.'); return; }
  if (NATIVE_APP && capPlugin('Browser')) {
    sbClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: APP_AUTH_URL, skipBrowserRedirect: true } })
      .then(({ data }) => { if (data && data.url) capPlugin('Browser').open({ url: data.url }); else flash('Sign-in could not start. Please try again.'); });
    return;
  }
  if (inApp) { openInBrowserHelp('Google sign-in'); return; }
  sbClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' + location.search } });
}
async function signOut() {
  if (sbClient) { try { await sbClient.auth.signOut(); } catch (e) {} }
  store.set('rb-dev', ''); sbToken = null; PROFILE = null;
  send('signout'); applyFelt(); renderChip(); closeModal();
}
function avatarHTML(p, cls = '') {
  const av = p.av;
  if (av && av.e) return `<span class="avatar emo ${cls}">${esc(av.e)}</span>`;
  if (av && av.u) return `<img class="avatar ${cls}" src="${esc(av.u)}" alt="" referrerpolicy="no-referrer">`;
  if (p.av === null) return `<span class="avatar ${cls}">${esc((p.name || '?')[0].toUpperCase())}</span>`;
  return p.avatar ? `<img class="avatar ${cls}" src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar ${cls}">${esc((p.name || '?')[0].toUpperCase())}</span>`;
}
function renderChip() {
  renderInvAuth();
  const el = $('wChip'); if (!el) return;
  if (PROFILE) {
    const pct = Math.round(100 * PROFILE.levelXp / PROFILE.levelNeed);
    el.innerHTML = `<button class="pchip" id="pchip">${avatarHTML(PROFILE)}<span class="pc-text"><b>${esc(PROFILE.name)}</b><span class="pc-lvl">Level ${PROFILE.level}<i style="--p:${pct}%"></i></span></span><span class="pc-coins">● ${PROFILE.coins}</span>${FRQ ? `<span class="fr-badge">${FRQ}</span>` : ''}</button>`;
    $('pchip').onclick = profileSheet;
  } else if (AUTH.auth) {
    el.innerHTML = `<button class="gbtn" id="gSignIn"><svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Sign in with Google</button>
      <span class="gnote">Save your level, coins and stats</span>`;
    $('gSignIn').onclick = signIn;
  } else el.innerHTML = '';
}
function profileSheet() {
  if (!PROFILE) return;
  const P = PROFILE, pct = Math.round(100 * P.levelXp / P.levelNeed);
  const rate = P.games ? Math.round(100 * P.wins / P.games) + '%' : '–';
  const store_ = P.store.map(it => {
    const on = P.equipped && P.equipped.felt === it.id;
    const btn = on ? '<span class="st-on">In use</span>' : it.owned ? `<button class="secondary st-btn" data-equip="${it.id}">Use</button>`
      : it.locked ? `<span class="st-lock">Level ${it.level}</span>` : `<button class="secondary st-btn" data-buy="${it.id}"><span class="coin">●</span> ${it.price}</button>`;
    return `<div class="st-item"><span class="swatch" data-sw="${it.id}"></span><span class="st-name">${esc(it.name)}</span>${btn}</div>`;
  }).join('');
  openModal('profile', `<div class="prof-head"><button class="av-edit" id="avEdit" aria-label="Change picture">${avatarHTML(P, 'big')}<span>Change</span></button><div><h2>${esc(P.name)}</h2><span class="pc-coins">● ${P.coins} coins</span></div></div>
    <div class="lvlbar"><div class="lvl-top"><b>Level ${P.level}</b><span>${P.levelXp} / ${P.levelNeed} XP</span></div><div class="lvl-track"><i style="width:${pct}%"></i></div></div>
    <div class="res-grid">
      <div><span>Games</span><b>${P.games}</b></div><div><span>Wins</span><b>${P.wins} · ${rate}</b></div>
      <div><span>Hands played</span><b>${P.hands}</b></div><div><span>Bids made</span><b>${P.bidsMade} / ${P.bidsTotal}</b></div>
      <div><span>Sweeps & whitewashes</span><b>${P.sweeps}</b></div><div><span>Total XP</span><b>${P.xp}</b></div>
    </div>
    <div class="eyebrow">Table themes</div>
    <div class="store" id="storeList">${store_}</div>
    <p class="hint">Earn XP every hand and coins for every game. Bigger wins earn more.</p>
    <button class="secondary fr-open" id="frOpen">👥 Friends${FRQ ? ` <span class="fr-badge in">${FRQ} new</span>` : ''}</button>
    <button class="primary" id="profClose">Done</button>
    <button class="linkbtn" id="signOutBtn">Sign out</button>`);
  $('profClose').onclick = closeModal;
  $('signOutBtn').onclick = signOut;
  $('avEdit').onclick = picSheet;
  $('frOpen').onclick = () => friendsSheet('profile');
  $('storeList').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const r = b.dataset.buy ? await send('buy', b.dataset.buy) : await send('equip', b.dataset.equip);
    if (r && r.ok) { PROFILE = r.profile; applyFelt(); renderChip(); profileSheet(); if (b.dataset.buy) sfx('win'); }
  };
}
// Choose a profile picture: Google photo, a ready-made avatar, or an uploaded photo
const AVATARS = ['🦁', '🐯', '🦊', '🐼', '🐨', '🐸', '🦉', '🐺', '🐻', '🦄', '🐵', '🐲', '🦅', '🐬', '🐝', '🌹'];
function picSheet() {
  if (!PROFILE) return;
  const cur = PROFILE.pic || '';
  openModal('pic', `<div class="eyebrow">Profile picture</div><h2>Choose your picture</h2>
    <div class="pic-grid" id="picGrid">
      ${PROFILE.avatar ? `<button data-pic="" class="${cur === '' ? 'on' : ''}"><img class="avatar big" src="${esc(PROFILE.avatar)}" alt="" referrerpolicy="no-referrer"><small>Google</small></button>` : ''}
      ${AVATARS.map((e, i) => `<button data-pic="e:${i}" class="${cur === 'e:' + i ? 'on' : ''}"><span class="avatar emo big">${e}</span></button>`).join('')}
    </div>
    <label class="secondary pic-up">${cur === 'u' ? 'Upload a new photo' : 'Upload your photo'}<input type="file" id="picFile" accept="image/*" hidden></label>
    <div class="err" id="picErr"></div>
    <button class="linkbtn" id="picBack">Back</button>`);
  const save = async val => { const r = await send('setPic', val); if (r && r.ok) { PROFILE = r.profile; renderChip(); profileSheet(); } else if (r && r.error && $('picErr')) $('picErr').textContent = r.error; };
  $('picGrid').onclick = e => { const b = e.target.closest('button[data-pic]'); if (b) save(b.dataset.pic); };
  $('picBack').onclick = profileSheet;
  $('picFile').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    $('picErr').textContent = 'Preparing photo…';
    try { save(await shrinkPhoto(f)); } catch (err) { $('picErr').textContent = 'Could not read that photo. Try another one.'; }
  };
}
// Crop to a square and shrink to a small JPEG so it loads fast for everyone at the table
function shrinkPhoto(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 160;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 160, 160);
      URL.revokeObjectURL(url);
      let q = 0.82, d = c.toDataURL('image/jpeg', q);
      while (d.length > 58000 && q > 0.3) { q -= 0.12; d = c.toDataURL('image/jpeg', q); }
      d.length > 58000 ? rej(new Error('too big')) : res(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    img.src = url;
  });
}
// Leaderboard: top signed-in players by level or by wins
async function lbSheet(sort) {
  const tabs = `<div class="seg text lb-tabs" id="lbTabs"><button data-s="xp" class="${sort === 'xp' ? 'on' : ''}">Top level</button><button data-s="wins" class="${sort === 'wins' ? 'on' : ''}">Most wins</button></div>`;
  openModal('lb', `<div class="eyebrow">Leaderboard</div><h2>Top players</h2>${tabs}<div class="lb-list" id="lbList"><div class="sub-muted">Loading…</div></div><button class="primary" id="lbClose">Close</button>`);
  $('lbClose').onclick = closeModal;
  $('lbTabs').onclick = e => { const b = e.target.closest('button[data-s]'); if (b && b.dataset.s !== sort) lbSheet(b.dataset.s); };
  const r = await send('leaderboard', sort);
  if (modalKind !== 'lb' || !$('lbList')) return;
  if (!r || !r.ok) { $('lbList').innerHTML = `<div class="sub-muted">Could not load the leaderboard. Try again in a minute.</div>`; return; }
  const row = p => `<div class="lb-row ${p.me ? 'me' : ''}"><span class="lb-rank">${p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : p.rank}</span>${avatarHTML({ name: p.name, av: p.av || null })}
    <span class="lb-name"><b>${esc(p.name)}${p.me ? ' (you)' : ''}</b><small>Level ${p.level} · ${p.games} game${p.games === 1 ? '' : 's'}</small></span>
    <span class="lb-val">${sort === 'wins' ? `<b>${p.wins}</b><small>wins</small>` : `<b>${p.xp}</b><small>XP</small>`}</span></div>`;
  let html = r.list.length ? r.list.map(row).join('') : '<div class="sub-muted">No players yet. Sign in and play a game to be the first.</div>';
  if (r.mine) html += `<div class="lb-gap">Your rank</div>` + row(r.mine);
  else if (PROFILE && !r.list.some(p => p.me)) html += `<div class="lb-gap">Your rank</div><div class="sub-muted">Finish a game to get on the leaderboard.</div>`;
  if (!PROFILE && AUTH.auth) html += `<div class="lb-gap"></div><button class="gbtn inv-g" id="lbSign">Sign in with Google to join the leaderboard</button>`;
  $('lbList').innerHTML = html;
  if ($('lbSign')) $('lbSign').onclick = signIn;
}
// ---- friends ----
async function friendsSheet(from) {
  openModal('friends', `<div class="eyebrow">Friends</div><h2>Your friends</h2><div class="fr-list" id="frList"><div class="sub-muted">Loading…</div></div>
    <p class="hint">Add friends by tapping a player at the table and choosing Add friend.</p><button class="primary" id="frBack">${from === 'profile' ? 'Back' : 'Close'}</button>`);
  $('frBack').onclick = () => (from === 'profile' ? profileSheet() : closeModal());
  const r = await send('friends'); if (modalKind !== 'friends' || !$('frList')) return;
  if (!r || !r.ok) { $('frList').innerHTML = `<div class="sub-muted">Could not load your friends.</div>`; return; }
  const by = k => r.list.filter(f => f.status === k);
  FRQ = by('incoming').length; renderChip();
  const row = (f, btns) => `<div class="fr-row">${avatarHTML({ name: f.name, av: f.av || null })}<span class="lb-name"><b>${esc(f.name)}</b><small>${f.status === 'friend' ? (f.online ? '<i class="on-dot"></i>Online' : 'Offline') + ' · ' : ''}Level ${f.level}</small></span><span class="fr-acts">${btns}</span></div>`;
  let html = '';
  const inc = by('incoming'), fr = by('friend'), sent = by('sent');
  if (inc.length) html += `<div class="lb-gap">Friend requests</div>` + inc.map(f => row(f, `<button class="mini ok" data-acc="${esc(f.id)}">Accept</button><button class="mini" data-rem="${esc(f.id)}">✕</button>`)).join('');
  html += `<div class="lb-gap">Friends (${fr.length})</div>` + (fr.length ? fr.map(f => row(f, `<button class="mini" data-rem="${esc(f.id)}" data-ask="1" aria-label="Remove friend">✕</button>`)).join('') : '<div class="sub-muted">No friends yet.</div>');
  if (sent.length) html += `<div class="lb-gap">Requests you sent</div>` + sent.map(f => row(f, `<button class="mini" data-rem="${esc(f.id)}">Cancel</button>`)).join('');
  $('frList').innerHTML = html;
  $('frList').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ask && b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Remove?'; return; }
    b.disabled = true;
    const res = b.dataset.acc ? await send('friend:accept', b.dataset.acc) : await send('friend:remove', b.dataset.rem);
    if (res && res.ok) friendsSheet(from); else b.disabled = false;
  };
}
async function inviteSheet() {
  openModal('invite', `<div class="eyebrow">Invite friends</div><h2>Invite to table ${esc(S.code)}</h2><div class="fr-list" id="invList"><div class="sub-muted">Loading…</div></div><button class="primary" id="invBack">Back to table</button>`);
  $('invBack').onclick = () => { closeModal(); if (S && S.phase === 'lobby') lobbyScreen(); };
  const r = await send('friends'); if (modalKind !== 'invite' || !$('invList')) return;
  if (!r || !r.ok) { $('invList').innerHTML = `<div class="sub-muted">Could not load your friends.</div>`; return; }
  const fr = r.list.filter(f => f.status === 'friend' && !f.here), on = fr.filter(f => f.online);
  if (!fr.length) { $('invList').innerHTML = `<div class="sub-muted">No friends to invite yet. Tap a player at the table and choose Add friend, or share the WhatsApp link.</div>`; return; }
  $('invList').innerHTML = (on.length > 1 ? `<button class="secondary" id="invAll">Invite all online friends (${on.length})</button>` : '')
    + fr.map(f => `<div class="fr-row">${avatarHTML({ name: f.name, av: f.av || null })}<span class="lb-name"><b>${esc(f.name)}</b><small>${f.online ? '<i class="on-dot"></i>Online' : 'Offline · share the WhatsApp link instead'}</small></span><span class="fr-acts">${f.online ? `<button class="mini ok" data-inv="${esc(f.id)}">Invite</button>` : ''}</span></div>`).join('');
  $('invList').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const ids = b.id === 'invAll' ? on.map(f => f.id) : [b.dataset.inv];
    b.disabled = true;
    const res = await send('invite', ids);
    if (res && res.ok) { b.textContent = 'Invited ✔'; if (b.id === 'invAll') $('invList').querySelectorAll('[data-inv]').forEach(x => { x.disabled = true; x.textContent = 'Invited ✔'; }); }
    else b.disabled = false;
  };
}
function invitePop(v) {
  let el = $('invPop'); if (!el) { el = document.createElement('div'); el.id = 'invPop'; el.className = 'inv-pop'; document.body.appendChild(el); }
  const busy = S && me0() && S.phase === 'game' && S.code !== v.code;
  el.innerHTML = `${avatarHTML({ name: v.from, av: v.av || null })}<div class="ip-text"><b>${esc(v.from)} invited you</b><span>${v.n} players${v.joker ? ' · Joker' : ''} · ${v.playing ? 'game in progress' : 'waiting to start'}${busy ? ' · you will leave this game' : ''}</span></div>
    <button class="mini ok" id="ipJoin">Join</button><button class="mini" id="ipNo" aria-label="Dismiss">✕</button>`;
  el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  sfx('support');
  clearTimeout(invitePop.t); invitePop.t = setTimeout(() => { el.hidden = true; }, 30000);
  $('ipNo').onclick = () => { el.hidden = true; };
  $('ipJoin').onclick = () => {
    el.hidden = true;
    if (S && S.code === v.code) return;
    if (S) { voiceLeave(true); chatMsgs = []; chatUnread = 0; closeChat(); renderChat(); send('leaveTable'); S = null; $('trick').innerHTML = ''; hidePanel(); }
    hideWelcome(); joinRoom(v.code);
  };
}
// Player card: tap any seat at the table
async function playerCard(realSeat) {
  const r = await send('card', realSeat); if (!r || !r.ok) return;
  const c = r.card, me = S && S.seats[0] && S.seats[0].real === realSeat && me0();
  let body;
  if (c.bot) body = `<div class="prof-head"><span class="avatar big emo">🤖</span><div><h2>${esc(c.name)}</h2><span class="sub-muted">Bot player</span></div></div>`;
  else if (c.guest) body = `<div class="prof-head">${avatarHTML({ name: c.name, av: null }, 'big')}<div><h2>${esc(c.name)}</h2><span class="sub-muted">Playing as guest</span></div></div>
    <p class="hint">${me ? 'Sign in with Google to get a profile, a picture, levels and coins.' : 'Guests have no profile yet.'}</p>`;
  else {
    const rate = c.games ? Math.round(100 * c.wins / c.games) + '%' : '–';
    const since = c.since ? new Date(c.since).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
    body = `<div class="prof-head">${avatarHTML({ name: c.name, av: c.av || null }, 'big')}<div><h2>${esc(c.name)}</h2><span class="lvl-pill">Level ${c.level}</span>${since ? `<span class="sub-muted"> · Playing since ${since}</span>` : ''}</div></div>
    <div class="res-grid">
      <div><span>Games</span><b>${c.games}</b></div><div><span>Wins</span><b>${c.wins} · ${rate}</b></div>
      <div><span>Hands played</span><b>${c.hands}</b></div><div><span>Bids made</span><b>${c.bidsMade} / ${c.bidsTotal}</b></div>
      <div><span>Sweeps & whitewashes</span><b>${c.sweeps}</b></div><div><span>Hands won</span><b>${c.handWins}</b></div>
    </div>`;
  }
  let fbtn = '';
  if (c.fid && !c.me) {
    if (!PROFILE) fbtn = AUTH.auth ? `<p class="hint">Sign in with Google to add friends.</p>` : '';
    else fbtn = { none: `<button class="secondary fr-btn" data-fr="add">➕ Add friend</button>`, sent: `<button class="secondary fr-btn" disabled>Friend request sent</button>`,
      incoming: `<button class="secondary fr-btn" data-fr="accept">✔ Accept friend request</button>`, friend: `<button class="secondary fr-btn" disabled>✔ Friends</button>` }[c.friend] || '';
  }
  const si = S ? S.seats.findIndex(x => x.real === realSeat) : -1;
  const rel = si < 0 ? '' : `<div class="card-rel ${tcls(si)}">${si === 0 && me0() ? 'You' : teamTag(si)}${S.seats[si].bot ? ' · Bot' : !S.seats[si].connected ? ' · Away' : ''}${S.dealer === si && S.phase !== 'lobby' ? ' · Dealer' : ''}</div>`;
  openModal('card', rel + body + fbtn + `<button class="primary" id="cardClose">Close</button>`);
  $('cardClose').onclick = closeModal;
  const fb = document.querySelector('.fr-btn[data-fr]');
  if (fb) fb.onclick = async () => { fb.disabled = true; const r = await send(fb.dataset.fr === 'accept' ? 'friend:accept' : 'friend:add', c.fid); if (r && r.ok) playerCard(realSeat); else fb.disabled = false; };
}
function applyFelt() { document.documentElement.dataset.felt = PROFILE && PROFILE.equipped ? PROFILE.equipped.felt || 'green' : 'green'; }
function gainToast(text, big) {
  const t = document.createElement('div'); t.className = 'gain' + (big ? ' big' : ''); t.innerHTML = text;
  document.body.appendChild(t); setTimeout(() => t.remove(), big ? 3200 : 2600);
}
sockReady.push(() => {
  sock.on('profile', ({ profile, gain }) => {
    PROFILE = profile; applyFelt(); renderChip();
    if (gain && (gain.xp || gain.coins)) setTimeout(() => gainToast(`+${gain.xp} XP${gain.coins ? ` · +${gain.coins} coins` : ''}`), 900);
    if (gain && gain.levelUp) setTimeout(() => { gainToast(`<b>Level ${gain.levelUp}!</b><span>+${50} bonus coins</span>`, true); confetti(['#f4a93a', '#fbf7ef', '#82d48e'], 1600, 90); sfx('win'); }, 1800);
  });
});

function nameScreen() {
  openModal('name', `<div class="eyebrow">You're invited</div>
    <h2>Join table ${esc(tableCode)}</h2>
    <p>Patta Party is a team bidding card game. Type your name, then pick a seat.</p>
    <div id="invAuth"></div>
    <div class="field"><span>Your name</span><input type="text" id="nameIn" maxlength="14" autocomplete="nickname" placeholder="e.g. Atif" value="${esc(myName)}"></div>
    <button class="primary" id="goBtn">${AUTH.auth ? 'Play as guest' : 'Join table'}</button>
    <div class="err" id="homeErr"></div>
    <button class="linkbtn" id="tutLink">New to Patta Party? Take the 2 minute tutorial</button>`);
  $('tutLink').onclick = () => openTutorial('invite');
  renderInvAuth();
  const go = () => { const v = $('nameIn').value.trim(); if (!v) { $('homeErr').textContent = 'Type your name first.'; return; } setName(v); store.set('rb-guest', String(Date.now())); invitePending = false; closeModal(); joinTable(); };
  $('goBtn').onclick = go;
  $('nameIn').onkeydown = e => { if (e.key === 'Enter') go(); };
}
// Sign-in choice at the top of the invite popup (only when Google sign-in is set up)
function renderInvAuth() {
  const el = $('invAuth'); if (!el) return;
  const b = $('goBtn'); if (b) b.textContent = AUTH.auth ? 'Play as guest' : 'Join table';
  if (!AUTH.auth || PROFILE) { el.innerHTML = ''; return; }
  el.innerHTML = `<button class="gbtn inv-g" id="invG"><svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Sign in with Google</button>
    <div class="inv-note">Keep your level, coins and wins</div><div class="inv-or"><span>or play as guest</span></div>`;
  $('invG').onclick = signIn;
}
// Signed in already (or coming back from Google)? Then skip the popup
const looksSignedIn = () => { try { if (new URLSearchParams(location.search).has('code') || store.get('rb-dev')) return true; for (let i = 0; i < localStorage.length; i++) if (/^sb-.*-auth-token$/.test(localStorage.key(i))) return true; } catch (e) {} return false; };
const guestRecently = () => Date.now() - Number(store.get('rb-guest') || 0) < 3 * 24 * 3600 * 1000;
let invitePending = false;
function shareLink() { return location.origin + '/?t=' + S.code; }
let dupNo = '';
function lobbyScreen() {
  const mySeat = S.seats.find((p, i) => i === 0 && me0());
  const ordered = S.seats.map((p, i) => ({ p, i })).sort((a, b) => a.p.real - b.p.real);
  const link = shareLink();
  const wa = 'https://wa.me/?text=' + encodeURIComponent(`Join my Patta Party table (${S.n} players${S.joker ? ', Joker mode' : ''}): ${link}`);
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
  const dupAsk = S.dup && dupNo !== S.code + S.dup.real ? `<div class="dup-ask"><b>${esc(S.dup.name)} is already sitting here.</b><span>Is that you on another phone or app?</span>
      <div class="btns"><button class="primary" id="dupYes">Yes, play here</button><button class="secondary" id="dupNo">No, I'm someone else</button></div></div>` : '';
  openModal('lobby', `${dupAsk}<div class="eyebrow">Table code</div>
    <div class="codebig">${esc(S.code)}</div>
    <p class="hint" style="margin-top:6px">${S.n} players · ${S.joker ? 'Joker mode' : 'Classic'} · ${S.limit ? S.limit + ' hands' : 'no hand limit'} · teams sit alternately</p>
    ${S.isHost ? `<div class="field"><span>Game length</span><div class="seg" id="lobbyL">
      <button data-l="6" class="${S.limit === 6 ? 'on' : ''}">Quick<small>6 hands</small></button><button data-l="10" class="${S.limit === 10 ? 'on' : ''}">Normal<small>10 hands</small></button><button data-l="0" class="${!S.limit ? 'on' : ''}">Full<small>no limit</small></button></div></div>` : ''}
    <div class="share"><span class="link" id="linkTxt">${esc(link)}</span>
      <div class="btns"><button class="secondary" id="copyBtn">Copy link</button><a class="secondary" href="${wa}" target="_blank" rel="noopener">WhatsApp</a></div></div>
    ${PROFILE ? `<button class="secondary inv-friends" id="invFriends">👥 Invite friends</button>` : ''}
    <div class="eyebrow">Pick your seat</div>
    <div class="seatgrid" id="seatGrid">${seats}</div>
    ${watchers}
    ${S.isHost ? `<button class="primary" id="startBtn">Start game</button><p class="hint" style="margin-top:8px">Bots play any empty seat. Friends can still take a bot's seat after the game starts.</p>`
      : `<p class="hint">${me0() ? 'Waiting for the host (★) to start the game.' : 'Tap an empty seat to sit down.'}</p>`}
    <button class="linkbtn" id="leaveLobby">Leave table</button>`);
  if ($('lobbyL')) $('lobbyL').onclick = e => { const b = e.target.closest('button[data-l]'); if (b) send('setLimit', +b.dataset.l); };
  $('seatGrid').onclick = e => { const b = e.target.closest('button[data-sit]'); if (!b || b.disabled) return; send('sit', +b.dataset.sit); };
  $('copyBtn').onclick = () => {
    const done = () => { $('copyBtn').textContent = 'Copied'; setTimeout(() => { const b = $('copyBtn'); if (b) b.textContent = 'Copy link'; }, 1500); };
    try { navigator.clipboard.writeText(link).then(done, () => selectLink()); } catch (e) { selectLink(); }
  };
  if ($('startBtn')) $('startBtn').onclick = () => { ac(); send('start'); };
  $('leaveLobby').onclick = leaveTable;
  if ($('invFriends')) $('invFriends').onclick = inviteSheet;
  if ($('dupYes')) { $('dupYes').onclick = () => send('claim'); $('dupNo').onclick = () => { dupNo = S.code + S.dup.real; lobbyScreen(); }; }
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
    const w = (S.score || 0) > 0 ? 0 : 1, iWon = me0() && w === 0, margin = Math.abs(S.score || 0);
    const trophy = `<svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".45" stop-color="#f4c542"/><stop offset="1" stop-color="#b57b12"/></linearGradient></defs>
      <path d="M34 18h52v18c0 17-11 30-26 30S34 53 34 36z" fill="url(#tg)"/><path d="M34 24H18c0 14 7 23 18 24M86 24h16c0 14-7 23-18 24" fill="none" stroke="#e0a92e" stroke-width="6" stroke-linecap="round"/>
      <rect x="54" y="64" width="12" height="18" fill="#d99a24"/><rect x="38" y="82" width="44" height="12" rx="3" fill="url(#tg)"/><rect x="32" y="94" width="56" height="10" rx="3" fill="#8a5a10"/>
      <path d="M48 28l4 10 10 1-8 6 3 10-9-6-9 6 3-10-8-6 10-1z" fill="#fffbe6" opacity=".9" transform="translate(12 0)"/></svg>`;
    openModal('over', `<div class="over-hero ${iWon ? 'win' : me0() ? 'lose' : ''}"><div class="trophy">${trophy}</div>
      <div class="eyebrow">Game over · ${R.byLimit ? 'hand limit reached' : S.handNo + ' hands'}</div>
      <h2 class="over-title ${S.spectator ? '' : w === 0 ? 'good' : 'bad'}">${iWon ? 'Your team wins!' : `${teamName(w)} ${sv(w, 'wins', 'win')}`}</h2>
      <p class="over-sub">${margin ? `Won by ${margin} point${margin === 1 ? '' : 's'}` : ''}</p></div>${grid}
      ${S.isHost ? '<button class="primary" id="againBtn">Play again</button>' : '<p class="hint">Waiting for the host to start a new game.</p>'}
      <button class="linkbtn" id="leaveOver">Leave table</button>`);
    if ($('againBtn')) $('againBtn').onclick = () => send('again');
    $('leaveOver').onclick = leaveTable;
    return;
  }
  resultAt = Date.now() + (R.endsAt || 0);
  openModal('result', `<div class="eyebrow">Hand ${R.handNo} result</div><h2 class="${good}">${colourNames(R.title)}</h2>${grid}
    ${R.deciderNext ? '<p><b>Scores are level after the last hand.</b> One decider hand to finish the game.</p>' : ''}
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

  if (S.phase === 'lobby') { if (!['invite', 'friends', 'card'].includes(modalKind)) lobbyScreen(); }
  else if (S.phase === 'over' && S.result) { if (modalKind !== 'over' || shownHost !== S.isHost) { resultScreen(); shownHost = S.isHost; } }
  else if (S.result) { if (modalKind !== 'result' || shownHand !== S.result.handNo || shownHost !== S.isHost) { resultScreen(); shownHand = S.result.handNo; shownHost = S.isHost; } }
  else if (modalKind && modalKind !== 'card') closeModal();
}

/* ---------- confetti ---------- */
function confetti(colors, ms = 3000, count = 150) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let c = $('confetti');
  if (!c) { c = document.createElement('canvas'); c.id = 'confetti'; c.className = 'confetti'; document.body.appendChild(c); }
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  c.width = W * dpr; c.height = H * dpr; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const parts = Array.from({ length: count }, (_, i) => ({
    x: W * (i % 2 ? 0.15 + Math.random() * 0.2 : 0.65 + Math.random() * 0.2), y: H * 0.55 + Math.random() * 40,
    vx: (Math.random() - 0.5) * 9, vy: -(9 + Math.random() * 9), r: 4 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    col: colors[i % colors.length], shape: i % 3,
  }));
  const t0 = performance.now(); c.style.opacity = 1;
  const step = now => {
    const t = now - t0; g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillStyle = p.col;
      if (p.shape === 0) g.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      else if (p.shape === 1) { g.beginPath(); g.arc(0, 0, p.r / 2.4, 0, Math.PI * 2); g.fill(); }
      else { g.font = `${p.r * 2.2}px serif`; g.fillText(['♠', '♥', '♣', '♦'][Math.floor(p.r) % 4], -p.r / 2, p.r / 2); }
      g.restore();
    }
    if (t > ms - 600) c.style.opacity = Math.max(0, (ms - t) / 600);
    if (t < ms) requestAnimationFrame(step); else g.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(step);
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
function showJoker(seat, second) {
  const to = trickPos(seat), t = tcls(seat);
  const fx = document.createElement('div');
  fx.className = `cut-fx jfx ${t}`; fx.style.left = to.x + '%'; fx.style.top = to.y + '%';
  fx.innerHTML = `<span class="cut-ring"></span><span class="cut-label jlabel">${second ? 'CANCELLED' : 'REVERSE ⇄'}</span>`;
  $('trick').appendChild(fx);
  const felt = document.querySelector('.felt'); felt.classList.remove('spin'); void felt.offsetWidth; felt.classList.add('spin');
  setTimeout(() => fx.remove(), 1500);
}
function onFx(f) {
  if (!S || !tableCode || (S.code && S.code !== tableCode)) return;
  switch (f.type) {
    case 'deal': sfx('deal'); break;
    case 'watch': toast(f.text); sfx('pop'); break;
    case 'bid': sfx('bid', f.v); break;
    case 'support': sfx('support'); break;
    case 'pass': sfx('pass'); break;
    case 'trump': sfx('trump'); announce('Trump', SYM[f.s], SNAME[f.s], colourNames(f.sub || ''), RED(f.s) ? 'red' : ''); break;
    case 'card': if (f.cut) { showCut(f.seat, f.s, f.over); sfx('cut'); } else sfx('card'); break;
    case 'joker': showJoker(f.seat, f.second); sfx('joker'); break;
    case 'trick': {
      const el = $('trick').querySelector(`[data-key="${f.showSeat}-${f.showId}"]`);
      if (el) el.classList.add('win', f.team === 0 ? 'ta' : 'tb');
      sweepTo = f.credit;
      sfx(f.team === 0 && me0() ? 'trickUs' : 'trickThem');
      break;
    }
    case 'stuck': sfx('lose'); announce('Stuck', '⇄', `${esc(nm(f.seat))} can't lead`, `${teamName(f.team)} take ${f.left} trick${f.left > 1 ? 's' : ''}`, 'jann', 2000); break;
    case 'handEnd': {
      const mine = me0() && f.team === 0;
      if (f.over) {
        const wonGame = f.gameWinner === 0;
        if (me0() && wonGame) { sfx('fanfare'); setTimeout(() => confetti(['#f4a93a', '#ffd76a', '#fbf7ef', '#82d48e'], 4200, 220), 250); }
        else if (!me0()) { sfx('win'); confetti(wonGame ? ['#f4a93a', '#fbf7ef'] : ['#6cc4d8', '#fbf7ef'], 3000, 140); }
        else sfx('lose');
      } else {
        sfx(mine ? 'win' : 'lose');
        if (mine && (f.kind === 'sweep' || f.kind === 'whitewash')) confetti(['#f4a93a', '#fbf7ef'], 1800, 90);
      }
      break;
    }
    case 'sticker': {
      const pos = seatPos(f.seat); const d = document.createElement('div');
      d.className = 'sticker-pop'; d.style.left = Math.min(80, Math.max(20, pos.x)) + '%'; d.style.top = Math.min(80, Math.max(14, pos.y)) + '%';
      const st = STICKERS.find(x => x.id === f.id);
      d.innerHTML = `<img src="${esc(st ? st.src : '/stickers/' + encodeURIComponent(f.id) + '.svg')}" alt="">`;
      $('table').appendChild(d); setTimeout(() => d.remove(), 2600); sfx('pop'); break;
    }
    case 'react': {
      const pos = seatPos(f.seat); const d = document.createElement('div');
      d.className = 'react-pop'; d.textContent = f.emo; d.style.left = pos.x + '%'; d.style.top = pos.y + '%';
      $('table').appendChild(d); setTimeout(() => d.remove(), 1900); sfx('pop'); break;
    }
  }
}

/* ---------- stickers ---------- */
let STICKERS = [];
const loadStickers = () => fetch('/stickers/list').then(r => r.json()).then(j => { STICKERS = j.list || []; STICKERS.forEach(st => { const i = new Image(); i.src = st.src; }); }).catch(() => {});
loadStickers(); setInterval(loadStickers, 10 * 60 * 1000); // new stickers from the admin page show up without a reload
function stickerTray() {
  let t = $('stkTray');
  if (t && !t.hidden) { t.hidden = true; return; }
  if (!t) { t = document.createElement('div'); t.id = 'stkTray'; t.className = 'stk-tray'; document.body.appendChild(t); }
  t.innerHTML = STICKERS.map(st => `<button data-stk="${esc(st.id)}" aria-label="${esc(st.line)}"><img src="${esc(st.src)}" alt=""></button>`).join('') || '<div class="sub-muted">Stickers are loading…</div>';
  t.hidden = false;
  t.onclick = e => { const b = e.target.closest('button[data-stk]'); if (!b) return; t.hidden = true; send('sticker', b.dataset.stk); };
}
document.addEventListener('pointerdown', e => { const t = $('stkTray'); if (t && !t.hidden && !e.target.closest('#stkTray,#stkBtn')) t.hidden = true; });

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
sockReady.forEach(f => f());

/* In-app browsers (WhatsApp, Facebook, Instagram) often block the microphone and speech typing */
const UA = navigator.userAgent || '';
const isAndroid = /Android/i.test(UA), isIOS = /iPhone|iPad|iPod/i.test(UA);
// Our own Android app (Capacitor) is a webview too, but it allows the mic, so it is not treated as a blocked in-app browser
const inApp = !NATIVE_APP && (/WhatsApp|FBAN|FBAV|FB_IAB|Instagram|Line\//i.test(UA) || (isAndroid && /; wv\)/.test(UA)) || (isIOS && !/Safari\//.test(UA)));
function openInBrowserHelp(feature) {
  let d = $('inapp');
  if (!d) { d = document.createElement('div'); d.className = 'modal tut-modal'; d.id = 'inapp'; document.body.appendChild(d); }
  const q = '?t=' + encodeURIComponent(tableCode || '') + '&p=' + encodeURIComponent(pid) + (myName ? '&n=' + encodeURIComponent(myName) : '');
  const url = location.origin + '/' + (tableCode ? q : '');
  const chrome = 'intent://' + location.host + '/' + (tableCode ? q : '') + '#Intent;scheme=https;package=com.android.chrome;end';
  d.innerHTML = `<div class="sheet"><div class="eyebrow">${feature} needs a full browser</div>
    <h2>Open the game in ${isIOS ? 'Safari' : 'Chrome'}</h2>
    <p>You opened the link inside ${/WhatsApp/i.test(UA) || !/FBAN|FBAV|Instagram/i.test(UA) ? "WhatsApp's" : "the app's"} built-in browser. It blocks the microphone, so voice chat and speech typing don't work here.</p>
    ${isAndroid ? `<a class="primary" style="display:block;box-sizing:border-box;text-align:center;text-decoration:none;margin-bottom:10px" href="${chrome}">Open in Chrome</a>
      <p class="hint">If that doesn't work: tap the <b>⋮</b> menu at the top right, then <b>Open in Chrome</b>.</p>`
      : `<p class="hint">Tap the <b>Safari</b> or <b>share</b> icon at the bottom or top of the screen, then <b>Open in Safari</b>. Or copy the link below and paste it into Safari.</p>`}
    <div class="share"><span class="link" id="inappLink">${esc(url)}</span><div class="btns" style="grid-template-columns:1fr"><button class="secondary" id="inappCopy">Copy link</button></div></div>
    <p class="hint">Your seat is kept. This link puts you straight back in your seat. Don't share it with others.</p>
    <button class="linkbtn" id="inappClose">Not now</button></div>`;
  d.hidden = false;
  $('inappClose').onclick = () => { d.hidden = true; };
  $('inappCopy').onclick = () => {
    const ok = () => { $('inappCopy').textContent = 'Copied'; };
    try { navigator.clipboard.writeText(url).then(ok, () => { const r = document.createRange(); r.selectNodeContents($('inappLink')); getSelection().removeAllRanges(); getSelection().addRange(r); }); } catch (e) {}
  };
}
$('reacts').innerHTML = '<span class="voicectl" id="voiceCtl"></span><button class="vbtn chatbtn" id="chatBtn" aria-label="Open chat">💬<span class="lbl"> Chat</span><span class="cbadge" id="chatBadge" hidden></span></button><button class="stk-btn" id="stkBtn" aria-label="Stickers">🎴</button>' + ['👏', '😂', '😮', '🔥', '😢', '🙏'].map(e => `<button data-r="${e}" aria-label="React ${e}">${e}</button>`).join('');
$('seats').addEventListener('click', e => {
  const el = e.target.closest('.seat'); if (!el || !S || !S.code || S.phase === 'lobby') return;
  if (modalKind && modalKind !== 'card') return;
  playerCard(+el.dataset.real);
});
$('reacts').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.r) send('react', b.dataset.r);
  else if (b.id === 'stkBtn') stickerTray();
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
  if (inApp) { openInBrowserHelp('Voice chat'); return; }
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
    <form class="chat-form" id="chatForm" autocomplete="off"><span class="stt" id="stt" hidden><button type="button" class="stt-mic" id="sttMic" aria-label="Speak your message">🎤</button><button type="button" class="stt-lang" id="sttLang" aria-label="Speech language"></button></span><input type="text" id="chatIn" maxlength="200" placeholder="Type a message" aria-label="Message"><button class="primary" type="submit">Send</button></form>`;
  document.body.appendChild(d);
  $('chatClose').onclick = closeChat;
  $('chatForm').onsubmit = e => {
    e.preventDefault();
    const v = $('chatIn').value.trim(); if (!v) return;
    $('chatIn').value = '';
    send('chat', v);
  };
})();
/* Speech to text: speak and the words fill the message box (Chrome, Safari, Edge) */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recOn = false, sttLang = store.get('rb-stt') || 'en-US';
function syncStt() {
  if (!SR) return;
  $('stt').hidden = false;
  $('sttLang').textContent = sttLang === 'ur-PK' ? 'اردو' : 'EN';
  $('sttMic').classList.toggle('on', recOn);
  $('chatIn').placeholder = recOn ? 'Listening…' : 'Type a message';
}
if (SR) {
  syncStt();
  $('sttLang').onclick = () => { sttLang = sttLang === 'en-US' ? 'ur-PK' : 'en-US'; store.set('rb-stt', sttLang); if (recOn) rec.stop(); syncStt(); };
  $('sttMic').onclick = () => {
    if (recOn) { rec.stop(); return; }
    if (inApp) { openInBrowserHelp('Speech typing'); return; }
    if (V.on && !V.muted) { flash('Turn your voice chat mic off first (tap 🎙 Mic on), then use 🎤.'); return; }
    let got = false;
    rec = new SR(); rec.lang = sttLang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    const before = $('chatIn').value.trim();
    rec.onresult = e => {
      let text = '';
      for (let k = e.resultIndex; k < e.results.length; k++) text = e.results[k][0].transcript; // latest phrase only (avoids repeats on Android)
      if (!text.trim()) return;
      got = true;
      $('chatIn').value = ((before ? before + ' ' : '') + text.trim()).slice(0, 200);
    };
    rec.onerror = e => {
      const why = {
        'not-allowed': 'Microphone is blocked for speech typing. Allow the mic for this site in your browser settings.',
        'service-not-allowed': "Speech typing doesn't work in this browser. Open the game link in Chrome (Android) or Safari (iPhone).",
        'audio-capture': 'No microphone found, or another app is using it. Close other apps using the mic and try again.',
        'network': 'Speech typing needs internet. Check your connection and try again.',
        'language-not-supported': 'This phone does not support speech typing in that language. Tap the language button to switch.',
        'no-speech': "Didn't hear anything. Tap 🎤 and speak right away.",
      }[e.error];
      if (why) flash(why); else if (e.error !== 'aborted') flash('Speech typing stopped (' + e.error + '). Try again.');
      got = true; // error already explained
    };
    let started = false;
    rec.onstart = rec.onaudiostart = () => { started = true; };
    rec.onend = () => { recOn = false; syncStt(); if (!got && started) flash("Didn't catch that. Tap 🎤 and speak again."); };
    // Some browsers accept start() and then silently do nothing: explain after 4 seconds
    setTimeout(() => {
      if (recOn && !started) { try { rec.abort(); } catch (e) {} recOn = false; syncStt(); openInBrowserHelp('Speech typing'); }
    }, 4000);
    try { rec.start(); recOn = true; syncStt(); }
    catch (e) { recOn = false; syncStt(); flash("Speech typing couldn't start in this browser. Try Chrome (Android) or Safari (iPhone)."); }
  };
} else {
  // Browser has no speech typing (for example Firefox or some in-app browsers): show the button with an explanation
  $('stt').hidden = false; $('sttLang').hidden = true;
  $('sttMic').onclick = () => flash("This browser can't do speech typing. Open the game link in Chrome (Android) or Safari (iPhone).");
}
function openChat() { chatOpen = true; chatUnread = 0; $('chat').hidden = false; renderChat(); if (!coarse) $('chatIn').focus(); }
function closeChat() { chatOpen = false; if (recOn && rec) rec.stop(); if ($('chat')) $('chat').hidden = true; }
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
function flash(msg) { const c = $('conn'); c.innerHTML = esc(msg); c.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => { if (sock.connected) c.hidden = true; }, 2600 + msg.length * 35); }
let waking = null;
function connecting() {
  const c = $('conn'); c.hidden = false;
  c.innerHTML = '<span class="spin"></span>Connecting…';
  clearTimeout(waking); waking = setTimeout(() => { if (!sock.connected) c.innerHTML = '<span class="spin"></span>Waking the game server. This can take up to a minute…'; }, 3500);
}
let awaitingCreate = false;
async function createTable(practice) {
  awaitingCreate = true;
  const r = await send('create', { n: homeN, joker: homeJ, limit: homeL, pub: homePub, guided: !!(practice && homeCoach) });
  awaitingCreate = false;
  if (!r || !r.ok) return;
  tableCode = r.code; history.replaceState(null, '', '/?t=' + r.code); store.set('rb-table', r.code);
  if (practice) { ac(); send('start'); }
}
let joinBusy = false;
async function joinTable() {
  if (joinBusy) return;
  joinBusy = true;
  const auto = autoSeat; autoSeat = false;
  let r; try { r = auto && sock.connected ? await new Promise(res => sock.emit('join', tableCode, auto === 'watch' ? { watch: true } : { seat: 'auto' }, x => { if (x && x.error) flash(x.error); res(x); })) : await send('join', tableCode); } finally { joinBusy = false; }
  if (r && r.ok) { history.replaceState(null, '', '/?t=' + r.code); store.set('rb-table', r.code); if (V.want && !V.on) setTimeout(voiceJoin, 600); loadChat(); }
  else { const quiet = resuming; tableCode = null; store.set('rb-table', ''); history.replaceState(null, '', '/'); S = null; homeScreen(quiet ? '' : r && r.error); }
  resuming = false;
}
function leaveTable() {
  voiceLeave(true); chatMsgs = []; chatUnread = 0; closeChat(); renderChat();
  send('leaveTable'); tableCode = null; S = null; store.set('rb-table', ''); history.replaceState(null, '', '/');
  $('trick').innerHTML = ''; hidePanel(); homeScreen();
  boot();
}
sock.on('connect', async () => {
  clearTimeout(waking); $('conn').hidden = true;
  await authNow();
  if (tableCode && myName && !invitePending) joinTable();
  else if (!tableCode) loadRooms();
});
sock.on('disconnect', () => { connecting(); if (V.on) { const w = V.want; voiceLeave(false); V.want = w; } });
sock.on('connect_error', () => connecting());
sock.on('state', st => {
  if (awaitingCreate && !tableCode) tableCode = st.code;
  if (!tableCode || st.code !== tableCode) return;
  S = st; hideWelcome(); render();
});
sock.on('fx', f => onFx(f));
sock.on('invite', v => invitePop(v));
sock.on('friend:count', n => { FRQ = Number(n) || 0; renderChip(); });
sock.on('friend:notify', v => {
  if (v.kind === 'request') { FRQ++; renderChip(); }
  toast(v.kind === 'request' ? `${v.name} sent you a friend request. Open your profile, then Friends.` : `${v.name} is now your friend`);
  sfx('pop');
  if (modalKind === 'friends') friendsSheet('profile');
});

/* ---------- header buttons ---------- */
function syncSound() { $('soundBtn').classList.toggle('muted', muted); $('soundBtn').textContent = muted ? 'Sound off' : 'Sound'; }
$('soundBtn').onclick = () => { muted = !muted; store.set('rb-muted', muted ? '1' : '0'); syncSound(); if (!muted) sfx('turn'); };
syncSound();
$('rulesBtn').onclick = () => { $('rules').hidden = false; };
$('rulesClose').onclick = () => { $('rules').hidden = true; };
$('rulesTut').onclick = () => { $('rules').hidden = true; openTutorial(S ? 'game' : 'home'); };
window.tutorialPractice = () => { homeCoach = true; if (myName) { ac(); createTable(true); } else createSheet(true); };
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
  $('contract').innerHTML = '<div class="c1">Patta Party</div><div class="c2">4, 6 or 8 players</div>';
  S = null;
}
boot();
// Opened the game without a link but were in a game before: go straight back to it
let resuming = false;
if (!tableCode && store.get('rb-table') && myName) { tableCode = store.get('rb-table'); resuming = true; history.replaceState(null, '', '/?t=' + tableCode); connecting(); }
else if (tableCode) {
  if (looksSignedIn() || (myName && guestRecently())) connecting();
  else { invitePending = true; nameScreen(); }
}
else homeScreen();
sock.connect();
initAuth();
