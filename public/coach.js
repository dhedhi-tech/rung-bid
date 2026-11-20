/* Patta Party coach: guided practice. Tips during the first hand of a practice game with bots.
   Uses the game's globals from app.js (S, sock, send, $, SYM, SNAME, nm, teamName, need, store...).
   The server pauses the game while a tip is open (coach hold) and sends the bots' pick as ask.hint. */
(function () {
  let C = null; // per table: { code, shown, queue, open, off, plays, askKey }
  // Coach is on for the whole first game; afterwards only if the player turns it back on (🎓 button, rb-coach = '1')
  const reset = code => (C = { code, shown: new Set(), queue: [], open: null, off: false, plays: 0, askKey: '', over: false });
  const on = () => S && S.guided && C && !C.off && S.code === C.code && me0() && (S.phase === 'game' || S.phase === 'over');
  window.coachIsOn = () => !!(S && S.guided && C && !C.off);
  window.coachToggle = () => {
    if (!S) return;
    if (coachIsOn()) { skip(); store.set('rb-coach', '0'); }
    else { reset(S.code); C.shown.add('start'); store.set('rb-coach', '1'); send('coach', { on: true }); }
    setTimeout(() => { if (window.render) render(); }, 50);
  };
  const cardName = c => (isJ(c) ? 'Joker' : RL(c.r) + SYM[c.s]);
  const suitTxt = s => `${SYM[s]} ${SNAME[s]}`;
  const mate = () => (S.n === 4 ? 'partner' : 'teammate');
  const team = () => (S.n === 4 ? 'Your partner sits opposite you.' : 'Every second player is on your team.');
  // Urdu (اردو button in the tip window, saved in rb-coach-lang). Game words as card players say them: ترپ = trump, ہاتھ = trick, بازی = hand, بولی = bid
  const UNAME = { S: 'حکم', H: 'پان', D: 'اینٹ', C: 'چڑیا' };
  const cardU = c => (isJ(c) ? 'جوکر' : '<bdi dir="ltr">' + RL(c.r) + SYM[c.s] + '</bdi>'); // keeps K♦ the right way round in Urdu text
  const suitU = s => `${SYM[s]} ${UNAME[s]}`;
  const mateU = () => (S.n === 4 ? 'ساتھی' : 'ٹیم کا ساتھی');
  const teamU = () => (S.n === 4 ? 'آپ کا ساتھی آپ کے سامنے بیٹھا ہے۔' : 'ہر دوسرا کھلاڑی آپ کی ٹیم میں ہے۔');
  const nmU = seat => (seat === 0 ? 'آپ' : esc(nm(seat)));
  const T = (en, ur) => ({ en, ur });
  const isUr = () => store.get('rb-coach-lang') === 'ur';
  const txt = m => (typeof m === 'string' ? m : isUr() ? m.ur : m.en);

  /* ---------- bubble ---------- */
  function el() {
    let b = $('coach');
    if (!b) {
      b = document.createElement('div'); b.id = 'coach'; b.className = 'coach'; b.hidden = true;
      b.innerHTML = '<div class="coach-eye"><span class="coach-ic">🎓</span>Coach<button class="coach-lang" id="coachLang"></button></div><div class="coach-txt" id="coachTxt"></div><div class="coach-btns"><button class="linkbtn" id="coachSkip">Skip tips</button><button class="primary" id="coachOk">Got it</button></div>';
      document.body.appendChild(b);
      $('coachOk').onclick = next;
      $('coachSkip').onclick = skip;
      $('coachLang').onclick = () => { store.set('rb-coach-lang', isUr() ? 'en' : 'ur'); if (C && C.open) show(C.open); };
    }
    return b;
  }
  function say(key, html, opt = {}) {
    if (!C || C.shown.has(key)) return;
    C.shown.add(key);
    C.queue.push({ html, pos: opt.pos || 'hand', ask: !!opt.ask, end: !!opt.end, hintTip: !!opt.hintTip });
    if (!C.open) next();
  }
  function next() {
    const b = el();
    if (C && C.open && C.open.end) finished();
    const m = C && C.queue.shift();
    if (!m) { if (C) C.open = null; b.hidden = true; dim(false); send('coach', { hold: false }); return; }
    C.open = m;
    show(m);
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    if (!m.ask) send('coach', { hold: true }); // the game waits while you read (your own turn has no timer anyway)
  }
  function dim(on) {
    let d = $('coachDim');
    if (!d) { d = document.createElement('div'); d.id = 'coachDim'; d.className = 'coach-dim'; d.hidden = true; document.body.appendChild(d);
      d.onclick = () => { const ok = $('coachOk'); ok.classList.remove('nudge-ok'); void ok.offsetWidth; ok.classList.add('nudge-ok'); }; } // tapping outside points at the button
    d.hidden = !on;
  }
  function show(m) {
    const b = el(), ur = isUr();
    dim(!m.ask); // a tip that pauses the game dims everything else, so it's clear the game waits for "Got it"
    $('coachOk').classList.toggle('pulse', !m.ask);
    $('coachTxt').innerHTML = txt(m.html);
    $('coachTxt').dir = ur ? 'rtl' : 'ltr'; $('coachTxt').classList.toggle('ur', ur);
    $('coachLang').textContent = ur ? 'English' : 'اردو';
    place(b, m.pos);
    $('coachSkip').hidden = m.end || m.hintTip;
    $('coachSkip').textContent = ur ? 'ٹپس بند کریں' : 'Skip tips';
    $('coachOk').textContent = m.end ? (ur ? 'کھیلیں' : "Let's play") : (ur ? 'ٹھیک ہے' : 'Got it');
    b.hidden = false;
  }
  // top: over the score bar (bid and trump panels sit mid-table). hand: just above your cards, so the table stays visible. low: bottom of the screen.
  function place(b, pos) {
    b.classList.toggle('low', pos !== 'top');
    const h = $('hand');
    b.style.bottom = pos === 'hand' && h ? Math.max(12, innerHeight - h.getBoundingClientRect().top + 44) + 'px' : ''; // room for the arrow
  }
  function skip() {
    if (!C) return;
    C.off = true; C.queue = []; C.open = null; el().hidden = true; dim(false); mark();
    send('coach', { off: true });
  }
  function finished() { store.set('rb-coached', '1'); }
  function closeAskTip() { if (C && C.open && C.open.ask) next(); }

  /* ---------- glow on the coach's pick ---------- */
  let arrowFor = null;
  function arrow(t) {
    let a = $('coachArrow');
    if (!a) { a = document.createElement('div'); a.id = 'coachArrow'; a.className = 'coach-arrow'; a.textContent = '👇'; document.body.appendChild(a); }
    arrowFor = t || null;
    if (!t) { a.hidden = true; return; }
    const r = t.getBoundingClientRect();
    a.style.left = (t.classList.contains('card') ? r.left + Math.min(r.width / 2, 24) : r.left + r.width / 2) + 'px'; a.style.top = (r.top + 2) + 'px'; a.hidden = false;
  }
  addEventListener('resize', () => arrowFor && arrow(arrowFor.isConnected ? arrowFor : null));
  function mark() {
    document.querySelectorAll('.coach-pick').forEach(x => x.classList.remove('coach-pick'));
    arrow(null);
    const h = S && S.ask && (S.ask.hint || (C && C.hint && C.hint.key === C.askKey && C.hint.hint));
    if (!S || !S.ask || !h || !(on() || (C && C.hint))) return;
    const a = S.ask;
    const t = a.kind === 'bid' ? $('panelBody') && $('panelBody').querySelector(`button[data-v="${h.v || 0}"]`)
      : a.kind === 'trump' ? $('panelBody') && $('panelBody').querySelector(`button[data-s="${h.s}"]`)
      : $('hand').querySelector(`.card[data-id="${h.id}"]`);
    if (t) { t.classList.add('coach-pick'); requestAnimationFrame(() => arrow(t)); }
  }
  new MutationObserver(mark).observe($('hand'), { childList: true });
  new MutationObserver(mark).observe($('panelBody'), { childList: true });

  /* ---------- tips for your turn (English + Urdu) ---------- */
  // Short tips: what to tap first (big), one short reason after. New players left when the tips were walls of text.
  const head = (en, ur) => T(`<span class="tip-do">👇 ${en}</span>`, `<span class="tip-do">👇 ${ur}</span>`);
  const join = (...xs) => T(xs.map(x => x.en).join(' '), xs.map(x => x.ur).join(' '));
  function bidTip(a) {
    const h = a.hint, J = (S.hand || []).some(isJ);
    const what = h.v ? head(`Tap <b>${h.v}</b>`, `<b>${h.v}</b> پر ٹیپ کریں`) : head('Tap <b>Pass</b>', '<b>پاس</b> پر ٹیپ کریں');
    const why = h.v ? T(`Your ${suitTxt(h.suit)} cards are strong.${J ? ' Your Joker helps too.' : ''}`, `آپ کے ${suitU(h.suit)} کے پتے مضبوط ہیں۔${J ? ' جوکر بھی مدد کرے گا۔' : ''}`)
      : h.partnerHolds ? T(`Your ${mate()} has the bid.`, `بولی آپ کے ${mateU()} کے پاس ہے۔`)
      : h.safe ? T('Too risky. Break their bid instead.', 'بہت خطرہ ہے۔ ان کی بولی توڑیں۔')
      : h.oppHolds ? T('Your cards are not strong enough.', 'آپ کے پتے اتنے مضبوط نہیں۔')
      : T('Average cards. You can bid next round.', 'عام سے پتے ہیں۔ اگلے راؤنڈ میں بولی لگا سکتے ہیں۔');
    let rule = T('', '');
    if (!C.shown.has('bidRule')) { C.shown.add('bidRule'); rule = T('Bid = how many tricks (out of 13) your team will win.', 'بولی = آپ کی ٹیم 13 میں سے کتنے ہاتھ جیتے گی۔'); }
    return join(what, rule, why);
  }
  function trumpTip(a) {
    const s = a.hint.s, n = (S.hand || []).filter(c => c.s === s).length;
    return join(head(`Tap <b>${suitTxt(s)}</b>`, `<b>${suitU(s)}</b> پر ٹیپ کریں`),
      T(`You won the bid, so you pick <b>trump</b>. You have ${n} ${SNAME[s]}.`, `بولی آپ کی ہے، اس لیے <b>ترپ</b> آپ چنیں گے۔ آپ کے پاس ${n} ${UNAME[s]} ہیں۔`));
  }
  function playTip(a, once = true) {
    const h = a.hint, c = (S.hand || []).find(x => x.id === h.id), L = S.leadSuit ? suitTxt(S.leadSuit) : '', LU = S.leadSuit ? suitU(S.leadSuit) : '';
    const why = {
      leadTrump: T('A high trump pulls out their trumps.', 'بڑا ترپ چلنے سے مخالفوں کے ترپ نکل جاتے ہیں۔'),
      leadBoss: T('Nobody can beat it.', 'اس سے بڑا پتا کسی کے پاس نہیں۔'),
      leadLow: T('Keep your high cards for later.', 'بڑے پتے بعد کے لیے بچائیں۔'),
      joker: T('Your Joker flips this trick to your team!', 'آپ کا جوکر یہ ہاتھ آپ کی ٹیم کی طرف پلٹ دے گا!'),
      partnerWins: T(`Your ${mate()} is winning, so play low.`, `آپ کا ${mateU()} جیت رہا ہے، اس لیے چھوٹا پتا ڈالیں۔`),
      secure: T("Your team is winning, but others can still beat it. This card makes it safe.", 'آپ کی ٹیم جیت رہی ہے، لیکن دوسرے ابھی بڑا پتا ڈال سکتے ہیں۔ یہ پتا ہاتھ پکا کر دے گا۔'),
      cut: T(`No ${L} left, so cut with trump. Trump beats the other suits.`, `${LU} نہیں بچا، اس لیے ترپ سے کاٹیں۔ ترپ باقی سب سے بڑا ہے۔`),
      win: T('It beats every card played so far.', 'یہ اب تک کے سب پتوں سے بڑا ہے۔'),
      cantWin: T("You can't win this one, so play your lowest.", 'یہ ہاتھ نہیں جیت سکتے، اس لیے سب سے چھوٹا ڈالیں۔'),
      throwLow: T(`No ${L} and you can't win, so throw a low card.`, `${LU} نہیں اور جیت نہیں سکتے، اس لیے چھوٹا پتا پھینک دیں۔`),
    }[h.why] || T('', '');
    let pre = T('', '');
    const add = (k, x) => { if (!once || !C.shown.has(k)) { if (once) C.shown.add(k); pre = T(pre.en + x.en, pre.ur + x.ur); } };
    add('playRule', !S.leadSuit ? T('You start this trick: any card is OK.', 'یہ ہاتھ آپ شروع کریں گے، کوئی بھی پتا چل سکتا ہے۔')
      : T('', ''));
    if (S.leadSuit && (S.hand || []).some(x => x.s === S.leadSuit)) add('follow', T(`You have ${L}, so you must play ${L}.`, `آپ کے پاس ${LU} ہے، اس لیے وہی ڈالنا ہوگا۔`));
    const what = c ? head(`Tap <b>${cardName(c)}</b>${coarse ? ' twice' : ''}`, `<b>${cardU(c)}</b> پر ${coarse ? 'دو بار ' : ''}ٹیپ کریں`)
      : head(`Tap the glowing card${coarse ? ' twice' : ''}`, `چمکتے پتے پر ${coarse ? 'دو بار ' : ''}ٹیپ کریں`);
    return join(what, pre, why);
  }
  const askKeyOf = () => { const a = S.ask; return a ? a.kind + ':' + S.round + ':' + (S.hist || []).length + ':' + (S.trick || []).length + ':' + (S.hand || []).length : ''; };
  function onAsk() {
    const a = S.ask, key = askKeyOf();
    if (key === C.askKey) return;
    C.askKey = key;
    if (!a) { closeAskTip(); return; }
    if (!a.hint) return;
    if (a.kind === 'bid') say('ask' + key, bidTip(a), { ask: true, pos: 'top' });
    else if (a.kind === 'trump') say('ask' + key, trumpTip(a), { ask: true, pos: 'top' });
    else if (a.kind === 'play') { C.plays++; say('ask' + key, playTip(a), { ask: true }); } // a tip on every turn while the coach is on
  }

  /* ---------- 💡 Hint: tutorial off, playing alone with bots, after the first game. Appears when you seem stuck ---------- */
  const STUCK_MS = { play: 6000, bid: 9000, trump: 9000 };
  let stuckTimer = null, stuckKey = '';
  function hintBtn() {
    let b = $('hintBtn');
    if (!b) { b = document.createElement('button'); b.id = 'hintBtn'; b.className = 'hint-btn'; b.hidden = true; document.body.appendChild(b); b.onclick = askHint; }
    return b;
  }
  const hintable = () => !!(S && S.coachable && !on() && store.get('rb-first') === 'done' && S.ask && me0() && S.phase === 'game');
  function watchStuck() {
    const b = hintBtn(), key = hintable() ? C.askKey : '';
    if (key === stuckKey) return;
    stuckKey = key; clearTimeout(stuckTimer); b.hidden = true;
    if (!key) return;
    b.textContent = isUr() ? '💡 مدد' : '💡 Hint';
    const ms = STUCK_MS[S.ask.kind] || 8000;
    stuckTimer = setTimeout(() => { if (stuckKey === key && hintable()) { b.hidden = false; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } }, ms);
  }
  async function askHint() {
    hintBtn().hidden = true;
    const r = await send('hint'); if (!r || r.error || !r.hint || !S || !S.ask) return;
    const a = { ...S.ask, hint: r.hint }, key = C.askKey;
    C.hint = { key, hint: r.hint };
    const left = r.left > 0 ? T(` <small>(${r.left} more hint${r.left === 1 ? '' : 's'} this game and a win still counts as your own)</small>`, ` <small>(اس گیم میں ${r.left} اور مدد لے کر بھی جیت آپ کی اپنی گنی جائے گی)</small>`)
      : T(' <small>(More hints this game: a win then won\'t level you up)</small>', ' <small>(اس گیم میں مزید مدد لی تو جیت پر لیول نہیں بڑھے گا)</small>');
    const tip = a.kind === 'bid' ? bidTip(a) : a.kind === 'trump' ? trumpTip(a) : playTip(a, false);
    C.shown.delete('hint' + key);
    say('hint' + key, T(tip.en + left.en, tip.ur + left.ur), { ask: true, hintTip: true, pos: a.kind === 'play' ? 'hand' : 'top' });
    mark();
  }

  /* ---------- tips for moments in the hand ---------- */
  function onState() {
    if (!S) return;
    if (!C || C.code !== S.code) { reset(S.code); if (store.get('rb-coach') === '0' && store.get('rb-first') === 'done' && S.guided && me0()) { C.off = true; send('coach', { off: true }); } }
    // First game over: from now on the coach is off unless the player turns it on (Tutorial switch)
    if (S.phase === 'over' && !C.over) { C.over = true; if (store.get('rb-coach') == null) store.set('rb-coach', '0'); store.set('rb-first', 'done'); }
    if (S.phase === 'game' && S.handNo === 1 && C.over) { C.over = false; C.shown = new Set(['start', 'team', 'deals', 'decks', 'jokerMode', 'bidRule', 'playRule', 'follow', 'tap', 'end']);
      if (store.get('rb-coach') === '0' && S.guided) { C.off = true; send('coach', { off: true }); } }
    if (!on()) {
      const key = askKeyOf();
      if (key !== C.askKey) { C.askKey = key; if (C.hint) { C.hint = null; if (C.open && C.open.hintTip) next(); } }
      watchStuck(); mark(); return;
    }
    hintBtn().hidden = true; stuckKey = ''; C.hint = null;
    if (S.round === 1) {
      // First tip: short, in both languages at once, so nobody is stuck on a wall of text
      const hi = `<span class="hi-en">👋 <b>Welcome!</b> I'm your coach. I'll show you what to tap, step by step.</span><span class="hi-ur" dir="rtl">👋 <b>خوش آمدید!</b> میں آپ کا کوچ ہوں۔ میں بتاؤں گا کہاں ٹیپ کرنا ہے۔</span>`;
      say('start', T(hi, hi));
      say('team', T(`You sit at the bottom. ${team()} <b class="pn ta">Orange</b> = your team, <b class="pn tb">blue</b> = opponents. Take your time, the bots wait for you.`,
        `آپ نیچے بیٹھے ہیں۔ ${teamU()} <b class="pn ta">نارنجی</b> = آپ کی ٹیم، <b class="pn tb">نیلے</b> = مخالف۔ آرام سے کھیلیں، بوٹس آپ کا انتظار کرتے ہیں۔`));
      say('deals', T('Cards come in 3 deals: 5, then 4, then 4. You bid after each deal.',
        'پتے 3 بار بٹتے ہیں: 5، پھر 4، پھر 4۔ ہر بار کے بعد بولی ہوتی ہے۔'));
      if (S.n > 4) say('decks', T(`With ${S.n} players there are <b>2 decks</b>, so every card is there twice${S.n === 6 ? ' (the 2s, 3s and 4s are taken out)' : ''}. If two identical cards land in one trick, the one played <b>last</b> wins. So a second A♠ beats the first A♠!`,
        `${S.n} کھلاڑیوں میں <b>2 گڈیاں</b> ہوتی ہیں، اس لیے ہر پتا دو بار ہے${S.n === 6 ? ' (2، 3 اور 4 نکال دیے جاتے ہیں)' : ''}۔ اگر ایک ہاتھ میں دو ایک جیسے پتے آئیں تو <b>بعد میں</b> ڈالا گیا جیتتا ہے۔ یعنی دوسرا A♠ پہلے A♠ سے بڑا ہے!`));
      if (S.joker) say('jokerMode', T('<b>Joker mode:</b> there is a Joker in the deck, and it can flip a trick to the other team. I\'ll show you how it works.',
        '<b>جوکر موڈ:</b> گڈی میں ایک جوکر ہے جو ہاتھ کو دوسری ٹیم کی طرف پلٹ سکتا ہے۔ میں آپ کو دکھاؤں گا کیسے۔'));
    }
    if ((S.hand || []).some(isJ)) say('gotJoker', T(`You have the <b>Joker</b>! How it works:<br>• You can only play it when you have <b>no cards of the suit led</b>, and you can never lead with it.<br>• It <b>flips the trick</b>: the team that was losing takes it, and you lead next.<br>• Best time: when the other team is about to win a trick.<br>• Don't keep it to the very end. If you must lead and only the Joker is left, the other team gets that trick.`,
      `آپ کے پاس <b>جوکر</b> ہے! یہ ایسے کام کرتا ہے:<br>• یہ صرف تب ڈال سکتے ہیں جب آپ کے پاس <b>چلی گئی قسم کا کوئی پتا نہ ہو</b>، اور اس سے ہاتھ شروع نہیں کر سکتے۔<br>• یہ <b>ہاتھ پلٹ دیتا ہے</b>: ہارنے والی ٹیم ہاتھ لے لیتی ہے، اور اگلی چال آپ کی۔<br>• بہترین وقت: جب دوسری ٹیم ہاتھ جیتنے والی ہو۔<br>• اسے آخر تک نہ رکھیں۔ اگر آپ کو چال چلنی ہو اور صرف جوکر بچا ہو تو وہ ہاتھ دوسری ٹیم کا۔`), { pos: 'top' });
    if (S.round === 2 && S.gphase !== 'play') say('r2', T('Round 2: 4 more cards. Bid again (now up to 13).', 'راؤنڈ 2: 4 اور پتے۔ پھر سے بولی (اب 13 تک)۔'));
    if (S.round === 3 && S.gphase !== 'play') say('r3', T('Last 4 cards. Last chance to bid.', 'آخری 4 پتے۔ بولی کا آخری موقع۔'));
    if (S.gphase === 'play' && S.bid && !C.shown.has('play' + S.handNo)) {
      const bt = S.bid.seat % 2, v = S.bid.value, nd = need();
      say('play' + S.handNo, bt === 0 ? T(`Bidding done. Your team must win <b>${nd} tricks</b>.`, `بولی ختم۔ آپ کی ٹیم کو <b>${nd} ہاتھ</b> جیتنے ہیں۔`)
        : T(`Bidding done. Opponents need ${nd} tricks. Win <b>${14 - nd}</b> to break their bid.`, `بولی ختم۔ مخالفوں کو ${nd} ہاتھ چاہئیں۔ <b>${14 - nd}</b> ہاتھ جیت کر ان کی بولی توڑیں۔`));
    }
    onAsk();
    mark();
  }
  function onFxCoach(f) {
    if (!S || !C || !on()) return;
    switch (f.type) {
      case 'trump':
        if (S.round === 1) say('trump', T(`Trump is <b>${suitTxt(f.s)}</b>. For this hand, any ${SYM[f.s]} card beats every card of the other suits.`, `ترپ <b>${suitU(f.s)}</b> ہے۔ اس بازی میں ${SYM[f.s]} کا ہر پتا باقی سب قسموں کے پتوں سے بڑا ہے۔`));
        break;
      case 'trick': {
        // Two decks: the winning card had an identical twin played earlier in this trick
        const tr = S.trick || [], wi = tr.findIndex(t => t.seat === f.showSeat && t.card.id === f.showId), wc = wi >= 0 ? tr[wi].card : null;
        if (wc && !isJ(wc) && tr.slice(0, wi).some(t => t.card.s === wc.s && t.card.r === wc.r)) say('twin', T(`Two <b>${cardName(wc)}</b> in one trick! With 2 decks, the one played <b>last</b> wins, so ${esc(nm(f.showSeat))} ${f.showSeat === 0 ? 'take' : 'takes'} it.`,
          `ایک ہاتھ میں دو <b>${cardU(wc)}</b>! 2 گڈیوں میں <b>بعد والا</b> جیتتا ہے، اس لیے یہ ہاتھ ${f.showSeat === 0 ? 'آپ کا' : esc(nm(f.showSeat)) + ' کا'}۔`));
        if (!f.flipped) say('trick', T(`${f.team === 0 ? '<b>Your team won the trick!</b>' : 'The opponents won that trick.'} The highest card of the suit led wins, unless someone plays a trump. Whoever wins leads the next trick.`,
          `${f.team === 0 ? '<b>آپ کی ٹیم نے ہاتھ جیت لیا!</b>' : 'یہ ہاتھ مخالفوں نے جیتا۔'} چلی گئی قسم کا سب سے بڑا پتا جیتتا ہے، سوائے اس کے کہ کوئی ترپ ڈال دے۔ جو جیتے وہ اگلی چال چلتا ہے۔`));
        break;
      }
      case 'joker':
        if (f.second) say('joker2', T('A second Joker! Two Jokers <b>cancel each other</b>, so the highest card takes the trick. The second Joker player leads next.', 'دوسرا جوکر! دو جوکر <b>ایک دوسرے کو ختم کر دیتے ہیں</b>، اس لیے سب سے بڑا پتا ہاتھ لیتا ہے۔ دوسرے جوکر والا اگلی چال چلتا ہے۔'));
        else if (f.seat !== 0) say('joker1', T(`${esc(nm(f.seat))} played the <b>Joker</b>! It flips the trick: the team that was losing now takes it, and ${esc(nm(f.seat))} leads next.`, `${esc(nm(f.seat))} نے <b>جوکر</b> ڈالا! یہ ہاتھ پلٹ دیتا ہے: ہارنے والی ٹیم ہاتھ لے لیتی ہے، اور اگلی چال ${esc(nm(f.seat))} کی۔`));
        break;
      case 'stuck':
        say('stuck', T(`${esc(nm(f.seat))} had to lead with only a Joker left, so the other team takes that trick. That's why you shouldn't save a Joker till the end.`, `${nmU(f.seat)} کو صرف جوکر کے ساتھ چال چلنی پڑی، اس لیے وہ ہاتھ دوسری ٹیم کا۔ اسی لیے جوکر کو آخر تک نہ رکھیں۔`));
        break;
      case 'handEnd': {
        const R = S.result; if (!R) break;
        const bt = R.winner, kind = R.kind;
        const to = `<b>${R.pts} points</b> go to ${bt === 0 ? 'your team' : 'the opponents'}`;
        const toU = `<b>${R.pts} نمبر</b> ${bt === 0 ? 'آپ کی ٹیم' : 'مخالفوں'} کو ملے`;
        const res = kind === 'made' ? T(`The bidding team won enough tricks, so ${to}.`, `بولی والی ٹیم نے پورے ہاتھ جیت لیے، اس لیے ${toU}۔`)
          : kind === 'sweep' ? T(`The bidding team won every single trick, so they score double: ${to}.`, `بولی والی ٹیم نے سارے ہاتھ جیت لیے، اس لیے دگنے نمبر: ${toU}۔`)
          : kind === 'broken' ? T(`The bid was broken, so the defending team scores double: ${to}.`, `بولی ٹوٹ گئی، اس لیے دوسری ٹیم کو دگنے نمبر: ${toU}۔`)
          : T(`The bidding team didn't win a single trick, so the defenders score 4×: ${to}.`, `بولی والی ٹیم ایک ہاتھ بھی نہ جیت سکی، اس لیے دوسری ٹیم کو 4 گنا: ${toU}۔`);
        say('end', T(`${res.en} The score bar at the top is a tug of war: the first team to lead by <b>52</b> wins the game.<br><br>I'll keep showing my pick (it glows) for the rest of this game. Tap <b>Skip tips</b> or the <b>Tutorial</b> switch to turn me off.`,
          `${res.ur} اوپر اسکور کی پٹی رسہ کشی جیسی ہے: جو ٹیم پہلے <b>52</b> سے آگے ہو جائے وہ گیم جیتتی ہے۔<br><br>اس گیم میں آگے بھی میں اپنی رائے دکھاتا رہوں گا (چمکتا ہوا پتا)۔ مجھے بند کرنے کے لیے <b>ٹپس بند کریں</b> یا <b>ٹیوٹوریل</b> بٹن دبائیں۔`), { pos: 'low', end: true });
        break;
      }
    }
  }
  window.coachTick = () => setTimeout(onState, 0); // called by app.js after every state it shows
  sock.on('fx', f => setTimeout(() => onFxCoach(f), 0));
})();
