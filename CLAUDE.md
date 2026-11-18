# Patta Party: handover notes for Claude

Online team bidding card game (Rung style) for 4, 6 or 8 players. Created by Ansa (non-developer, works mostly on mobile).

## Handover (Nov 2026)
- Ansa's brother now manages the project from his own Claude account. Wherever these notes say "Ansa", read "the person managing the project" (her brother), unless he says otherwise.
- His preferences (asked Nov 10 2026): simple English, short summary first with details only when he asks, screenshots in chat for design changes, never deploy until he says "deploy" (same rules as Ansa below).
- Accounts: GitHub collaborator on dhedhi-tech/rung-bid; Render, Supabase, Play Console (tech.dhedhi@gmail.com), Namecheap (pattaparty.com), ExpressTURN, Google Cloud (OAuth) are shared with him by Ansa. Never ask for or store passwords in chat or in this repo.
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
- In a round: if you bid and someone (opponent or partner) raises over you, you get another turn. A player who passed is out for that round. Bots never raise over their own partner's bid in the same round it was made (a later round is fine).
- All pass in round 1: first player is forced to bid 6. Trump is called after round 1 and re-called only when the bid is raised.
- Follow suit; if void play anything. With 2 decks, identical cards: the one played last wins.
- Scoring (tug of war, one score): made = bid; made without losing a trick = 2x; failed = 2x to opponents; failed without winning a trick = 4x to opponents. Lead of 52 wins. Hand limit: Quick 6, Normal 10, Full none; a level score at the limit plays a decider hand.
- Dealer rule: if the last bidder was on the losing team they deal; if on the winning team they bid first.
- Joker mode: 1 joker per deck (4p and 8p drop the 2♣ per deck; 6p drops one 5 of each suit). Only playable when void, never led. One joker flips the trick to the other team; the joker player gets the trick credit and leads next. Two jokers cancel: the highest card takes the trick, the second joker player leads next. Stuck holding only jokers on lead: the other team gets 1 trick per joker.

## Bots
- Bidding: hand power vs calibrated average; careful when opponents hold the bid with a trump they have shown (pass and defend if strong in that suit; extra strength needed over 8+). Ansa is happy with the current bidding; an alternative "less shy" version was tested and declined.
- Play: partner win and return, void tracking, `isBoss` (no unseen card can beat it), go for the trick once the partner has played.
- End of game (`behind`, `desperate`, `endBid`; Nov 2026): team far behind in the last 3 hands of a 6/10-hand game makes no small bids that can't change the result; last hand: bid what closes the gap or a bid whose sweep would, else pass and try to break.
- Sweep / whitewash (`allOut`): while opponents have no trick, play to win every trick (take over partner's beatable card with a sure winner, cut instead of ducking, bidding team leads top trump). On from the start if my sure winners cover the tricks still needed, after 4+ tricks with strong cards, or from trick 1 when only a sweep/whitewash can win the game. 8 players: all-bot teams only the last case (tested worse); with a real player on the team, all cases (`teamHasHuman`).

## Features (live)
Welcome screen, tutorial, practice with bots, table links (WhatsApp), Open tables list (public tables, join as audience), "Your game" resume, same-person-on-two-apps seat take-over, Google sign-in (Supabase), levels/coins/badges/felt store, profile pictures (Google, 16 emoji avatars, upload), leaderboard, friends + invites + request badge, chat + speech typing, voice chat (WebRTC mesh; TURN via ExpressTURN env vars TURN_URL/TURN_USER/TURN_PASS), emoji reactions, stickers (tray + popups; Ansa uploads more on /admin), round seats on the table edge, bid leader spotlight, active bidder enlarged, joker missile sound, admin stats page, guided practice coach, mute + report players.

## Mute and report
- Player card (tap a seat) shows 🔇 Mute and 🚩 Report for other real players. Seats and chat entries carry `mid` (hash of account id, else player id; `midOf` in game.js, `t.idOf` set in server.js).
- Mute is per phone (localStorage `rb-mutes`): hides their chat, chat bubbles, stickers, reactions and silences their voice (`applyVoiceMutes`).
- Report: reasons list, server `report` event saves reason, both names/pids/account ids and the reported player's last 20 chat lines at that table (`reports.js`, Supabase table from `supabase-reports.sql`), one report per player per table, max 10 per connection. Reporting also mutes. Admin page shows Player reports.

## Watchers, waiting list, swap (deployed Nov 1)
- Tap the 👀 count in the header to see watcher names (and waiting #).
- Open tables list now shows full public tables too ("Full", "Watch").
- Waiting list: `table.waitList` (pids). Watchers tap "Sit on first available seat" (no bot seat free) to join the line; no one is added without tapping. When a player leaves mid-game (`stand`), the first connected person in line takes the seat (`fillFromWait`).
- Swap option (`table.swap`, create sheet "If the bidder fails", link-only tables, not practice): after a failed bid, a human bidder goes to the end of the line and the first in line takes the seat before the next hand (`swapFailedBidder`).
- Card play timer 8s (bid/trump 20s). Delete my account (profile sheet, `A.deleteAccount`). Vibration on your turn (needs app 1.0.10, VIBRATE permission).

## Away (deployed Nov 5)
- Header 💤 button (`awayBtn`; "Away" text on wide screens) -> `away` event -> `table.setAway(pid, on, why)`. Away bar above the hand with "I'm back". `isHuman` is false for away players, so bots play their turns instantly and the game pauses (`untilHumans`) when no seated human is active (solo: pauses at once).
- Auto away: app hidden 10s (`hidden` event, `appHidden`, server timer; back automatically on return or reconnect), or 2 timed-out turns in a row (`p.missed`; must tap I'm back).
- Swap rule on + someone waiting: only between hands (never mid hand), a player away 3+ min gives the seat to the first in line and becomes a watcher (`checkAwaySwap` before each next hand and in `newGame`; `RB_AWAY_SWAP_MS` for tests).

## Guided practice (coach)
- Practice sheet has "Coach tips" On/Off (on until `rb-coached` is set; the tutorial's last button always turns it on). Create sends `guided: true`; server sets `table.guided` (forces private).
- Server (game.js): `guidedOn()` = guided + hand 1 + exactly one seated human. Then no turn timer, `ask.hint` from the bots' own logic (`coachHint`: bid value/suit, trump, card id + reason code), and `coach` socket event: `{hold}` pauses the game at the next sleep while a tip is open (auto-release 120s), `{off}` = Skip tips. Hand 1 is rigged (`rigDeck`, `G.rigged`): the player gets top trump-suit cards + aces (+ a joker in the first 5 cards in Joker mode), teammates get ~3 of 4 good cards, and the coach bids safely (never over a teammate, max 8). Player's team wins ~98% when following the coach (4/6/8p tested). 6/8p: tips about 2 decks and identical cards (last played wins).
- Nov 18 2026 (manager): coach is on for the WHOLE first game, a tip on every turn (only hand 1 of the first game is rigged, `coachGames`). After the first game it is off unless turned on: Tutorial switch (`coachBtn`, shown when `S.coachable` = private table with one real player) calls `coachToggle` -> `coach {on}` / `{off}`; choice saved in `rb-coach`, also the "🎓 Coach tips" field on the practice sheet (shown outside More options for beginners). `coachPref()` = rb-coach, else on until rb-coached. app.js calls `coachTick()` after every state it shows (held trick states used to skip the coach, so tips after the first trick never appeared).
- First open: `rb-first` = started (tapped Start) / done (first game over or "I have played before"); the Start screen keeps showing until the first game is finished.
- Client `public/coach.js`: tip bubble (positions: top for bid/trump/joker-in-hand, above the hand otherwise, bottom for the hand-end tip), gold glow on the coach pick, tips for deals, rounds, trump, first tricks, joker played/cancel/stuck, and the score at hand end.

## Android app (android-app/)
- Capacitor 8 wrapper that loads https://www.pattaparty.com (server.url; the apex redirects to www on Render, and a redirect to another host makes Capacitor open Chrome, fixed in version 6), app id `com.dhedhitech.pattaparty`, portrait only, targetSdk 36. Play developer name: Dhedhi Tech (console Gmail tech.dhedhi@gmail.com).
- The app adds `PattaPartyApp` to the user agent; `NATIVE_APP` in app.js. In the app, Google sign-in opens the phone browser (Capacitor Browser) and returns via `com.dhedhitech.pattaparty://auth?code=...` (App plugin `appUrlOpen` then `exchangeCodeForSession`). That URL must be in Supabase Auth > URL Configuration > Redirect URLs. Voice chat is allowed in the app (RECORD_AUDIO permission).
- Icons/splash: put new art in `android-app/assets/` (icon-only.png, icon-foreground.png, icon-background.png 1024px; splash.png 2732px) then `npx @capacitor/assets generate --android`. Current icon is temporary.
- Build: `.github/workflows/android.yml` runs on any push touching android-app/ (any branch) or by hand; it publishes a signed .aab to GitHub Releases. versionCode = workflow run number.
- Upload key: `android-app/upload-key.jks.enc` (AES-256, openssl pbkdf2 200000), alias `upload`. Password is the GitHub secret UPLOAD_KEY_PASSWORD (Ansa keeps a copy). Never print it. No secret = unsigned test build.
- This session's proxy blocks the GitHub Actions API; check results via the Releases API.
- App usage tracking: client sends `auth.app` = NATIVE_APP; server `socket.data.app` -> `S.appSeen(pid, uid)` into Supabase `app_days` (from `supabase-app.sql`). Admin shows "using the app now", "played in the app" today, an App column per day, and an App tag on Recent sign-ups for accounts that signed in inside the app.
- App Links (invites open the app): manifest intent-filter autoVerify for https://www.pattaparty.com only (apex redirects, so it can't verify); server serves /.well-known/assetlinks.json with the Play app signing key (2F:FE:EE:...) and upload key SHA-256 hardcoded (+ optional `APP_SHA256` env). In the app, `appGameLink` loads the opened link inside the webview.
- Android back button (`appBack` at the end of app.js, App plugin `backButton`): closes sticker tray / help / tutorial / rules / chat / closable sheets; otherwise press twice: leave the table, or exit the app on the home screen. Added Oct 28 after tester feedback.

## Admin stats: people
- `player_days` has `name` (typed name) and `uid`. A person = typed name, else account, else player id (views `admin_daily`, `admin_people`, `admin_retention` in supabase-stats.sql; Ansa re-runs that file after changes). Same name = same person (accepted trade-off while small).
- Nov 18 2026: `admin_daily` has `real_players`/`real_new` (typed a name or signed in) and `visitors` (opened the site, no name: often link checkers/crawlers). admin.html uses them for players/new and shows "opened the site only" when the columns exist (needs supabase-stats.sql re-run).
- Admin page: Return rate (came back another day, last 30 days; still playing a week later) and Players list (named or signed-in, last 30 days, longest absent first, orange 3+ days, red 7+ days, App tag).

## Marketing (Nov 2026)
- Strategy: build the "line" before launch. Audience: desi friends/families who love Rung (PK, IN, BD, overseas). Pain: can't play together when apart; rival apps full of ads, fake/bot "online" players, no private tables, wrong house rules.
- Plan: daily short videos (Urdu/English) from rival-review complaints, WhatsApp Channel as own list, Play Store pre-registration + Founder badge/coins, launch-day reviews, then Google Ads ($400 credit) in Pakistan at $5-10/day.
- Ads rule: no ads during a game; rewarded ads only (+ maybe one between full games). Ads are the #1 complaint about rivals.
- Rival: rung.gg (4 players, invite links, bots, voice, Google sign-in, WhatsApp). Our edge: 6 and 8 players, bidding Rung, Joker mode, guided first game.
- Logo: in progress. Ansa wants bold modern flat, adult (not childish): grinning joker (original, not DC), friends, cards, PATTA PARTY wordmark. Latest drafts: teal+gold (A) or crimson+gold (B); then a simple icon version and a WhatsApp link preview image (og:image).
- Play App Access: Google asked for login credentials; Ansa to add a review test Gmail (no 2FA) under App access.

## Characters and bot names (deployed Nov 11 2026)
- 12 character avatars in `public/avatars/0-11.svg` (Ali, Bilal, Sana, Hira, Usman, Zara, Hamza, Maham, Ayesha, Omar, Kaka, Khala). Same cast as the Play Store video. Profile pic value `a:<n>` (accounts.js `CHARS`); index order is stored in profiles, so only add new ones at the end.
- Table seats: character pictures get the team colour as background (server route `/avatars/<n>-a.svg` orange, `-b.svg` blue; `avatarHTML(p, cls, team)`); letter pictures are filled with the team colour too. Deployed Nov 11 2026.
- Bots show a character picture (`botAv`). Bot names follow the table creator's phone time zone (`myRegion` in app.js -> `region` on create): India and Bangladesh get local names, everyone else Pakistani names (`BOT_SETS` in game.js).

## Table look (deployed Nov 13 2026)
- Default green felt brighter (#1f7a4d) + faint chatai pattern on every felt (`.felt::before`). Played cards bigger: `sizeCards` sets `--tw` (base x 1.15 for 4p, 1.05 for 6p, 0.95 for 8p); the CSS `--tw` is only a fallback.
- Status line under the table (`.status`: main text, log, team tricks strip) is hidden. A turn bubble sits above the active seat (`.turn-bub`: "Your turn" orange, "Playing…"/"Bidding…" white).
- Trick score in the middle of the table (`#tscore`, in `renderTricks`): our team big in orange as won/needed, opponents small in blue. Header line 2 shows only "<team> need N". Manager tried "US/THEM" labels and declined them.

## Small notes (Nov 2026)
- Keep-awake: while a table is open the client fetches /health every 4 min (Render free plan sleeps after 15 min without normal HTTP requests; socket traffic does not count). With nobody playing, an external cron-job.org job (manager's account, set up Nov 18 2026) visits https://www.pattaparty.com/health every 5 min; turn it off after moving to the paid plan. The old GitHub Actions pinger (keep-awake.yml) was removed Nov 18: GitHub ran it only every 40 min to 9 hours, so the server kept sleeping. Real fix: Render $7 plan.
- Admin "What people play": table size x Joker table (each column adds up to 100%) and "Game length chosen" table, both from `game_log` (last 30 days), computed in `stats.js` (`countModes`).
- Not built yet (idea only): tracking players joining/leaving mid-game for admin stats.

## Growth (Nov 17 2026, on pending-updates until deploy)
- Android phone browsers (not the app, `ANDROID_WEB`) see a "Get the Patta Party app" Play Store link on the home screen and on the game over sheet (`playUrl(from)`, utm referrer website/home or game_over).
- In the app: Google Play in-app review (`@capacitor-community/in-app-review`, plugin `InAppReview`, app 1.0.13+) via `maybeAskReview` on game over: a win once 2+ games are done, or the 3rd game; at most once per 30 days (`rb-games-done`, `rb-review-at`). Older app versions skip it.
- Share your win (game over sheet, winners only, `shareWin`/`winImage`): 1080px square picture (trophy, We won!, margin + hands, my team's avatars and names, table size/Joker, "Free on Google Play") + text with the Play Store link (referrer utm_source=share_win). App 1.0.14+: `@capacitor/filesystem` writes it to cache, `@capacitor/share` opens the share sheet; older apps share text via WhatsApp. Browser: Web Share with the file, else download + copy text. The team on the picture is captured once when the game ends (`overTeam()`, sessionStorage `rb-over-team`), so players leaving afterwards (seats turn into bots) don't change the names; highlights keep their own copy from that hand.
- Share a sweep / whitewash (Nov 18): when my team makes a clean sweep or a whitewash, the hand result sheet (and the game over sheet if it was the last hand) shows "🧹 Share your clean sweep" / "⚪ Share your whitewash" (`featShare(R)`, `bindShare`). Same picture as the win (`winImage` takes `title`, `sub`), own text and referrer (share_sweep / share_whitewash). Sharing takes the player out of the app; after 10s they are marked away until they return (bots play for them). The game over sheet also lists "Your highlights" (every sweep/whitewash of my team this game, each with Share), kept in `HL` (sessionStorage `rb-hl`, per table code, reset when a new game starts) by `noteHighlight(R)` at the start of `resultScreen`.
- `play-store/listing.md`: keyword title "Patta Party: Rung Court Piece" + Urdu, Hindi, Bengali listings.

## Guest sign-in nudge (Nov 18 2026, on pending-updates until deploy)
- Server keeps the XP/coins/stats a guest would have earned (`guestPending`, per pid, 3 hours) and sends `guestGain` after each hand; on sign-in (`signedIn` -> `takeGuestGain`) they are added to the profile and a `profile` event with `saved: true` shows "Saved to your profile".
- Client (`nudgeHTML`/`bindNudge`): blue banner on the hand result sheet after the guest's first hand of a game ("+N XP this hand", Sign in / Later), skipped in guided practice until hand 2; once more on the game over sheet ("You earned N XP and N coins"). At most 3 games per phone (`rb-nudge`). Tested: web sign-in redirect mid-game returns to the same seat; in the app the browser opens on top and the existing auto-away covers turns.

## Beginners (Nov 18 2026, on pending-updates until deploy)
- SKILL STAGES (Nov 19 2026, replaces the old "under 5 games" rule): 0 beginner, 1 Classic done, 2 Joker done. You move up only by WINNING a game with the tutorial off the whole game (`t.coachUsed`, set by newGame when guided and by `coach {on}`); server `levelUp` in onHandEnd emits `skill {skill, up}`. Classic win -> 1, Joker win -> 2. Signed in: `equipped.skill` (no new column; `A.skillOf`/`A.setSkill`; old accounts with 5+ games = 2). Guests: localStorage `rb-skill`, sent in socket auth and with `skill` event; guest progress merges into the account on sign-in. First run of this version: rb-skill = 2 if rb-games-done >= 5, 1 if they used the app before (old keys, no rb-first), else 0.
- isBeginner = skill 0. Beginner home (every time, not just first open): big Start playing (coached classic practice; tutorial on for the first game, then off unless turned on), note "Win one game with the tutorial off to unlock all games", 👥 Play with friends, "I have played before" (-> skill 1).
- Joker: skill 0 locked ("Win a game with the tutorial off"). Skill 1: choosing Joker turns the create button into "▶ Start Joker training" (4 players, private, with bots; tutorial on the first time `rb-jtrain`); server allows Joker for skill 1 only on private tables. Skill 2: normal. Game over sheet shows a gold level-up box (`levelUpHTML`).
- Tutorial switch `#coachBtn` ("🎓 Tutorial [switch] ON/OFF") under the Invite button on the table; coach arrow 👇 (`#coachArrow`) bounces above the coach's pick (card or bid/trump button); the play tip bubble sits 44px higher to make room.
- Create sheet for beginners: name + summary line + Create/Start, everything else under "More options"; Joker button locked (🔒, note "Sign in and play 5 games to unlock" / "N to go"); Quick (6 hands) default. Server also forces joker off for beginner hosts. Joining someone else's Joker table (invite/list) is allowed.
- Turn timer for beginners `BEGINNER_MS` (card 15s, bid/trump 30s) via `t.isBeginner`; missed turns never make a beginner away (leaving the app still does).
- Beginner table = created by a beginner (`t.beginnerTable`). Open tables list: beginners see ONLY beginner tables (manager's choice); everyone sees the "🌱 Beginner table" tag, other tables show "Level N+" (highest seated level).
- Beginners never just watch: joining from the list or a link seats them on the first free (bot) seat, also mid-game (`newbieSeat` in the join handler); the list button says "Play". Full table: they watch.

## First open (Nov 18 2026, on pending-updates until deploy)
- Manager's father (reads Urdu + English) closed the app on the first screen: too many choices. Very first open (`isNewcomer()`: not signed in, no table link, none of rb-started/rb-name/rb-coached/rb-tut-seen/rb-games-done) shows only faces, logo, "Rung, the card game you know" and one big "▶ Start playing / کھیلنا شروع کریں" button + "I have played before" link (normal home). Start (`startFirstGame`) sets name "Guest NNN", 4 players Classic Quick, coach on, private, and starts the guided practice at once. Afterwards the normal home shows (rb-started).

## Lobby (Nov 18 2026, on pending-updates until deploy)
- Host's "Start game" button + hint sit in `.start-dock`, sticky at the bottom of the lobby sheet, so it is visible without scrolling even with 8 seats on small phones (tested 360x640).
- Manager wants the lobby on one screen without scrolling: compact head (code + summary), share row WhatsApp / Copy link / 👥 Friends (link text hidden, shown only if copying fails), seat tiles show only name + You/Sit here/Taken (team by colour, key next to "Pick your seat"), 6p 3 columns, 8p 4 columns, Leave table inside the dock. Fits at 360x640 and 390x844 for 4/6/8, guest and signed in.

## Render environment (names only)
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, ADMIN_PASS, TURN_URL, TURN_USER, TURN_PASS, optional CONTACT_EMAIL. Never print or store their values.

## Next steps (launch plan)
1. Play developer account applied Oct 25 2026 (personal, developer name Dhedhi Tech), ID check pending. pattaparty.com bought.
2. DONE (Oct 2026): pattaparty.com live on Render. Code has no hardcoded old URLs.
3. IN PROGRESS: Android app built (see Android app section). Still to do: real logo, AdMob rewarded/interstitial ads (Ansa creates an AdMob account), Play store listing.
4. Closed test PUBLISHED Oct 28 2026 (track "Closed testing - Alpha", version 6 / 1.0.6 live same day (opens in-app), Pakistan only, 16 testers, WhatsApp testers group). Needs 12+ opted in for 14 days, then Apply for production. Upgrade Render to the $7 plan before launch.
   - Deployed Oct 28: mute/report, back button, admin recent sign-ups + app usage. supabase-reports.sql and supabase-app.sql run; CONTACT_EMAIL set on Render (checked Nov 10).
   - Before production (Ansa said wait): Delete my account button (Google requires). Back button DONE (tester asked). Vibration only if testers ask. Real logo, AdMob (then Ads + Advertising ID answers change to Yes), Play Store video (YouTube link).
   - Play Console answers given: app access No restriction, ads No, target audience 18+, content rating interactions Yes, data safety (name, email, user IDs, photos, voice + chat ephemeral, app interactions, device IDs), advertising ID No.
5. Later: real push notifications (friends, invites), sticker packs for coins, landscape/tablet layout.
