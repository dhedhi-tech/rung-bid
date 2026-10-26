/* Patta Party coach: guided practice. Tips during the first hand of a practice game with bots.
   Uses the game's globals from app.js (S, sock, send, $, SYM, SNAME, nm, teamName, need, store...).
   The server pauses the game while a tip is open (coach hold) and sends the bots' pick as ask.hint. */
(function () {
  let C = null; // per table: { code, shown, queue, open, off, plays, askKey }
  const reset = code => (C = { code, shown: new Set(), queue: [], open: null, off: false, plays: 0, askKey: '' });
  const on = () => S && S.guided && C && !C.off && S.code === C.code && me0() && (S.phase === 'game' || S.phase === 'over') && S.handNo === 1;
  const cardName = c => (isJ(c) ? 'Joker' : RL(c.r) + SYM[c.s]);
  const suitTxt = s => `${SYM[s]} ${SNAME[s]}`;
  const mate = () => (S.n === 4 ? 'partner' : 'teammate');
  const team = () => (S.n === 4 ? 'Your partner sits opposite you.' : 'Every second player is on your team.');

  /* ---------- bubble ---------- */
  function el() {
    let b = $('coach');
    if (!b) {
      b = document.createElement('div'); b.id = 'coach'; b.className = 'coach'; b.hidden = true;
      b.innerHTML = '<div class="coach-eye"><span class="coach-ic">🎓</span>Coach</div><div class="coach-txt" id="coachTxt"></div><div class="coach-btns"><button class="linkbtn" id="coachSkip">Skip tips</button><button class="primary" id="coachOk">Got it</button></div>';
      document.body.appendChild(b);
      $('coachOk').onclick = next;
      $('coachSkip').onclick = skip;
    }
    return b;
  }
  function say(key, html, opt = {}) {
    if (!C || C.shown.has(key)) return;
    C.shown.add(key);
    C.queue.push({ html, pos: opt.pos || 'hand', ask: !!opt.ask, end: !!opt.end });
    if (!C.open) next();
  }
  function next() {
    const b = el();
    if (C && C.open && C.open.end) finished();
    const m = C && C.queue.shift();
    if (!m) { if (C) C.open = null; b.hidden = true; send('coach', { hold: false }); return; }
    C.open = m;
    $('coachTxt').innerHTML = m.html;
    place(b, m.pos);
    $('coachSkip').hidden = m.end;
    $('coachOk').textContent = m.end ? "Let's play" : 'Got it';
    b.hidden = false; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    if (!m.ask) send('coach', { hold: true }); // the game waits while you read (your own turn has no timer anyway)
  }
  // top: over the score bar (bid and trump panels sit mid-table). hand: just above your cards, so the table stays visible. low: bottom of the screen.
  function place(b, pos) {
    b.classList.toggle('low', pos !== 'top');
    const h = $('hand');
    b.style.bottom = pos === 'hand' && h ? Math.max(12, innerHeight - h.getBoundingClientRect().top + 6) + 'px' : '';
  }
  function skip() {
    if (!C) return;
    C.off = true; C.queue = []; C.open = null; el().hidden = true; mark();
    send('coach', { off: true });
  }
  function finished() { store.set('rb-coached', '1'); }
  function closeAskTip() { if (C && C.open && C.open.ask) next(); }

  /* ---------- glow on the coach's pick ---------- */
  function mark() {
    document.querySelectorAll('.coach-pick').forEach(x => x.classList.remove('coach-pick'));
    if (!on() || !S.ask || !S.ask.hint) return;
    const a = S.ask, h = a.hint;
    const t = a.kind === 'bid' ? $('panelBody') && $('panelBody').querySelector(`button[data-v="${h.v || 0}"]`)
      : a.kind === 'trump' ? $('panelBody') && $('panelBody').querySelector(`button[data-s="${h.s}"]`)
      : $('hand').querySelector(`.card[data-id="${h.id}"]`);
    if (t) t.classList.add('coach-pick');
  }
  new MutationObserver(mark).observe($('hand'), { childList: true });
  new MutationObserver(mark).observe($('panelBody'), { childList: true });

  /* ---------- tips for your turn ---------- */
  function bidTip(a) {
    const h = a.hint, hand = S.hand || [];
    const of = hand.filter(c => c.s === h.suit), hi = of.filter(c => c.r >= 12).map(cardName);
    const best = `Your strongest suit is ${suitTxt(h.suit)} (${of.length} card${of.length === 1 ? '' : 's'}${hi.length ? ', with ' + hi.join(' ') : ''}).`;
    const jk = hand.some(isJ) ? ' Your Joker adds an extra trick too.' : '';
    let t = h.v ? `Coach pick: <b>bid ${h.v}</b>. ${best}${jk} With your team's help that should be enough.`
      : h.partnerHolds ? `Coach pick: <b>Pass</b>. Your ${mate()} already holds the bid, so let them keep it.`
      : h.safe ? `Coach pick: <b>Pass</b>. Going this high is risky. Let them have it and break their bid instead: that scores double for your team.`
      : h.oppHolds ? `Coach pick: <b>Pass</b>. Your hand isn't strong enough to go higher. You can still break their bid when you play, and that scores double for your team.`
      : `Coach pick: <b>Pass</b>. ${best} That's an average hand, so let others bid. You can still bid in the next rounds.`;
    if (!C.shown.has('bidRule')) { C.shown.add('bidRule'); t = 'Your turn to bid. A bid is how many of the 13 tricks your team promises to win. ' + t; }
    return t + ' The glowing button is my pick, but the choice is yours.';
  }
  function trumpTip(a) {
    const s = a.hint.s, of = (S.hand || []).filter(c => c.s === s), hi = of.filter(c => c.r >= 12).map(cardName);
    return `You hold the highest bid, so you choose <b>trump</b>. Coach pick: <b>${suitTxt(s)}</b>. You have ${of.length} of them${hi.length ? ' including ' + hi.join(' ') : ''}. More trumps (and high ones) means more tricks for your team.` +
      (a.current ? ' You can keep the same trump or change it.' : '');
  }
  function playTip(a) {
    const h = a.hint, c = (S.hand || []).find(x => x.id === h.id), L = S.leadSuit ? suitTxt(S.leadSuit) : '';
    const pick = `Coach pick: <b>${c ? cardName(c) : 'the glowing card'}</b>.`;
    const why = {
      leadTrump: 'Leading a high trump pulls out the opponents\' trumps.',
      leadBoss: 'It is the highest card left in its suit, so nobody can beat it.',
      leadLow: 'Lead a low card and save your high cards for later.',
      joker: 'The other team is winning this trick. Your Joker flips it to your team!',
      partnerWins: `Your ${mate()} is already winning this trick, so play your lowest card.`,
      cut: `You have no ${L} left, so cut with a trump. Any trump beats the other suits.`,
      win: 'This card beats everything played so far.',
      cantWin: `You must follow ${L}, but you can't win this one, so play your lowest.`,
      throwLow: `You have no ${L} and can't win this trick, so throw away a low card.`,
    }[h.why] || '';
    let pre = '';
    if (!C.shown.has('playRule')) { C.shown.add('playRule'); pre = !S.leadSuit ? 'You lead this trick, so you can play any card. ' : 'Glowing cards are the ones you can play. '; }
    if (S.leadSuit && (S.hand || []).some(x => x.s === S.leadSuit) && !C.shown.has('follow')) { C.shown.add('follow'); pre += `You have ${L}, so you must follow that suit. `; }
    return pre + pick + ' ' + why + (coarse && !C.shown.has('tap') ? (C.shown.add('tap'), ' Tap a card twice to play it.') : '');
  }
  function onAsk() {
    const a = S.ask;
    const key = a ? a.kind + ':' + S.round + ':' + (S.hist || []).length + ':' + (S.trick || []).length + ':' + (S.hand || []).length : '';
    if (key === C.askKey) return;
    C.askKey = key;
    if (!a) { closeAskTip(); return; }
    if (!a.hint) return;
    if (a.kind === 'bid') say('ask' + key, bidTip(a), { ask: true, pos: 'top' });
    else if (a.kind === 'trump') say('ask' + key, trumpTip(a), { ask: true, pos: 'top' });
    else if (a.kind === 'play') {
      C.plays++;
      // Full tip for the first 3 turns and for special moments; after that only the glow
      if (C.plays <= 3 || ['joker', 'cut'].includes(a.hint.why) && !C.shown.has('why:' + a.hint.why)) {
        C.shown.add('why:' + a.hint.why);
        say('ask' + key, playTip(a), { ask: true });
      }
    }
  }

  /* ---------- tips for moments in the hand ---------- */
  function onState() {
    if (!S) return;
    if (!C || C.code !== S.code) reset(S.code);
    if (!on()) { mark(); return; }
    if (S.round === 1) {
      say('start', `<b>Welcome to guided practice!</b> I'll help you through your first hand. You sit at the bottom. ${team()} <b class="pn ta">Orange</b> names are your team, <b class="pn tb">blue</b> are opponents. The bots wait for you, so take your time.`);
      say('deals', 'Cards come in 3 deals: 5, then 4, then 4 (13 each). After every deal there is a round of bidding. The highest bidder picks <b>trump</b>, the strongest suit for this hand.');
      if (S.n > 4) say('decks', `With ${S.n} players there are <b>2 decks</b>, so every card is there twice${S.n === 6 ? ' (the 2s, 3s and 4s are taken out)' : ''}. If two identical cards land in one trick, the one played <b>last</b> wins. So a second A♠ beats the first A♠!`);
      if (S.joker) say('jokerMode', '<b>Joker mode:</b> there is a Joker in the deck, and it can flip a trick to the other team. I\'ll show you how it works.');
    }
    if ((S.hand || []).some(isJ)) say('gotJoker', `You have the <b>Joker</b>! How it works:<br>• You can only play it when you have <b>no cards of the suit led</b>, and you can never lead with it.<br>• It <b>flips the trick</b>: the team that was losing takes it, and you lead next.<br>• Best time: when the other team is about to win a trick.<br>• Don't keep it to the very end. If you must lead and only the Joker is left, the other team gets that trick.`, { pos: 'top' });
    if (S.round === 2 && S.gphase !== 'play') say('r2', 'Round 2: 4 more cards each. Bids can now go higher than 7. Whoever takes the bid can also pick a new trump.');
    if (S.round === 3 && S.gphase !== 'play') say('r3', 'Last 4 cards. This is the final round of bidding, then the play starts.');
    if (S.gphase === 'play' && S.bid && !C.shown.has('play')) {
      const bt = S.bid.seat % 2, v = S.bid.value, nd = need();
      say('play', `Bidding is done. ${teamName(bt)} bid <b>${v}</b> with ${suitTxt(S.trump)} trump, so they must win <b>${nd} tricks</b>${v === 6 ? ' (a bid of 6 still needs 7)' : ''}. ${bt === 0 ? 'The opponents need' : 'Your team needs'} ${14 - nd} to break it. ${esc(nm(S.bid.seat))} ${S.bid.seat === 0 ? 'lead' : 'leads'} the first trick.`);
    }
    onAsk();
    mark();
  }
  function onFxCoach(f) {
    if (!S || !C || !on()) return;
    switch (f.type) {
      case 'trump':
        if (S.round === 1) say('trump', `Trump is <b>${suitTxt(f.s)}</b>. For this hand, any ${SYM[f.s]} card beats every card of the other suits.`);
        break;
      case 'trick': {
        // Two decks: the winning card had an identical twin played earlier in this trick
        const tr = S.trick || [], wi = tr.findIndex(t => t.seat === f.showSeat && t.card.id === f.showId), wc = wi >= 0 ? tr[wi].card : null;
        if (wc && !isJ(wc) && tr.slice(0, wi).some(t => t.card.s === wc.s && t.card.r === wc.r)) say('twin', `Two <b>${cardName(wc)}</b> in one trick! With 2 decks, the one played <b>last</b> wins, so ${esc(nm(f.showSeat))} ${f.showSeat === 0 ? 'take' : 'takes'} it.`);
        if (!f.flipped) say('trick', `${f.team === 0 ? '<b>Your team won the trick!</b>' : 'The opponents won that trick.'} The highest card of the suit led wins, unless someone plays a trump. Whoever wins leads the next trick.`);
        break;
      }
      case 'joker':
        if (f.second) say('joker2', 'A second Joker! Two Jokers <b>cancel each other</b>, so the highest card takes the trick. The second Joker player leads next.');
        else if (f.seat !== 0) say('joker1', `${esc(nm(f.seat))} played the <b>Joker</b>! It flips the trick: the team that was losing now takes it, and ${esc(nm(f.seat))} leads next.`);
        break;
      case 'stuck':
        say('stuck', `${esc(nm(f.seat))} had to lead with only a Joker left, so the other team takes that trick. That's why you shouldn't save a Joker till the end.`);
        break;
      case 'handEnd': {
        const R = S.result; if (!R) break;
        const bt = R.winner, kind = R.kind;
        const to = `<b>${R.pts} points</b> go to ${bt === 0 ? 'your team' : 'the opponents'}`;
        const res = kind === 'made' ? `The bidding team won enough tricks, so ${to}.`
          : kind === 'sweep' ? `The bidding team won every single trick, so they score double: ${to}.`
          : kind === 'broken' ? `The bid was broken, so the defending team scores double: ${to}.`
          : `The bidding team didn't win a single trick, so the defenders score 4×: ${to}.`;
        say('end', `${res} The score bar at the top is a tug of war: the first team to lead by <b>52</b> wins the game.<br><br><b>You're ready!</b> Tips are off from here. Finish this game, or go home and play online with friends.`, { pos: 'low', end: true });
        break;
      }
    }
  }
  sock.on('state', () => setTimeout(onState, 0));
  sock.on('fx', f => setTimeout(() => onFxCoach(f), 0));
})();
