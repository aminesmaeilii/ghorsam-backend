# قرصام

Express + `node:sqlite` (built into Node.js 22+, no native build needed) backend for the
Ghorsam Eitaa Mini App: stores each user's pills and reminder times, and sends a message
in their Eitaa PV via the Eitaa app API when a reminder is due.

This is a single deployable app: `server.js` serves the JSON API under `/api/*` **and**
the Mini App's static frontend from [`./public`](public) (plain HTML/CSS/JS, no build
step — see [`public/README.md`](public/README.md) for frontend-specific notes) from the
same origin. One process, one Hamravesh service, no CORS to configure.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `EITAA_BOT_TOKEN` — your app token from the Eitaa developer panel (eitaayar.ir).
- `APP_SECRET` — a random string of 32+ characters, used to sign session tokens issued
  after the client verifies with `initData`. Generate one with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  This app has no login screen — identity comes entirely from Eitaa's `initData`.
- `DATA_DIR` — where the SQLite file lives. Leave empty for local dev (defaults to
  `./data`). **In production this must point at a mounted persistent volume** — see
  the deployment section below.
- `DEV_SKIP_AUTH=1` — only for local development outside the Eitaa client, where
  there's no real `initData` to validate. The server refuses to start with this set
  and `NODE_ENV=production` at the same time.

```bash
npm start
```

(`npm start` runs `node --experimental-sqlite server.js` — the flag is a no-op on
Node versions where `node:sqlite` no longer needs it, and required on others, so it's
always included for portability across Node 22.5+.)

## How reminders work

`src/reminder.js` runs a cron job every minute (Asia/Tehran timezone), in the same
process as the HTTP server. For every active pill whose `times` array contains the
current `HH:mm`, and whose owner has granted `allows_write_to_pm`, it calls the Eitaa
`sendMessage` API. A `reminder_log` table with a unique `(pill_id, sent_for)` index
prevents double-sends if the job overlaps or restarts.

**This is deliberately the only reminder channel, and it's enough.** A Mini App's
webview has no independent way to register OS-level push notifications — there's no
Web Push API exposed to it, and nothing survives after the user closes the Mini App.
The one channel that *does* survive is sending the user a normal PV message through
the app: Eitaa handles that exactly like any other new chat message, including its
own native phone push notification. So `sendMessage` already covers both requirements
(a message inside Eitaa, and a notification on the user's phone) — there's nothing
extra to build. The only precondition is `allows_write_to_pm`, which is why the
frontend requests it proactively on first load and exposes a manual "enable" button
in the profile tab if the user dismissed that prompt.

Because the cron lives in-process, **this service must run as a single, always-on
instance** — not a scale-to-zero function and not multiple replicas. `node:sqlite`
writes are synchronous and file-based, so two instances writing the same file
concurrently would corrupt data, and two instances both running the cron would send
duplicate reminders (the dedupe index only protects against overlap within one
process's restarts, not against a second independent process).

## API

- `POST /api/auth/verify-init` — body `{ initData }`, validates the Eitaa hash
  (including `auth_date` freshness — rejects anything older than 24h), upserts the
  user, returns a signed session `token`.
- `GET /api/auth/me` — the caller's profile.
- `POST /api/auth/write-access` — body `{ granted }` (Bearer token), records whether
  the user granted PM write access after `requestWriteAccess()`.
- `POST /api/auth/test-message` — sends the caller a real test PV message right now
  and returns Eitaa's raw `{ status, body }` response. Not used by the UI; it's a
  debugging tool — call it with your own session token when a reminder isn't
  arriving, and the response tells you exactly why Eitaa rejected it (wrong token,
  no write access, etc.) without needing to read container logs.
- `GET /api/pills` / `POST /api/pills` / `PUT /api/pills/:id` / `DELETE /api/pills/:id`
- `GET /api/doses/today` — today's schedule with taken/not-taken status.
- `POST /api/doses/toggle` — body `{ pillId, time }`, marks/unmarks a dose as taken.
- `GET /api/doses/stats` — streak, total taken, today's progress.

Every pills/doses route is scoped to `req.userId` (derived from the signed session
token) at the SQL level — one user can never read or mutate another user's rows.

## Running with Docker

```bash
docker build -t ghorsam .
docker run -d --name ghorsam -p 3000:3000 \
  -e EITAA_BOT_TOKEN=your-token \
  -e APP_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  -v ghorsam-data:/data \
  ghorsam
```

The image already sets `DATA_DIR=/data` and exposes a `/api/health`-based
`HEALTHCHECK`, so a named volume mounted at `/data` (as above) is all persistence
needs — verified locally: the SQLite file lives on the volume and survives
`docker restart`.

## Deploying to Hamravesh

**Runtime:** deploy the included `Dockerfile` as a long-running web service — not a
serverless/scale-to-zero function, since the reminder cron lives in the same process
(see the reminders note above). If Hamravesh's Node buildpack is used instead of
Docker, it needs Node 22+ and `npm start` (or the included `Procfile`).

**Environment variables to set in the Hamravesh dashboard:**

| Variable          | Value                                                                 |
|--------------------|------------------------------------------------------------------------|
| `EITAA_BOT_TOKEN`  | your app token from eitaayar.ir                                       |
| `APP_SECRET`       | a random 32+ char string (generate once, keep it stable across deploys — rotating it logs out every user) |
| `DATA_DIR`         | already set to `/data` by the Dockerfile — only override if your volume mounts elsewhere |
| `PORT`             | whatever Hamravesh expects your app to listen on (often provided automatically) |
| `ALLOWED_ORIGINS`  | leave empty — the frontend is served from this same app/origin now      |
| `DEV_SKIP_AUTH`    | leave unset (must **not** be `1` in production)                       |

**Database:** you don't need a managed database add-on for this app. It stores
everything in one embedded SQLite file. What you *do* need is a **persistent
volume/disk** mounted at `/data` (Hamravesh's container filesystem is otherwise wiped
on every redeploy/restart) — that's the `-v ghorsam-data:/data` part of the `docker
run` example above, translated to whatever Hamravesh calls its volume-mount setting.
This is a disk, not an "object storage" bucket.

**Object storage:** not needed at all — this app has no file/image uploads.

**If you outgrow this:** the two real limits of the SQLite setup are (1) single
instance only, and (2) whatever the persistent volume gives you for backups. If you
later need multiple replicas or automated point-in-time backups, that's the point to
migrate `src/db.js` to a managed Postgres instance — the rest of the app (routes,
frontend) wouldn't need to change, only the data-access layer.
