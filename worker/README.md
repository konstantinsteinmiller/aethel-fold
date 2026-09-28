# aethel-fold leaderboard

A single Cloudflare Worker in front of one D1 database. It is deliberately the
smallest thing that can hold a public leaderboard honestly: the game bundle is
public, so the score bound and the write throttle have to live on a server, and
this is that server.

## Deploy

You need a Cloudflare account (free tier is enough) and `npx wrangler login`.

```bash
cd worker
npm install

# 1. Create the database. This prints a database_id — paste it into
#    wrangler.toml under [[d1_databases]].
npx wrangler d1 create aethel-fold-leaderboard

# 2. Create the tables (remote = the real database, not the local emulator).
npm run db:init

# 3. Ship it. This prints the URL, e.g.
#    https://aethel-fold-leaderboard.<your-subdomain>.workers.dev
npm run deploy
```

Then put that URL in the game's env files as `VITE_LEADERBOARD_URL` (see
`.env.leaderboard.example` in the repo root) and add the host to `connect-src`
in `src/platforms/csp.ts` for the builds that should reach it.

Run it locally against a local database with `npm run dev` after
`npm run db:init:local`.

## Free-tier arithmetic

The quotas that matter, and what this design spends against them:

| Resource | Free/day | Cost here |
|---|---|---|
| Worker requests | 100,000 | 1 per board view, 1 per personal record |
| D1 rows read | 5,000,000 | **1** per board view (the cached blob), 0 on an edge hit |
| D1 rows written | 100,000 | ~2 per personal record (score row + blob) |

A board view is one row read because the top 100 is materialised into a single
`board_cache` row on write, and that response is then cached at the edge for 60
seconds — so a burst of players sharing a POP costs nothing at all. Reading the
top 100 as 100 rows, which is the obvious implementation, would have burned the
daily read quota at around 50,000 views.

Writes are the scarce side, which is why the client only submits on a personal
record rather than at the end of every run.

## Endpoints

### `GET /top`

```json
{ "updatedAt": 1731600000000, "total": 4213,
  "entries": [{ "rank": 1, "name": "Ada", "score": 812, "wave": 27 }] }
```

### `POST /score`

```json
{ "id": "a1b2c3d4e5f6", "name": "Ada", "score": 812, "wave": 27, "sig": "…" }
```

Returns `{ rank, best, total, board }`. `sig` is only required when
`SCORE_SECRET` is set.

Rejections: `400` malformed id/JSON, `422` score outside what the game can
produce, `429` same id writing inside the 3 s cooldown, `401` bad signature.

## What this does and does not protect

`plausible()` caps a score against the wave it claims to come from, the
cooldown stops a flood, and `cleanName()` strips the invisible characters used
to spoof a row. None of that makes the board tamper-proof: the game is
client-authoritative, so a determined player can always post a number they
did not earn — they just cannot post an *arbitrary* one, and cannot do it
quickly. If the board ever needs to be trustworthy, the run itself has to be
verified server-side, which is a different and much larger piece of work.
