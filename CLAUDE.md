# Patta Party: handover notes for Claude

Online team bidding card game (Rung style) for 4, 6 or 8 players. Owner: Ansa (non-developer, works mostly on mobile).
Live on Render (auto-deploys every push to `main`), accounts in Supabase, code on GitHub `dhedhi-tech/rung-bid`.

## Working rules (important)
- **Never push to `main` unless Ansa says "deploy".** A push to main restarts the live server and ends every game in progress.
- Do work on the branch `pending-updates` (create it from main), push that branch, and tell Ansa what is waiting.
- To deploy: `git checkout main && git merge --ff-only pending-updates && git push origin main`.
- A commit message containing `[skip render]` pushes to main without deploying (use only for notes like this file).
- Talk to Ansa in simple English (or Roman Urdu), one task at a time, short. Never Devanagari.
- Show design changes as screenshots (Playwright, Chromium at /opt/pw-browsers or the headless_shell binary). She cannot open downloaded files easily.
- Minimal, targeted changes. Do not add copy or features she did not ask for. Ask only after a full rejection.
- Test before saying done: bot simulations (`RB_SPEED=0.00001`, `t.hasSeatedHuman = () => true`, `t.newGame()`), and Playwright for screens. Kill test servers with `pkill -x node` (not `pkill -f`).

## Files
- `game.js` Table class: deck, rules, bidding, trump, tricks, scoring, bots (botBid, botTrump, botPlay, botLead, isBoss), per-viewer state (`viewFor`, seats rotated so the viewer is seat 0), effects (`fx`), text tokens like `{n3}`, `{v3:bid:bids}`, `{t1}`, `{tl1}`.
- `server.js` Express + Socket.IO: tables, join/leave, chat, voice signalling, accounts, friends, stickers, rooms list, admin routes, stats hooks.
- `accounts.js` Supabase sign-in check, profiles, XP/levels/coins, store, pictures, leaderboard.
- `friends.js` friend requests/list. `stats.js` daily stats + game log. `sticker-store.js` built-in + uploaded stickers.
- `public/index.html` (markup + CSS), `public/app.js` (client), `public/tutorial.js`, `public/stickers/` (12 SVG stickers + stickers.json).
- `admin/admin.html` private page at /admin (ADMIN_PASS): stats, live tables, sticker upload.
- `legal/` privacy and terms pages. `supabase*.sql` table setup (Ansa runs these in the Supabase SQL editor).

## Game rules
- 4 players: 1 deck. 6 players: 2 decks without 2s, 3s, 4s and both 5♦ (78 cards). 8 players: 2 decks. Teams sit alternately.
- Deal 5, then 4, then 4. A bidding round after each deal. Bids 6 to 13; round 1 max 7. Bid 6 needs 7 tricks but scores 6.
- In a round: if you bid and someone (opponent or partner) raises over you, you get another turn. A player who passed is out for that round. Bots never re-raise over their own partner.
- All pass in round 1: first player is forced to bid 6. Trump is called after round 1 and re-called only when the bid is raised.
- Follow suit; if void play anything. With 2 decks, identical cards: the one played last wins.
- Scoring (tug of war, one score): made = bid; made without losing a trick = 2x; failed = 2x to opponents; failed without winning a trick = 4x to opponents. Lead of 52 wins. Hand limit: Quick 6, Normal 10, Full none; a level score at the limit plays a decider hand.
- Dealer rule: if the last bidder was on the losing team they deal; if on the winning team they bid first.
- Joker mode: 1 joker per deck (4p and 8p drop the 2♣ per deck; 6p drops one 5 of each suit). Only playable when void, never led. One joker flips the trick to the other team; the joker player gets the trick credit and leads next. Two jokers cancel: the highest card takes the trick, the second joker player leads next. Stuck holding only jokers on lead: the other team gets 1 trick per joker.

## Bots
- Bidding: hand power vs calibrated average; careful when opponents hold the bid with a trump they have shown (pass and defend if strong in that suit; extra strength needed over 8+). Ansa is happy with the current bidding; an alternative "less shy" version was tested and declined.
- Play: partner win and return, void tracking, `isBoss` (no unseen card can beat it), go for the trick once the partner has played.

## Features (live)
Welcome screen, tutorial, practice with bots, table links (WhatsApp), Open tables list (public tables, join as audience), "Your game" resume, same-person-on-two-apps seat take-over, Google sign-in (Supabase), levels/coins/badges/felt store, profile pictures (Google, 16 emoji avatars, upload), leaderboard, friends + invites + request badge, chat + speech typing, voice chat (WebRTC mesh; TURN via ExpressTURN env vars TURN_URL/TURN_USER/TURN_PASS), emoji reactions, stickers (tray + popups; Ansa uploads more on /admin), round seats on the table edge, bid leader spotlight, active bidder enlarged, joker missile sound, admin stats page.

## Render environment (names only)
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, ADMIN_PASS, TURN_URL, TURN_USER, TURN_PASS, optional CONTACT_EMAIL. Never print or store their values.

## Next steps (launch plan)
1. Ansa: Google Play developer account (personal, $25, ID check) and buy pattaparty.com (Namecheap).
2. Connect pattaparty.com to Render; update Supabase URL settings and Google OAuth origins.
3. Build the Android app (Capacitor wrapper around the site, portrait only), icon, splash, AdMob rewarded/interstitial ads; Ansa creates an AdMob account.
4. Closed test: 12+ testers for 14 days (Google rule), then production review. Upgrade Render to the $7 plan before launch.
5. Later: real push notifications (friends, invites), sticker packs for coins, landscape/tablet layout.
