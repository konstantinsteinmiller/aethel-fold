# Leaderboard setup, start to finish

Every command below is run on Windows in PowerShell, from the repo root unless
it says otherwise. You already have a Cloudflare account logged in on the web —
the CLI still needs its own one-time authorisation (step 2), which is a single
click in the browser tab it opens.

Nothing here touches the game's behaviour until the very last step: until
`VITE_LEADERBOARD_URL` is set, the client treats the board as "feature off" and
the death screen simply shows no rank.

---

## 1. Install the Worker toolchain

The Worker has its own `package.json`, deliberately separate from the game's —
it deploys on its own schedule and shares none of the game's dependencies.

```powershell
cd worker
npm install
```

(`pnpm install` works too if you prefer to match the main project. The lockfile
it creates is local to `worker/`.)

## 2. Authorise the CLI

```powershell
npx wrangler login
```

A browser tab opens on the account you are already signed into. Click **Allow**.
The terminal then prints `Successfully logged in`.

Check it picked the right account:

```powershell
npx wrangler whoami
```

## 3. Create the database

```powershell
npx wrangler d1 create 3d-world-leaderboard
```

It prints a block like this:

```toml
[[d1_databases]]
binding = "DB"
database_name = "3d-world-leaderboard"
database_id = "0f2c9a51-....-............"
```

**Copy the `database_id` value** and paste it into `worker/wrangler.toml`,
replacing `REPLACE_ME`. That one line is the only edit the file needs:

```toml
database_id = "0f2c9a51-....-............"
```

## 4. Create the tables

```powershell
npm run db:init
```

This runs `schema.sql` against the **remote** database (the real one, not the
local emulator). Wrangler asks for confirmation before touching remote data —
answer `y`. You should see two `CREATE TABLE` statements and one `CREATE INDEX`
execute.

Verify from the dashboard if you like: **Storage & Databases → D1 →
3d-world-leaderboard → Tables** should now list `scores` and `board_cache`.

## 5. Deploy

```powershell
npm run deploy
```

On a brand-new account this asks you to register a `workers.dev` subdomain
first — pick anything, it becomes part of the URL. When it finishes it prints:

```
Published 3d-world-leaderboard
  https://3d-world-leaderboard.<your-subdomain>.workers.dev
```

**That URL is what the game needs.** Keep it.

## 6. Check it is alive

```powershell
# The board — empty at this point, which is the correct answer.
Invoke-RestMethod https://3d-world-leaderboard.<your-subdomain>.workers.dev/top

# Post a fake score and get a rank back.
$body = @{ id = 'testplayer01'; name = 'Tester'; score = 137; wave = 21 } | ConvertTo-Json
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $body `
  https://3d-world-leaderboard.<your-subdomain>.workers.dev/score
```

The first returns `entries: {}` / `total: 0`. The second returns
`rank: 1, best: 137, total: 1`, and re-running `/top` now shows the entry.

Sanity-check the guards while you are here — both should be **rejected**:

```powershell
# 422: a score no run could produce at that wave.
$bad = @{ id = 'testplayer01'; name = 'Cheat'; score = 999999999; wave = 3 } | ConvertTo-Json
Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $bad `
  https://3d-world-leaderboard.<your-subdomain>.workers.dev/score

# 429: two writes for the same id inside the 3 s cooldown.
```

Delete the test row when you are done:

```powershell
npx wrangler d1 execute 3d-world-leaderboard --remote `
  --command "DELETE FROM scores WHERE id = 'testplayer01'"
# The cached blob still holds the old table until the next write rebuilds it:
npx wrangler d1 execute 3d-world-leaderboard --remote `
  --command "DELETE FROM board_cache"
```

## 7. Point the game at it

In the repo root, edit `.env`:

```
VITE_LEADERBOARD_URL=https://3d-world-leaderboard.<your-subdomain>.workers.dev
```

Leave `VITE_LEADERBOARD_SECRET` empty for now (see "Signed submissions" below).

Vite loads `.env` for **every** build mode, so this one line switches the board
on for all of them. Two consequences worth knowing:

* **You do not need to touch `csp.ts`.** `buildCsp()` reads this same variable
  and folds the origin into `connect-src` itself, so the policy can never fall
  out of step with the endpoint.
* **Yandex is the exception.** Their moderator rejects third-party storage
  endpoints found anywhere in the bundle, so `buildCsp()` deliberately omits the
  host on Yandex builds. Turn the client off there too, so it does not fire a
  request the policy will block — add this line to `.env.yandex.local`:

  ```
  VITE_LEADERBOARD_URL=
  ```

Now run the game:

```powershell
cd ..
pnpm dev
```

Play until you die (or use the cheat sequence — type `cmarc`, then
Ctrl+Shift+Alt+W to call waves). The defeat screen should show **SCORE** and
**RANK**. In devtools' Network tab you should see exactly one request to the
Worker: a `POST /score` on a personal record, or a `GET /top` when it is not.

## 8. Ship it

Nothing extra. `pnpm build:crazy-web`, `build:gamepix`, and the rest pick the
variable up from `.env` automatically. To confirm before uploading, grep the
built HTML for the origin — it must be present in the CSP meta tag:

```powershell
Select-String -Path dist\index.html -Pattern "workers.dev"
```

---

## Running it locally (optional)

Useful when changing the Worker itself — no deploys, no remote data:

```powershell
cd worker
npm run db:init:local     # tables in the local emulator
npm run dev               # http://localhost:8787
```

Then set `VITE_LEADERBOARD_URL=http://localhost:8787` in the game's `.env` while
you work. The edge cache is a no-op locally, so every `/top` hits the database —
that is expected and does not reflect production behaviour.

## Signed submissions (optional)

Raises the bar against hand-rolled POSTs. It does not make the board
tamper-proof: the secret ships inside a public bundle, so a determined player
can extract it. The score bound in `plausible()` is what actually caps the
damage.

```powershell
cd worker
npx wrangler secret put SCORE_SECRET     # paste any long random string
npm run deploy
```

Then put the **same** string in the repo root `.env`:

```
VITE_LEADERBOARD_SECRET=<the same string>
```

Both sides must be set or neither: the Worker only demands a signature when
`SCORE_SECRET` exists, and the client only sends one when
`VITE_LEADERBOARD_SECRET` does.

## Locking down origins (optional, later)

`ALLOWED_ORIGINS` in `wrangler.toml` is empty, which allows any origin. That is
the right setting while you are still collecting portal URLs — each portal
serves the game from a different host, and sandboxed iframes send
`Origin: null`, so an early allowlist mostly locks out your own game. Once you
know the real list:

```toml
ALLOWED_ORIGINS = "https://www.crazygames.com,https://html5.gamemonetize.com"
```

Then `npm run deploy` again.

## Watching it in production

* **Live logs:** `npx wrangler tail` (from `worker/`), or the dashboard under
  **Workers & Pages → 3d-world-leaderboard → Logs**.
* **Quota use:** same page, **Metrics**. The numbers to watch are requests/day
  (100k) and D1 rows written/day (100k). Reads are effectively free under this
  design — see the table in `README.md`.
* **The data:** **Storage & Databases → D1 → 3d-world-leaderboard → Console**
  lets you run SQL straight from the browser, e.g.
  `SELECT * FROM scores ORDER BY score DESC LIMIT 20;`

## Clearing the rows an unstable identity left behind

If the board already holds several rows for the same person — the symptom of
the pre-identity build, where each record could mint a fresh id — the honest fix
is to empty it and let the new build repopulate. The rows cannot be merged
reliably: they are all named `Anon`, so there is nothing to tell one player's
duplicates from another player's rows.

```powershell
cd worker
npx wrangler d1 execute 3d-world-leaderboard --remote --command "DELETE FROM scores"
# The materialised top-N is a separate row and does not clear itself.
npx wrangler d1 execute 3d-world-leaderboard --remote --command "DELETE FROM board_cache"
```

If you would rather keep the highest score per name, and you accept that every
`Anon` collapses into one row:

```sql
DELETE FROM scores WHERE id NOT IN (
  SELECT id FROM scores s1
  WHERE s1.score = (SELECT MAX(s2.score) FROM scores s2 WHERE s2.name = s1.name)
  GROUP BY s1.name
);
DELETE FROM board_cache;
```

## Playgama builds post to two boards

On Playgama the best score also goes to the portal's own leaderboard through
`bridge.leaderboard` (`useNativeLeaderboard.ts`), on the same
only-on-an-improvement rule as the Worker. Nothing to configure and no support
ticket: the bridge advertises what the underlying platform can do, and the call
is skipped when the answer is no.

```
bridge.leaderboard missing            → skipped
isSupported === false                 → skipped
isSetScoreSupported === false         → skipped
isMultipleBoardsSupported === true    → a board name is sent
setScore() throws                     → logged, ignored
```

The last line is the one to expect first. Several platforms behind the bridge
only accept scores for a board that was **created in their developer console**,
and some only from a signed-in player. Neither is something the game can arrange
from inside itself, so the call fails and the Worker board — which needs no
portal cooperation at all — carries the rank on the death screen regardless.

Two deliberate omissions:

* **No `authorizePlayer()` call.** The bridge can prompt for a login, but a
  sign-in dialog on the defeat screen is a worse trade than a missing row on a
  board the player never asked about.
* **No reading back.** The rank shown comes from the Worker, which answers the
  same way on every platform. Two rank sources that disagree is a worse screen
  than one that is merely ours.

To check what happened on a real Playgama session, look for
`[playgama] leaderboard.setScore skipped` in the console — absent means it went
through. If you do create a named board in a portal console, set
`VITE_PLAYGAMA_LEADERBOARD_NAME` to match it.

## How a player is identified

`usePlayerIdentity.ts` resolves it in tiers, best first:

1. **The portal's own player id** — Yandex `getUniqueID()`, Playgama
   `bridge.player.id`. Stable across reinstalls and devices, and it is the same
   id the portal's cloud save is keyed on. CrazyGames supplies a *username* but
   no id, so its players are keyed on tier 2/3 and merely labelled with it.
2. **The uuid in the save blob** (`ts_player_id`) — rides the cloud save, so it
   follows the player between devices.
3. **The uuid in its own localStorage key** (`towersiege_uid`) — deliberately
   outside the `ts_`-prefixed blob that `SaveMergePolicy` syncs, so a cloud
   hydrate arriving with an older blob cannot replace it. This is the tier that
   stops duplicate rows.

Whichever answers, the id is written back to both local homes and flushed
synchronously — an id living only in memory until a debounce fires is an id a
reload can lose, and a lost id is a new row.

## Player names

Three tiers, highest first, each in its own storage slot so a later tier can
still take over — collapsing them into one field means whatever is written first
wins forever:

| Tier | Slot | Source |
|---|---|---|
| 1 | `ts_player_name` | chosen by the player |
| 2 | `ts_sdk_name` | CrazyGames username, Yandex `getName()`, Playgama `player.name` |
| 3 | `ts_anon_name` | generated: `Watcher333915` — a random word and six random digits |

The generated name is minted once and cached in both the save blob and a
standalone `towersiege_name` key, so replacing the blob (a cloud hydrate) does
not rename the player. Nothing posts as `Anon`; a board of identical
placeholders tells a player nothing, not even which row is theirs.

Edge cases that are handled, because each of them is a way the board ends up
showing the wrong name:

* **The SDK answers late.** `getUser()` resolves after the first death, so the
  opening submission can go up generated. The next `reportRun` notices the name
  no longer matches `ts_posted_name` and sends one write to correct the row —
  otherwise it would keep the generated name until the player beat their own
  record, which might be never.
* **The SDK goes quiet again** (offline, signed out, a slower `getUser()`). The
  last known SDK name is remembered, so the player does not flip back to their
  anonymous name and rename their row on the next submission.
* **Hostile or empty names.** Control codes, zero-width joiners and bidi
  overrides are stripped, and a name that sanitises to nothing falls through to
  the next tier rather than posting an empty row. Everything is capped at 16
  characters — the generated words are all ≤ 9 so `word + six digits` never
  truncates. The Worker repeats all of this on arrival; the client copy exists
  so the player sees locally what the board will show.

Still missing is a UI for tier 1. `setPlayerName()` is wired and validated —
what is absent is a text field on the death screen or in the options modal to
call it.
