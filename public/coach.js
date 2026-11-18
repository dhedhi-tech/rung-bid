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
    if (!m) { if (C) C.open = null; b.hidden = true; send('coach', { hold: false }); return; }
    C.open = m;
    show(m);
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    if (!m.ask) send('coach', { hold: true }); // the game waits while you read (your own turn has no timer anyway)
  }
  function show(m) {
    const b = el(), ur = isUr();
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
    C.off = true; C.queue = []; C.open = null; el().hidden = true; mark();
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
  function bidTip(a) {
    const h = a.hint, hand = S.hand || [];
    const of = hand.filter(c => c.s === h.suit), hi = of.filter(c => c.r >= 12);
    const best = `Your strongest suit is ${suitTxt(h.suit)} (${of.length} card${of.length === 1 ? '' : 's'}${hi.length ? ', with ' + hi.map(cardName).join(' ') : ''}).`;
    const bestU = `آپ کی سب سے مضبوط قسم ${suitU(h.suit)} ہے (${of.length} پتے${hi.length ? '، ' + hi.map(cardU).join(' ') : ''})۔`;
    const J = hand.some(isJ);
    let en = h.v ? `Coach pick: <b>bid ${h.v}</b>. ${best}${J ? ' Your Joker adds an extra trick too.' : ''} With your team's help that should be enough.`
      : h.partnerHolds ? `Coach pick: <b>Pass</b>. Your ${mate()} already holds the bid, so let them keep it.`
      : h.safe ? `Coach pick: <b>Pass</b>. Going this high is risky. Let them have it and break their bid instead: that scores double for your team.`
      : h.oppHolds ? `Coach pick: <b>Pass</b>. Your hand isn't strong enough to go higher. You can still break their bid when you play, and that scores double for your team.`
      : `Coach pick: <b>Pass</b>. ${best} That's an average hand, so let others bid. You can still bid in the next rounds.`;
    let ur = h.v ? `کوچ کی رائے: <b>${h.v} کی بولی لگائیں</b>۔ ${bestU}${J ? ' آپ کا جوکر بھی ایک ہاتھ اور دلائے گا۔' : ''} ٹیم کی مدد سے اتنا کافی ہونا چاہیے۔`
      : h.partnerHolds ? `کوچ کی رائے: <b>پاس</b>۔ بولی آپ کے ${mateU()} کے پاس ہے، انہیں رکھنے دیں۔`
      : h.safe ? `کوچ کی رائے: <b>پاس</b>۔ اتنی اونچی بولی خطرناک ہے۔ انہیں لینے دیں اور کھیل میں ان کی بولی توڑیں: اس پر آپ کی ٹیم کو دگنے نمبر ملتے ہیں۔`
      : h.oppHolds ? `کوچ کی رائے: <b>پاس</b>۔ آپ کے پتے اتنے مضبوط نہیں کہ اور اوپر جائیں۔ کھیلتے وقت آپ ان کی بولی توڑ سکتے ہیں، اس پر آپ کی ٹیم کو دگنے نمبر ملتے ہیں۔`
      : `کوچ کی رائے: <b>پاس</b>۔ ${bestU} یہ عام سے پتے ہیں، دوسروں کو بولی لگانے دیں۔ اگلے راؤنڈ میں آپ پھر بولی لگا سکتے ہیں۔`;
    if (!C.shown.has('bidRule')) { C.shown.add('bidRule'); en = 'Your turn to bid. A bid is how many of the 13 tricks your team promises to win. ' + en; ur = 'آپ کی بولی کی باری ہے۔ بولی کا مطلب ہے کہ 13 میں سے کتنے ہاتھ آپ کی ٹیم جیتے گی۔ ' + ur; }
    return T(en + ' The glowing button is my pick, but the choice is yours.', ur + ' چمکتا ہوا بٹن میری رائے ہے، لیکن فیصلہ آپ کا ہے۔');
  }
  function trumpTip(a) {
    const s = a.hint.s, of = (S.hand || []).filter(c => c.s === s), hi = of.filter(c => c.r >= 12);
    return T(`You hold the highest bid, so you choose <b>trump</b>. Coach pick: <b>${suitTxt(s)}</b>. You have ${of.length} of them${hi.length ? ' including ' + hi.map(cardName).join(' ') : ''}. More trumps (and high ones) means more tricks for your team.` +
      (a.current ? ' You can keep the same trump or change it.' : ''),
      `سب سے بڑی بولی آپ کی ہے، اس لیے <b>ترپ</b> آپ چنیں گے۔ کوچ کی رائے: <b>${suitU(s)}</b>۔ آپ کے پاس اس کے ${of.length} پتے ہیں${hi.length ? '، جن میں ' + hi.map(cardU).join(' ') + ' بھی ہیں' : ''}۔ جتنے زیادہ (اور بڑے) ترپ کے پتے، اتنے زیادہ ہاتھ۔` +
      (a.current ? ' آپ وہی ترپ رکھ سکتے ہیں یا بدل سکتے ہیں۔' : ''));
  }
  function playTip(a, once = true) {
    const h = a.hint, c = (S.hand || []).find(x => x.id === h.id), L = S.leadSuit ? suitTxt(S.leadSuit) : '', LU = S.leadSuit ? suitU(S.leadSuit) : '';
    const why = {
      leadTrump: T('Leading a high trump pulls out the opponents\' trumps.', 'ترپ کا بڑا پتا پہلے چلنے سے مخالفوں کے ترپ نکل جاتے ہیں۔'),
      leadBoss: T('It is the highest card left in its suit, so nobody can beat it.', 'یہ اپنی قسم کا سب سے بڑا بچا ہوا پتا ہے، اس سے بڑا کسی کے پاس نہیں۔'),
      leadLow: T('Lead a low card and save your high cards for later.', 'چھوٹا پتا چلیں اور بڑے پتے بعد کے لیے بچائیں۔'),
      joker: T('The other team is winning this trick. Your Joker flips it to your team!', 'یہ ہاتھ دوسری ٹیم جیت رہی ہے۔ آپ کا جوکر اسے آپ کی ٹیم کی طرف پلٹ دے گا!'),
      partnerWins: T(`Your ${mate()} is already winning this trick, so play your lowest card.`, `یہ ہاتھ آپ کا ${mateU()} جیت رہا ہے، اس لیے اپنا سب سے چھوٹا پتا ڈالیں۔`),
      cut: T(`You have no ${L} left, so cut with a trump. Any trump beats the other suits.`, `آپ کے پاس ${LU} نہیں بچا، اس لیے ترپ سے کاٹیں۔ ترپ کا ہر پتا باقی سب قسموں سے بڑا ہے۔`),
      win: T('This card beats everything played so far.', 'یہ پتا اب تک ڈالے گئے سب پتوں سے بڑا ہے۔'),
      cantWin: T(`You must follow ${L}, but you can't win this one, so play your lowest.`, `آپ کو ${LU} ہی ڈالنا ہے، لیکن یہ ہاتھ آپ نہیں جیت سکتے، اس لیے سب سے چھوٹا ڈالیں۔`),
      throwLow: T(`You have no ${L} and can't win this trick, so throw away a low card.`, `آپ کے پاس ${LU} نہیں اور یہ ہاتھ جیت نہیں سکتے، اس لیے کوئی چھوٹا پتا پھینک دیں۔`),
    }[h.why] || T('', '');
    let pre = T('', '');
    const add = (k, x) => { if (!once || !C.shown.has(k)) { if (once) C.shown.add(k); pre = T(pre.en + x.en, pre.ur + x.ur); } };
    add('playRule', !S.leadSuit ? T('You lead this trick, so you can play any card. ', 'یہ ہاتھ آپ شروع کریں گے، کوئی بھی پتا چل سکتے ہیں۔ ')
      : T('Glowing cards are the ones you can play. ', 'چمکتے ہوئے پتے ہی آپ چل سکتے ہیں۔ '));
    if (S.leadSuit && (S.hand || []).some(x => x.s === S.leadSuit)) add('follow', T(`You have ${L}, so you must follow that suit. `, `آپ کے پاس ${LU} ہے، اس لیے وہی ڈالنا ہوگا۔ `));
    let tap = T('', '');
    if (coarse && once && !C.shown.has('tap')) { C.shown.add('tap'); tap = T(' Tap a card twice to play it.', ' پتا چلنے کے لیے اس پر دو بار ٹیپ کریں۔'); }
    return T(pre.en + `Coach pick: <b>${c ? cardName(c) : 'the glowing card'}</b>. ` + why.en + tap.en,
      pre.ur + `کوچ کی رائے: <b>${c ? cardU(c) : 'چمکتا ہوا پتا'}</b>۔ ` + why.ur + tap.ur);
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
    if (S.phase === 'game' && S.handNo === 1 && C.over) { C.over = false; C.shown = new Set(['start', 'deals', 'decks', 'jokerMode', 'bidRule', 'playRule', 'follow', 'tap', 'end']);
      if (store.get('rb-coach') === '0' && S.guided) { C.off = true; send('coach', { off: true }); } }
    if (!on()) {
      const key = askKeyOf();
      if (key !== C.askKey) { C.askKey = key; if (C.hint) { C.hint = null; if (C.open && C.open.hintTip) next(); } }
      watchStuck(); mark(); return;
    }
    hintBtn().hidden = true; stuckKey = ''; C.hint = null;
    if (S.round === 1) {
      say('start', T(`<b>Welcome to guided practice!</b> I'll help you through your first game. You sit at the bottom. ${team()} <b class="pn ta">Orange</b> names are your team, <b class="pn tb">blue</b> are opponents. The bots wait for you, so take your time.`,
        `<b>گائیڈڈ پریکٹس میں خوش آمدید!</b> پہلی گیم میں میں آپ کی مدد کروں گا۔ آپ نیچے بیٹھے ہیں۔ ${teamU()} <b class="pn ta">نارنجی</b> نام آپ کی ٹیم ہیں، <b class="pn tb">نیلے</b> مخالف۔ بوٹس آپ کا انتظار کرتے ہیں، آرام سے کھیلیں۔`));
      say('deals', T('Cards come in 3 deals: 5, then 4, then 4 (13 each). After every deal there is a round of bidding. The highest bidder picks <b>trump</b>, the strongest suit for this hand.',
        'پتے 3 بار بٹتے ہیں: 5، پھر 4، پھر 4 (ہر ایک کو 13)۔ ہر بار کے بعد بولی لگتی ہے۔ سب سے بڑی بولی والا <b>ترپ</b> چنتا ہے، یعنی اس بازی کی سب سے طاقتور قسم۔'));
      if (S.n > 4) say('decks', T(`With ${S.n} players there are <b>2 decks</b>, so every card is there twice${S.n === 6 ? ' (the 2s, 3s and 4s are taken out)' : ''}. If two identical cards land in one trick, the one played <b>last</b> wins. So a second A♠ beats the first A♠!`,
        `${S.n} کھلاڑیوں میں <b>2 گڈیاں</b> ہوتی ہیں، اس لیے ہر پتا دو بار ہے${S.n === 6 ? ' (2، 3 اور 4 نکال دیے جاتے ہیں)' : ''}۔ اگر ایک ہاتھ میں دو ایک جیسے پتے آئیں تو <b>بعد میں</b> ڈالا گیا جیتتا ہے۔ یعنی دوسرا A♠ پہلے A♠ سے بڑا ہے!`));
      if (S.joker) say('jokerMode', T('<b>Joker mode:</b> there is a Joker in the deck, and it can flip a trick to the other team. I\'ll show you how it works.',
        '<b>جوکر موڈ:</b> گڈی میں ایک جوکر ہے جو ہاتھ کو دوسری ٹیم کی طرف پلٹ سکتا ہے۔ میں آپ کو دکھاؤں گا کیسے۔'));
    }
    if ((S.hand || []).some(isJ)) say('gotJoker', T(`You have the <b>Joker</b>! How it works:<br>• You can only play it when you have <b>no cards of the suit led</b>, and you can never lead with it.<br>• It <b>flips the trick</b>: the team that was losing takes it, and you lead next.<br>• Best time: when the other team is about to win a trick.<br>• Don't keep it to the very end. If you must lead and only the Joker is left, the other team gets that trick.`,
      `آپ کے پاس <b>جوکر</b> ہے! یہ ایسے کام کرتا ہے:<br>• یہ صرف تب ڈال سکتے ہیں جب آپ کے پاس <b>چلی گئی قسم کا کوئی پتا نہ ہو</b>، اور اس سے ہاتھ شروع نہیں کر سکتے۔<br>• یہ <b>ہاتھ پلٹ دیتا ہے</b>: ہارنے والی ٹیم ہاتھ لے لیتی ہے، اور اگلی چال آپ کی۔<br>• بہترین وقت: جب دوسری ٹیم ہاتھ جیتنے والی ہو۔<br>• اسے آخر تک نہ رکھیں۔ اگر آپ کو چال چلنی ہو اور صرف جوکر بچا ہو تو وہ ہاتھ دوسری ٹیم کا۔`), { pos: 'top' });
    if (S.round === 2 && S.gphase !== 'play') say('r2', T('Round 2: 4 more cards each. Bids can now go higher than 7. Whoever takes the bid can also pick a new trump.', 'راؤنڈ 2: سب کو 4 اور پتے۔ اب بولی 7 سے اوپر جا سکتی ہے۔ جو بولی لے وہ نیا ترپ بھی چن سکتا ہے۔'));
    if (S.round === 3 && S.gphase !== 'play') say('r3', T('Last 4 cards. This is the final round of bidding, then the play starts.', 'آخری 4 پتے۔ یہ بولی کا آخری راؤنڈ ہے، پھر کھیل شروع۔'));
    if (S.gphase === 'play' && S.bid && !C.shown.has('play' + S.handNo)) {
      const bt = S.bid.seat % 2, v = S.bid.value, nd = need();
      say('play' + S.handNo, T(`Bidding is done. ${teamName(bt)} bid <b>${v}</b> with ${suitTxt(S.trump)} trump, so they must win <b>${nd} tricks</b>${v === 6 ? ' (a bid of 6 still needs 7)' : ''}. ${bt === 0 ? 'The opponents need' : 'Your team needs'} ${14 - nd} to break it. ${esc(nm(S.bid.seat))} ${S.bid.seat === 0 ? 'lead' : 'leads'} the first trick.`,
        `بولی ختم۔ ${bt === 0 ? 'آپ کی ٹیم' : 'مخالفوں'} نے ${suitU(S.trump)} ترپ کے ساتھ <b>${v}</b> کی بولی لگائی، اس لیے انہیں <b>${nd} ہاتھ</b> جیتنے ہیں${v === 6 ? ' (6 کی بولی پر بھی 7 چاہئیں)' : ''}۔ ${bt === 0 ? 'مخالفوں کو' : 'آپ کی ٹیم کو'} اسے توڑنے کے لیے ${14 - nd} ہاتھ چاہئیں۔ پہلی چال ${S.bid.seat === 0 ? 'آپ چلیں گے' : esc(nm(S.bid.seat)) + ' چلیں گے'}۔`));
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
