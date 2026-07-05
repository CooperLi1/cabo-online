# cabo! 🃏

A cute pixel-art multiplayer version of **Cabo** (the Cambio-family card game).
Real-time rooms with 4-letter join codes, 2–10 players, bots with three
difficulty levels, animated learn-to-play, and reaction-speed snapping.

## Run it

```bash
npm install
npm run dev        # dev server on http://localhost:3000
```

Production:

```bash
npm run build
npm start          # NODE_ENV=production node server.js
```

## Deploying

The game needs its **long-running Socket.IO server** (`server.js`). Vercel is
serverless: it builds the Next.js pages but never runs `server.js`, so on a
plain Vercel deploy the "new game" button can't reach a game server. Two ways
to deploy:

### Option A — one Node host for everything (simplest)

Any host that runs a persistent Node process works: **Railway**, **Render**,
**Fly.io**, a VPS. Example with Railway:

1. Push this repo to GitHub.
2. On [railway.app](https://railway.app): **New Project → Deploy from GitHub
   repo** and pick the repo.
3. Railway auto-detects Node. Confirm the commands:
   - build: `npm install && npm run build`
   - start: `npm start`   *(this runs `NODE_ENV=production node server.js`,
     which serves the UI **and** the websocket on one port — `server.js`
     reads `process.env.PORT`, which Railway sets automatically)*
4. **Settings → Networking → Generate Domain** → you get
   `something.up.railway.app`. Done — open it, play. Invite links use that
   domain automatically (they're built from the page's own URL).

#### Render, step by step

There's a `render.yaml` blueprint in the repo, so the quickest path is:

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint**, connect the repo —
   Render reads `render.yaml` and fills in everything. Click **Apply**.

Or manually: **New → Web Service** → connect the repo →
- **Runtime:** Node
- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Instance type:** Free works for testing

Notes:
- Render sets `PORT` automatically and `server.js` reads it — don't set it.
- WebSockets work out of the box on Render web services, nothing to enable.
- Your game lives at `https://<service-name>.onrender.com` — share that URL
  (or a `/?join=CODE` invite link from the lobby).
- **Free-tier caveat:** free services spin down after ~15 minutes of no
  traffic. The first visit after a sleep takes ~30–60s to wake, and since
  rooms live in memory, sleeping wipes any in-progress games. A paid
  instance (or any always-on host) avoids both.

### Option B — keep `cabocards.vercel.app` as the address

The UI stays on Vercel; the socket server runs on a Node host (set up exactly
like Option A — the same deployment happily serves both). Then connect them:

1. Deploy the repo to Railway/Render as in Option A and note its URL, e.g.
   `https://cabo-server.up.railway.app`.
2. In the **Vercel project → Settings → Environment Variables** add:
   `NEXT_PUBLIC_SOCKET_URL = https://cabo-server.up.railway.app`
   *(must start with `https://`; `NEXT_PUBLIC_` vars are baked in at build
   time, so this needs to exist before the build)*
3. **Redeploy** the Vercel project so the new build picks the variable up.
4. Optional hardening on the game server: set
   `CORS_ORIGIN = https://cabocards.vercel.app` (it defaults to `*`,
   which also works).

Now `cabocards.vercel.app` serves the pages, the browser opens its websocket
to the Railway URL, and invite links still say cabocards.vercel.app.

**Checking it works:** open the browser dev tools → Network → WS. You should
see a `socket.io` websocket with status 101 pointed at your game server. If
"new game" shows *"can't reach the game server"*, the socket URL is wrong or
the server isn't up.

## House rules implemented

- Joker **0** · Ace **1** · 2–10 face value · J **11** · Q **12** ·
  red kings **−1** · black kings **25**
- Everyone gets 4 face-down cards and peeks at 2 to start — then it's all memory
- On your turn: draw from the deck (or take the top discard, which must be
  swapped in), then swap into the same slot or toss the draw onto the pile
- Power cards (when tossed straight to the pile): **7/8** peek your own,
  **9/10** spy on someone else's, **J** blind swap, **Q** peek any card then
  optionally swap it with yours.
- **Snap** a card matching the top of the discard anytime — yours or anyone's
  (snapping someone else's means you hand them one of your cards). Wrong card
  *or* too slow → penalty card. Snap races are resolved by true reaction time
  measured on each player's own screen (latency-compensated), and effectively
  simultaneous snaps are a coin flip.
- Win by: calling **CABO** and having the lowest total (ties beat the caller,
  then more cards wins, then it's a shared crown) · snapping away *all* your
  cards · or **kamikaze** — ending with exactly 2 black kings + 2 face cards.

## Architecture

- `server.js` — Next.js + Socket.IO on one port
- `lib/game.js` — authoritative game engine (rooms, rules, timers, snap races)
- `lib/bot.js` — bot brains (imperfect memory, human-ish reaction times)
- `app/` + `components/` — React client: pixel-art UI, `motion` shared-element
  card animations, WebAudio sound effects
