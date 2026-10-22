# Patta Party

Online team bidding card game for 4, 6 or 8 players. Create a table, share the link, friends join from any phone with no sign-in. Bots fill empty seats.

## Run locally
    npm install
    npm start
Open http://localhost:3000

## Deploy on Render
New → Web Service → connect this repo → Build `npm install` → Start `npm start` → Free plan.

## Files
- `server.js` web server and table rooms (Socket.IO)
- `game.js` rules, bots, joker mode, scoring (the server is the referee)
- `public/index.html`, `public/app.js` the game screen
