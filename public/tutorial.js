/* Patta Party tutorial: a short hands-on walkthrough for new players. Runs fully on the phone, no server needed. */
(function () {
  const C = (r, s) => ({ id: 'x' + r + s + Math.random(), r, s });
  const card = (c, extra = '') => (c.s === 'J'
    ? `<div class="card joker ${extra}">${jokerArt()}</div>`
    : `<div class="card ${RED(c.s) ? 'red' : ''} ${extra}" data-k="${c.r}${c.s}"><span class="c-idx">${RL(c.r)}<small>${SYM[c.s]}</small></span><span class="c-pip">${SYM[c.s]}</span></div>`);
  const row = (cards, cls = '') => `<div class="tut-cards ${cls}">${cards.map(c => card(c)).join('')}</div>`;

  function miniTable(labels) {
    // 4 seats round a small table, teams alternate
    const pos = [[50, 88], [8, 50], [50, 12], [92, 50]];
    return `<div class="tut-table"><div class="tut-felt"></div>${labels.map((l, i) => `<div class="tut-seat ${i % 2 ? 'tb' : 'ta'}" style="left:${pos[i][0]}%;top:${pos[i][1]}%">${l}</div>`).join('')}</div>`;
  }

  const steps = [
    {
      title: 'Two teams, alternate seats',
      body: `${miniTable(['You', 'Opponent', 'Partner', 'Opponent'])}
        <p>Every second seat is your partner. <b class="pn ta">Orange</b> is always your team and <b class="pn tb">blue</b> is the other team.</p>
        <p class="hint">With 6 or 8 players it works the same way: 3 or 4 players per team, sitting alternately.</p>`,
    },
    {
      title: 'Cards come in three deals',
      body: `<div class="tut-deals"><div><b>5</b><span>cards</span></div><i>→</i><div><b>4</b><span>more</span></div><i>→</i><div><b>4</b><span>more</span></div><i>=</i><div class="tot"><b>13</b><span>cards</span></div></div>
        <p>After each deal there is a round of bidding. So you bid three times, and you see more of your hand each time.</p>
        <p class="hint">Everyone gets 13 cards, so every hand has 13 tricks.</p>`,
    },
    {
      title: 'Bidding: how many tricks can your team win?',
      body: `<p>You hold these 5 cards. The highest bid so far is <b>6</b>.</p>${row([C(14, 'S'), C(13, 'S'), C(10, 'S'), C(14, 'H'), C(4, 'C')])}
        <p><b>Try it:</b> would you raise or pass?</p>
        <div class="tut-choices"><button data-a="raise">Raise to 7</button><button data-a="pass">Pass</button></div>
        <div class="tut-fb" id="tutFb"></div>`,
      wire(root, done) {
        root.querySelector('.tut-choices').onclick = e => {
          const b = e.target.closest('button'); if (!b) return;
          const fb = root.querySelector('#tutFb');
          fb.className = 'tut-fb good';
          fb.innerHTML = b.dataset.a === 'raise'
            ? 'Good call. Three strong spades and an ace is a strong start. Your partners help too, so 7 is a fair bid.'
            : 'That works too. Passing is safe, and you can still bid in rounds 2 and 3 once you see more cards.';
          done();
        };
      },
      after: `<p class="hint">Bids go from 6 to 13. In round 1 the most you can bid is 7. A bid of 6 still needs <b>7 tricks</b> to win, but scores 6 points. If you hold the highest bid, you can raise your own bid in rounds 2 and 3.</p>`,
    },
    {
      title: 'The highest bidder calls trump',
      body: `<p>You won the bid. Trump is the strongest suit for this hand. Pick the suit you hold the most strong cards in.</p>${row([C(14, 'S'), C(13, 'S'), C(10, 'S'), C(14, 'H'), C(4, 'C')])}
        <p><b>Try it:</b> call trump.</p>
        <div class="suit-grid tut-suits">${SUITS.map(s => `<button class="suit-btn ${RED(s) ? 'red' : ''}" data-s="${s}"><span class="big">${SYM[s]}</span><span>${SNAME[s]}</span></button>`).join('')}</div>
        <div class="tut-fb" id="tutFb"></div>`,
      wire(root, done) {
        root.querySelector('.tut-suits').onclick = e => {
          const b = e.target.closest('button'); if (!b) return;
          const fb = root.querySelector('#tutFb');
          if (b.dataset.s === 'S') { fb.className = 'tut-fb good'; fb.innerHTML = 'Spades it is. You hold A, K and 10 of spades, so they will win tricks for you.'; done(); }
          else { fb.className = 'tut-fb bad'; fb.innerHTML = `You only have ${b.dataset.s === 'H' ? 'one heart' : b.dataset.s === 'C' ? 'one small club' : 'no diamonds'}. Try the suit you hold the most of.`; }
        };
      },
      after: `<p class="hint">Trump can change: after rounds 2 and 3, whoever raised the bid calls trump again. If nobody raised, trump stays.</p>`,
    },
    {
      title: 'Follow the suit that was led',
      body: `<p>Your opponent leads the <b>King of Hearts</b>.</p>${row([C(13, 'H')], 'led')}
        <p><b>Try it:</b> play a card from your hand.</p>${row([C(14, 'S'), C(9, 'H'), C(2, 'H'), C(12, 'C'), C(7, 'D')], 'pick')}
        <div class="tut-fb" id="tutFb"></div>`,
      wire(root, done) {
        root.querySelector('.pick').onclick = e => {
          const el = e.target.closest('.card'); if (!el) return;
          const fb = root.querySelector('#tutFb');
          if (el.dataset.k.endsWith('H')) { el.classList.add('chosen'); fb.className = 'tut-fb good'; fb.innerHTML = 'Right. You have hearts, so you must play a heart. In the game, cards you cannot play are dimmed.'; done(); }
          else { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); fb.className = 'tut-fb bad'; fb.innerHTML = 'You still have hearts, so you must follow with a heart.'; }
        };
      },
    },
    {
      title: 'No cards of that suit? Cut with trump',
      body: `<p>Trump is <b>♠ Spades</b>. Your opponent leads the <b>Ace of Clubs</b>, and you have no clubs.</p>${row([C(14, 'C')], 'led')}
        <p><b>Try it:</b> win this trick.</p>${row([C(3, 'S'), C(13, 'H'), C(12, 'D'), C(9, 'H')], 'pick')}
        <div class="tut-fb" id="tutFb"></div>`,
      wire(root, done) {
        root.querySelector('.pick').onclick = e => {
          const el = e.target.closest('.card'); if (!el) return;
          const fb = root.querySelector('#tutFb');
          if (el.dataset.k === '3S') { el.classList.add('chosen'); fb.className = 'tut-fb good'; fb.innerHTML = '<b>CUT!</b> Even a small trump beats the Ace of Clubs. When you have none of the led suit, you can play any card: trump to win, or something else to save your trumps.'; done(); sfx('cut'); }
          else { fb.className = 'tut-fb bad'; fb.innerHTML = 'That card cannot beat the Ace of Clubs. Only a trump can win here.'; }
        };
      },
    },
    {
      title: 'Who wins the trick?',
      body: `<p>Trump is <b>♠ Spades</b>. Hearts were led. These four cards were played:</p>
        ${row([C(14, 'H'), C(4, 'S'), C(13, 'H'), C(9, 'S')], 'four')}
        <p><b>Try it:</b> tap the winning card.</p><div class="tut-fb" id="tutFb"></div>`,
      wire(root, done) {
        root.querySelector('.four').onclick = e => {
          const el = e.target.closest('.card'); if (!el) return;
          const fb = root.querySelector('#tutFb');
          if (el.dataset.k === '9S') { el.classList.add('chosen'); fb.className = 'tut-fb good'; fb.innerHTML = 'Yes. The highest trump wins. If nobody plays trump, the highest card of the led suit wins.'; done(); }
          else { fb.className = 'tut-fb bad'; fb.innerHTML = 'Not quite. Two players cut with spades (trump). The highest trump wins the trick.'; }
        };
      },
      after: `<p class="hint">With two decks (6 and 8 players), if two identical cards fall in one trick, the one played last wins.</p>`,
    },
    {
      title: 'Scoring',
      body: `<table class="score-table">
          <tr><td>Your team makes the bid</td><td>+ bid</td></tr>
          <tr><td>Make it before the other team wins a single trick</td><td>2× bid</td></tr>
          <tr><td>Your team fails the bid</td><td>2× to them</td></tr>
          <tr><td>They break it before you win a single trick</td><td>4× to them</td></tr>
        </table>
        <p>There is one running score, like a tug of war. Points you win cancel the other team's lead. <b>Lead by 52 to win straight away.</b> Otherwise, the team ahead when the hand limit runs out wins (6 hands for Quick, 10 for Normal).</p>
        <p class="hint">The hand stops as soon as the result is decided, so games move fast.</p>`,
    },
    {
      title: 'Joker mode (optional)',
      body: `${row([{ s: 'J', r: 0 }])}
        <p>In Joker mode each deck has a joker. You can only play it when you have none of the led suit, and you can never lead with it.</p>
        <p>A joker <b>reverses the trick</b>: it goes to the team that would have lost. The joker player leads next. Two jokers cancel out: the highest card takes the trick, and the second joker player leads next.</p>
        <p class="hint">Careful: if you must lead and hold only jokers, you are stuck and the other team takes those tricks.</p>`,
    },
    {
      title: 'You are ready',
      body: `<p>That's everything. The best way to learn is a practice game against bots, then invite your friends.</p>
        <p class="hint">Voice chat, emoji reactions and the full rules are always one tap away during the game.</p>`,
      final: true,
    },
  ];

  let i = 0, ctx = 'home';
  function open(from) {
    ctx = from || 'home'; i = 0;
    if (!document.getElementById('tut')) {
      const d = document.createElement('div'); d.className = 'modal tut-modal'; d.id = 'tut'; d.hidden = true;
      d.innerHTML = '<div class="sheet tut"><div class="tut-top"><span class="eyebrow" id="tutStep"></span><button class="tut-x" id="tutClose" aria-label="Close tutorial">✕</button></div><h2 id="tutTitle"></h2><div id="tutBody"></div><div class="tut-nav"><button class="secondary" id="tutBack">Back</button><button class="primary" id="tutNext">Next</button></div><div class="tut-dots" id="tutDots"></div></div>';
      document.body.appendChild(d);
      document.getElementById('tutClose').onclick = close;
      document.getElementById('tutBack').onclick = () => { if (i > 0) { i--; show(); } };
      document.getElementById('tutNext').onclick = () => {
        const st = steps[i];
        if (st.final) { finish(); return; }
        if (i < steps.length - 1) { i++; show(); }
      };
    }
    document.getElementById('tut').hidden = false;
    show();
  }
  function show() {
    const st = steps[i];
    document.getElementById('tutStep').textContent = `Tutorial · ${i + 1} of ${steps.length}`;
    document.getElementById('tutTitle').textContent = st.title;
    const body = document.getElementById('tutBody');
    body.innerHTML = st.body + `<div id="tutAfter"></div>`;
    const next = document.getElementById('tutNext');
    next.textContent = st.final ? (ctx === 'game' ? 'Back to the game' : 'Practice with bots') : 'Next';
    next.disabled = !!st.wire;
    document.getElementById('tutBack').style.visibility = i === 0 ? 'hidden' : 'visible';
    document.getElementById('tutDots').innerHTML = steps.map((_, k) => `<span class="${k === i ? 'on' : k < i ? 'done' : ''}"></span>`).join('');
    if (st.wire) st.wire(body, () => {
      next.disabled = false;
      if (st.after) document.getElementById('tutAfter').innerHTML = st.after;
    });
    body.scrollTop = 0; document.querySelector('.sheet.tut').scrollTop = 0;
  }
  function close() { document.getElementById('tut').hidden = true; store.set('rb-tut-seen', '1'); }
  function finish() {
    close();
    if (ctx === 'home' && typeof window.tutorialPractice === 'function') window.tutorialPractice();
  }
  window.openTutorial = open;
})();
