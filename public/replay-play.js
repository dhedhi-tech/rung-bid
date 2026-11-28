/* Patta Party hand replay (Nov 29 2026, manager: the old replay page "did not feel like the real game").
   The replay now runs inside the real game screen (/?rp=<id>&me=<seat>): this file rebuilds, move by move, the same
   state the server sends during a game (S) from the saved hand (replays.js), and fires the same effects (trump card,
   CUT, joker, trick win, hand end). So the table, score bar, trump card, trick counter, seats and cards are the game's own.
   Uses app.js globals: S, render, onFx, announce, sfx, openModal, closeModal, colourNames, teamName, scoreText, $, esc ... */
(function () {
  const q = new URLSearchParams(location.search);
  const ID = RP_ID, EMBED = q.get('embed') === '1';
  const meQ = q.get('me');
  let R = null, ME = -1, frames = [], at = 0, playing = false, timer = null, speed = 1, names = true, clean = false, recording = null;
  const SPEEDS = [0.5, 1, 1.5, 2];

  /* ---------- page set-up: hide what only makes sense in a live game ---------- */
  document.body.classList.add('rp-mode');
  if (EMBED) try { parent.postMessage({ rp: 'clean', on: true }, location.origin); } catch (e) {} // the page has its own Close
  const lb = $('leaveBtn'); lb.textContent = '✕ Close';
  lb.onclick = () => { if (EMBED) try { parent.postMessage({ rp: 'close' }, location.origin); return; } catch (e) {} location.href = '/'; };
  const bar = document.createElement('div'); bar.id = 'rpBar';
  bar.innerHTML = `<input type="range" id="rpSlide" min="0" value="0" aria-label="Replay position">
    <div class="rp-row"><button id="rpRestart" aria-label="Start again">⏮</button><button id="rpBack" aria-label="Step back">◀</button>
    <button id="rpPlay" class="rp-main" aria-label="Play">▶</button><button id="rpNext" aria-label="Next move">▶|</button>
    <button id="rpSpeed">1x</button><button id="rpNames" aria-label="Show or hide names">👤</button><button id="rpRec" aria-label="Recording mode">🎬</button><button id="rpShare" class="rp-share" aria-label="Share">📤<span class="lbl"> Share</span></button></div>`;
  document.querySelector('.app').appendChild(bar);

  /* ---------- load ---------- */
  fetch('/replay/data/' + encodeURIComponent(ID)).then(r => (r.ok ? r.json() : null)).then(d => {
    if (!d || !d.ev) { $('stMain').textContent = ''; announce('Replay', '✕', 'Not found', 'Replays are kept for 7 days', '', 600000); return; }
    R = d; ME = meQ != null && meQ !== '' && +meQ >= 0 && +meQ < R.n ? +meQ : -1;
    build(); go(0, false);
    announce('Hand replay', '▶', `Hand ${R.handNo}`, `${R.n} players${R.joker ? ' · Joker mode' : ''} · tap ▶ to play`, '', 600000);
  }).catch(() => announce('Replay', '✕', 'Could not load', 'Check your internet and try again', '', 600000));

  /* ---------- the hand, move by move ---------- */
  const N = () => R.n, base = () => (ME < 0 ? 0 : ME);
  const rot = s => (s == null || s < 0 ? s : (s - base() + N()) % N());
  const rotTeam = t => (t - base() % 2 + 2) % 2;
  const flip = () => (base() % 2 === 1 ? -1 : 1);
  const realName = s => R.seats[s].name;
  const shown = s => (!names && !R.seats[s].bot && s !== ME ? 'Player ' + (s + 1) : realName(s));
  const said = s => (s === ME ? 'You' : shown(s)); // how names appear in texts (like the server's {n3})
  const tname = t => { const v = rotTeam(t); return ME < 0 ? (v === 0 ? 'Orange team' : 'Blue team') : v === 0 ? 'Your team' : 'Opponents'; };
  const fmt = str => String(str || '')
    .replace(/\{v(\d+):([^:}]*):([^}]*)\}/g, (_, s, a, b) => (+s === ME ? 'You ' + a : shown(+s) + ' ' + b))
    .replace(/\{n(\d+)\}/g, (_, s) => said(+s))
    .replace(/\{tl(\d)\}/g, (_, t) => tname(+t).toLowerCase())
    .replace(/\{t(\d)\}/g, (_, t) => tname(+t));
  const legal = (hand, lead) => {
    if (!lead) { const nj = hand.filter(c => c.s !== 'J'); return nj.length ? nj : hand; }
    const f = hand.filter(c => c.s === lead); return f.length ? f : hand;
  };

  // G: the game in real seats (like the server's table.G). snap(): one frame = what the server would send me at that moment.
  function build() {
    const n = R.n;
    const G = { round: 0, gphase: 'deal', active: -1, bid: null, trump: null, leadSuit: null, acts: {}, hist: [], roundTrump: {},
      trick: [], hands: Array.from({ length: n }, () => []), tricks: Array(n).fill(0), tricksWon: [0, 0], score: R.score || 0, trickNo: 0, result: null };
    frames = [];
    const snap = (ms, fx = [], extra = {}) => frames.push({ G: JSON.parse(JSON.stringify(G)), ms, fx, ...extra });
    snap(400); // empty table before the deal
    const ev = R.ev;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.t === 'd') {
        G.round++; G.gphase = 'deal'; G.acts = {}; G.active = -1;
        e.c.forEach((cs, s) => cs.forEach(([id, su, r]) => G.hands[s].push({ id, s: su, r })));
        snap(1000, [{ type: 'deal' }]);
        G.gphase = 'bid';
      } else if (e.t === 'b') {
        G.gphase = 'bid';
        if (e.w) { G.hist.push({ r: e.r, seat: e.s, v: null, watch: true }); G.acts[e.s] = 'Watch'; snap(300); continue; }
        if (e.f) { G.bid = { value: 6, seat: e.s }; G.acts[e.s] = 6; G.hist.push({ r: e.r, seat: e.s, v: 6, forced: true }); snap(900, [{ type: 'bid', seat: e.s, v: 6 }]); continue; }
        G.active = e.s;
        const cur = G.bid ? G.bid.value : 5, maxV = e.r === 1 ? 7 : 13, options = [];
        for (let v = Math.max(6, cur + 1); v <= maxV; v++) options.push(v);
        snap(e.s === ME ? 1500 : 750, [], e.s === ME ? { ask: { kind: 'bid', round: e.r, options }, pick: { sel: `[data-v="${e.v || 0}"]` } } : {});
        G.hist.push({ r: e.r, seat: e.s, v: e.v || null });
        if (e.v) { G.bid = { value: e.v, seat: e.s }; G.acts[e.s] = e.v; } else G.acts[e.s] = 'Pass';
        G.active = -1;
        snap(450, [e.v ? { type: 'bid', seat: e.s, v: e.v } : { type: 'pass', seat: e.s }]);
      } else if (e.t === 't') {
        const r = G.round;
        if (e.k !== 'stay') {
          G.gphase = 'trump'; G.active = e.s;
          snap(e.s === ME ? 1600 : 900, [], e.s === ME ? { ask: { kind: 'trump', bid: G.bid ? G.bid.value : 6, current: G.trump }, pick: { sel: `[data-s="${e.x}"]` } } : {});
        }
        G.trump = e.x; G.active = -1; G.roundTrump[r] = { s: e.x, seat: e.s, v: G.bid ? G.bid.value : 6 };
        const sub = e.k === 'call' ? `Called by {n${e.s}}` : e.k === 'change' ? `Changed by {n${e.s}}` : e.k === 'keep' ? `Kept by {n${e.s}}` : 'No raise. Trump stays';
        snap(2000, [{ type: 'trump', s: e.x, sub, seat: e.s }]);
      } else if (e.t === 'p') {
        if (G.gphase !== 'play') { G.gphase = 'play'; G.acts = {}; G.active = -1; snap(500); }
        const hand = G.hands[e.s], card = hand.find(c => c.id === e.c); if (!card) continue;
        G.active = e.s;
        snap(e.s === ME ? 1100 : 550, [], e.s === ME ? { ask: { kind: 'play', legal: legal(hand, G.leadSuit).map(c => c.id) }, sel: card.id } : {});
        hand.splice(hand.indexOf(card), 1);
        if (!G.trick.length) G.leadSuit = card.s;
        G.trick.push({ seat: e.s, card }); G.active = -1;
        let fx;
        if (card.s === 'J') fx = { type: 'joker', seat: e.s, second: G.trick.filter(t => t.card.s === 'J').length === 2 };
        else { const cut = G.trick.length > 1 && card.s === G.trump && G.leadSuit !== G.trump; fx = { type: 'card', seat: e.s, cut, over: cut && G.trick.slice(0, -1).some(t => t.card.s === G.trump), s: card.s }; }
        snap(G.trick.length >= R.n ? 500 : 350, [fx]);
      } else if (e.t === 'w') {
        G.tricksWon[e.team]++; G.tricks[e.cr]++;
        const w = G.trick.find(t => t.card.id === e.sh);
        snap(1400, [{ type: 'trick', team: e.team, credit: e.cr, lead: e.ld, flipped: !!e.fl, showSeat: w ? w.seat : e.ld, showId: e.sh }]);
        G.trick = []; G.leadSuit = null; G.trickNo++;
        snap(450);
      } else if (e.t === 'x') {
        G.tricksWon[e.team] += e.left;
        snap(2300, [{ type: 'stuck', seat: e.s, left: e.left, team: e.team }]);
      } else if (e.t === 'e') snap(250, [{ type: 'react', seat: e.s, emo: e.e }]);
      else if (e.t === 'k') snap(250, [{ type: 'sticker', seat: e.s, id: e.id }]);
    }
    const res = R.res;
    if (res) {
      G.gphase = 'done'; G.score = res.score; G.active = -1;
      snap(1800, [{ type: 'handEnd', team: res.winner, kind: res.kind, over: !!res.over, gameWinner: res.over ? (res.score > 0 ? 0 : 1) : null }]);
      frames.push({ G: frames[frames.length - 1].G, ms: 0, end: true });
    }
    $('rpSlide').max = frames.length - 1;
  }

  // What the server's viewFor() would send me for frame f
  function view(f) {
    const G = f.G, n = R.n, b = base(), me = ME;
    const seat = i => { const s = (i + b) % n, st = R.seats[s], hide = !names && !st.bot && s !== me;
      return { name: hide ? 'Player ' + (s + 1) : st.name, bot: st.bot, human: !st.bot, mid: null, connected: true, host: false, real: s, voice: null, lvl: null, av: hide ? null : st.av }; };
    const v = {
      code: 'REPLAY', n, joker: !!R.joker, guided: false, coachable: false, limit: R.limit || 0, phase: 'game', me: me < 0 ? null : 0, spectator: me < 0,
      isHost: false, seats: Array.from({ length: n }, (_, i) => seat(i)), lobbyNames: [], paused: false, away: null, lockTeam: null, waiting: [], myWait: 0, swap: false, dup: null,
      handNo: R.handNo, decider: !!(R.limit && R.handNo > R.limit), dealer: rot(R.dealer), score: G.score * flip(), won: [0, 0],
      round: G.round, gphase: G.gphase, active: rot(G.active), watchBid: false,
      bid: G.bid ? { value: G.bid.value, seat: rot(G.bid.seat) } : null, trump: G.trump, leadSuit: G.leadSuit,
      tricksWon: [G.tricksWon[b % 2], G.tricksWon[1 - b % 2]],
      acts: Object.fromEntries(Object.entries(G.acts).map(([s, a]) => [rot(+s), a])),
      hist: G.hist.map(h => ({ ...h, seat: rot(h.seat) })),
      roundTrump: Object.fromEntries(Object.entries(G.roundTrump).map(([r, t]) => [r, { ...t, seat: rot(t.seat) }])),
      trick: G.trick.map(t => ({ seat: rot(t.seat), card: t.card })), trickNo: G.trickNo + 1, lastTrick: null,
      counts: Array.from({ length: n }, (_, i) => G.hands[(i + b) % n].length),
      tricks: Array.from({ length: n }, (_, i) => G.tricks[(i + b) % n]),
      hand: me >= 0 ? G.hands[me] : [], main: '', log: [], deadline: 0, over: null,
    };
    if (f.ask) v.ask = f.ask;
    return v;
  }
  function fxView(d) { // the server rotates seats and teams in effects for each viewer
    const x = { ...d };
    for (const k of ['seat', 'lead', 'credit', 'showSeat']) if (k in x) x[k] = rot(x[k]);
    if ('team' in x) x.team = rotTeam(x.team);
    if (x.gameWinner != null) x.gameWinner = rotTeam(x.gameWinner);
    if (x.sub) x.sub = fmt(x.sub);
    return x;
  }

  /* ---------- show a frame ---------- */
  function go(i, live) {
    clearTimeout(go.pick);
    at = Math.max(0, Math.min(frames.length - 1, i));
    const f = frames[at];
    tableCode = 'REPLAY';
    if (!live) { const a = $('announce'); if (a && !a.classList.contains('rp-keep')) a.hidden = true; }
    selected = f.sel || null;
    S = view(f); render();
    if (live) (f.fx || []).forEach(x => onFx(fxView(x)));
    // My own bid / trump: the button I chose lights up, as if tapped
    if (f.pick && f.pick.sel) go.pick = setTimeout(() => { const b = $('panelBody') && $('panelBody').querySelector(f.pick.sel); if (b) b.classList.add('rp-pick'); }, Math.min(900, f.ms * 0.55 / speed));
    if (f.end) resultCard();
    $('rpSlide').value = at;
    $('rpPlay').textContent = playing ? '❚❚' : '▶';
  }
  function resultCard() {
    const res = R.res; if (!res) return;
    const wt = rotTeam(res.winner), good = ME < 0 ? '' : wt === 0 ? 'good' : 'bad';
    const sym = { S: '♠', H: '♥', C: '♣', D: '♦' }[res.trump] || '';
    openModal('rpres', `<div class="eyebrow">Hand ${R.handNo} result</div><h2 class="${good}">${colourNames(fmt(res.title))}</h2>
      <div class="res-grid">
        <div><span>Contract</span><b>${res.v} ${sym} · ${esc(said(res.bidSeat))}</b></div>
        <div><span>Tricks</span><b>${teamName(0)} ${res.tricks[base() % 2]} · ${teamName(1)} ${res.tricks[1 - base() % 2]}</b></div>
        <div><span>Points</span><b class="${good}">${teamName(wt)} +${res.pts}</b></div>
        <div><span>Score</span><b>${scoreText()}</b></div></div>
      <button class="primary" id="rpAgain">▶ Watch again</button><button class="secondary rp-wide" id="rpShare2">📤 Share this hand</button><button class="linkbtn" id="rpDone">Close</button>`);
    $('rpShare2').onclick = shareSheet;
    $('rpAgain').onclick = () => { closeModal(); playing = true; go(0, false); tick(); };
    $('rpDone').onclick = () => $('leaveBtn').click();
    playing = false; $('rpPlay').textContent = '▶';
    if (recording) setTimeout(finishVideo, 2600); // the result card stays in the video for a moment
  }
  function tick() {
    clearTimeout(timer);
    if (!playing) return;
    const f = frames[at];
    if (f.end) { playing = false; go(at, false); return; }
    timer = setTimeout(() => { if (!playing) return; go(at + 1, true); tick(); }, (f.ms || 300) / speed);
  }
  function play(on) {
    playing = on;
    const a = $('announce'); if (on && a) { a.classList.remove('rp-keep'); if (at === 0) a.hidden = true; }
    if (on && frames[at] && frames[at].end) { closeModal(); go(0, false); }
    $('rpPlay').textContent = playing ? '❚❚' : '▶';
    tick();
  }

  /* ---------- controls ---------- */
  $('announce').classList.add('rp-keep'); // the intro card stays until ▶
  $('rpPlay').onclick = () => { ac(); play(!playing); };
  $('rpNext').onclick = () => { ac(); play(false); go(at + 1, true); };
  $('rpBack').onclick = () => { play(false); go(at - 1, false); };
  $('rpRestart').onclick = () => { play(false); closeModal(); go(0, false); };
  $('rpSlide').oninput = e => { play(false); go(+e.target.value, false); };
  $('rpSpeed').onclick = () => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; $('rpSpeed').textContent = speed + 'x'; };
  $('rpNames').onclick = () => { names = !names; toast(names ? 'Names shown' : 'Real players\' names hidden'); $('rpNames').classList.toggle('off', !names); go(at, false); };
  $('rpRec').onclick = e => { e.stopPropagation(); clean = true; document.body.classList.add('rp-clean'); toast('Recording mode: tap the screen to show the buttons again'); };
  document.addEventListener('click', e => {
    if (recording || !clean || e.target.closest('#rpBar') || e.target.closest('.sheet')) return;
    clean = false; document.body.classList.remove('rp-clean');
  }, true);
  $('rpShare').onclick = shareSheet;

  /* ---------- share: video file or link (Nov 29 2026, manager) ---------- */
  const plug = n => capPlugin(n) || (parent !== window && parent.Capacitor && parent.Capacitor.Plugins && parent.Capacitor.Plugins[n]) || null; // the replay may run in a frame
  const replayLink = () => location.origin + '/?rp=' + encodeURIComponent(ID) + (ME >= 0 ? '&me=' + ME : '');
  const SHARE_TEXT = `Watch this hand of Patta Party 🃏 Play free: https://www.pattaparty.com/get?ref=share_replay`;
  function shareSheet() {
    if (!R) return;
    play(false);
    openModal('rpshare', `<div class="eyebrow">Hand ${R.handNo} replay</div><h2>Share this hand</h2>
      <button class="primary" id="shVid">📹 Share video</button>
      <p class="hint">Makes a video of this hand, then opens WhatsApp, YouTube and more.</p>
      <button class="secondary rp-wide" id="shLink">🔗 Copy link</button>
      <p class="hint">Anyone with the link can watch it, for 7 days.</p>
      <button class="linkbtn" id="shNo">Cancel</button>`);
    $('shVid').onclick = makeVideo;
    $('shLink').onclick = copyLink;
    $('shNo').onclick = closeModal;
  }
  async function copyLink() {
    const url = replayLink();
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {}
    if (!ok) try { const t = document.createElement('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch (e) {}
    if (ok) { closeModal(); toast('Link copied. Paste it in WhatsApp or anywhere. It works for 7 days.'); }
    else $('sheet').insertAdjacentHTML('beforeend', `<p class="hint" style="user-select:all;word-break:break-all">${esc(url)}</p>`); // copy by hand
  }
  async function makeVideo() {
    const Rec = plug('ScreenRec');
    if (!NATIVE_APP || !Rec) {
      openModal('rpshare', NATIVE_APP
        ? `<h2>Update the app</h2><p class="hint">Video sharing needs the latest Patta Party app. Update it from Google Play, then try again.</p>
           <button class="primary" id="shPlay">Open Google Play</button><button class="secondary" id="shLink">🔗 Copy link instead</button><button class="linkbtn" id="shNo">Close</button>`
        : `<h2>Video sharing is in the app</h2><p class="hint">In the Patta Party app on Android, one tap makes the video. Here, you can tap 🎬 and record with your phone's screen recorder, or share the link.</p>
           <button class="primary" id="shLink">🔗 Copy link</button><button class="linkbtn" id="shNo">Close</button>`);
      if ($('shPlay')) $('shPlay').onclick = () => window.open(PLAY_PAGE, '_blank');
      $('shLink').onclick = copyLink; $('shNo').onclick = closeModal;
      return;
    }
    closeModal(); play(false); ac();
    recording = { at: Date.now() };
    clean = true; document.body.classList.add('rp-clean', 'rp-recording');
    go(0, false);
    try { await Rec.start({ audio: true }); }
    catch (e) { endRecording(); toast(/cancel/i.test(String(e && e.message)) ? 'Video cancelled' : 'Could not make the video on this phone. Try Copy link.'); return; }
    await new Promise(r => setTimeout(r, 800)); // Android's "Start recording?" box closes
    announce('Hand replay', '▶', `Hand ${R.handNo}`, `${R.n} players${R.joker ? ' · Joker mode' : ''}`, '', 1800);
    await new Promise(r => setTimeout(r, 1900));
    if (!recording) return;
    play(true); // resultCard() calls finishVideo() at the end
  }
  async function finishVideo() {
    if (!recording) return;
    const Rec = plug('ScreenRec'), Sh = plug('Share');
    let res = null;
    try { res = await Rec.stop(); } catch (e) {}
    endRecording();
    if (!res || !res.path) { toast('Could not make the video on this phone. Try Copy link.'); return; }
    try { await Sh.share({ title: 'Patta Party hand replay', text: SHARE_TEXT, files: [res.path], dialogTitle: 'Share video' }); } catch (e) {} // closed the share menu
  }
  function endRecording() {
    recording = null; clean = false;
    document.body.classList.remove('rp-clean', 'rp-recording');
  }
  addEventListener('pagehide', () => { if (recording) { const Rec = plug('ScreenRec'); recording = null; if (Rec) Rec.stop().catch(() => {}); } });
  addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); $('rpPlay').click(); } else if (e.key === 'ArrowRight') $('rpNext').click(); else if (e.key === 'ArrowLeft') $('rpBack').click(); });
  addEventListener('resize', () => { if (S) go(at, false); });
})();
