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
Welcome screen, tutorial, practice with bots, table links (WhatsApp), Open tables list (public tables, join as audience), "Your game" resume, same-person-on-two-apps seat take-over, Google sign-in (Supabase), levels/coins/badges/felt store, profile pictures (Google, 16 emoji avatars, upload), leaderboard, friends + invites + request badge, chat + speech typing, voice chat (WebRTC mesh; TURN via ExpressTURN env vars TURN_URL/TURN_USER/TURN_PASS), emoji reactions, stickers (tray + popups; Ansa uploads more on /admin), round seats on the table edge, bid leader spotlight, active bidder enlarged, joker missile sound, admin stats page, guided practice coach, mute + report players.

## Mute and report
- Player card (tap a seat) shows 🔇 Mute and 🚩 Report for other real players. Seats and chat entries carry `mid` (hash of account id, else player id; `midOf` in game.js, `t.idOf` set in server.js).
- Mute is per phone (localStorage `rb-mutes`): hides their chat, chat bubbles, stickers, reactions and silences their voice (`applyVoiceMutes`).
- Report: reasons list, server `report` event saves reason, both names/pids/account ids and the reported player's last 20 chat lines at that table (`reports.js`, Supabase table from `supabase-reports.sql`), one report per player per table, max 10 per connection. Reporting also mutes. Admin page shows Player reports.

## Guided practice (coach)
- Practice sheet has "Coach tips" On/Off (on until `rb-coached` is set; the tutorial's last button always turns it on). Create sends `guided: true`; server sets `table.guided` (forces private).
- Server (game.js): `guidedOn()` = guided + hand 1 + exactly one seated human. Then no turn timer, `ask.hint` from the bots' own logic (`coachHint`: bid value/suit, trump, card id + reason code), and `coach` socket event: `{hold}` pauses the game at the next sleep while a tip is open (auto-release 120s), `{off}` = Skip tips. Hand 1 is rigged (`rigDeck`, `G.rigged`): the player gets top trump-suit cards + aces (+ a joker in the first 5 cards in Joker mode), teammates get ~3 of 4 good cards, and the coach bids safely (never over a teammate, max 8). Player's team wins ~98% when following the coach (4/6/8p tested). 6/8p: tips about 2 decks and identical cards (last played wins).
- Client `public/coach.js`: tip bubble (positions: top for bid/trump/joker-in-hand, above the hand otherwise, bottom for the hand-end tip), gold glow on the coach pick, tips for deals, rounds, trump, first tricks, joker played/cancel/stuck, and the score at hand end.

## Android app (android-app/)
- Capacitor 8 wrapper that loads https://pattaparty.com (server.url), app id `com.dhedhitech.pattaparty`, portrait only, targetSdk 36. Play developer name: Dhedhi Tech (console Gmail tech.dhedhi@gmail.com).
- The app adds `PattaPartyApp` to the user agent; `NATIVE_APP` in app.js. In the app, Google sign-in opens the phone browser (Capacitor Browser) and returns via `com.dhedhitech.pattaparty://auth?code=...` (App plugin `appUrlOpen` then `exchangeCodeForSession`). That URL must be in Supabase Auth > URL Configuration > Redirect URLs. Voice chat is allowed in the app (RECORD_AUDIO permission).
- Icons/splash: put new art in `android-app/assets/` (icon-only.png, icon-foreground.png, icon-background.png 1024px; splash.png 2732px) then `npx @capacitor/assets generate --android`. Current icon is temporary.
- Build: `.github/workflows/android.yml` runs on any push touching android-app/ (any branch) or by hand; it publishes a signed .aab to GitHub Releases. versionCode = workflow run number.
- Upload key: `android-app/upload-key.jks.enc` (AES-256, openssl pbkdf2 200000), alias `upload`. Password is the GitHub secret UPLOAD_KEY_PASSWORD (Ansa keeps a copy). Never print it. No secret = unsigned test build.
- This session's proxy blocks the GitHub Actions API; check results via the Releases API.

## Render environment (names only)
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, ADMIN_PASS, TURN_URL, TURN_USER, TURN_PASS, optional CONTACT_EMAIL. Never print or store their values.

## Next steps (launch plan)
1. Play developer account applied Oct 25 2026 (personal, developer name Dhedhi Tech), ID check pending. pattaparty.com bought.
2. DONE (Oct 2026): pattaparty.com live on Render. Code has no hardcoded old URLs.
3. IN PROGRESS: Android app built (see Android app section). Still to do: real logo, AdMob rewarded/interstitial ads (Ansa creates an AdMob account), Play store listing.
4. Closed test PUBLISHED Oct 28 2026 (track "Closed testing - Alpha", version 5 / 1.0.5, Pakistan only, 16 testers, WhatsApp testers group). Needs 12+ opted in for 14 days, then Apply for production. Upgrade Render to the $7 plan before launch.
   - Waiting on Ansa: run supabase-reports.sql, add CONTACT_EMAIL on Render, say "deploy" for mute/report.
   - Before production (Ansa said wait): Delete my account button (Google requires). Back button and vibration only if testers ask. Real logo, AdMob (then Ads + Advertising ID answers change to Yes), Play Store video (YouTube link).
   - Play Console answers given: app access No restriction, ads No, target audience 18+, content rating interactions Yes, data safety (name, email, user IDs, photos, voice + chat ephemeral, app interactions, device IDs), advertising ID No.
5. Later: real push notifications (friends, invites), sticker packs for coins, landscape/tablet layout.
