# قرصام — Backend

Express + `node:sqlite` (built into Node.js 22+, no native build needed) backend for the
Ghorsam Eitaa Mini App: stores each user's pills and reminder times, and sends a message
in their Eitaa PV via the Eitaa app API when a reminder is due.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `EITAA_BOT_TOKEN` — your app token from the Eitaa developer panel (eitaayar.ir).
- `APP_SECRET` — any long random string, used to sign session tokens issued after
  the client verifies with `initData`. This app has no login screen — identity comes
  entirely from Eitaa's `initData`.
- `DEV_SKIP_AUTH=1` — only for local development outside the Eitaa client, where
  there's no real `initData` to validate.

```bash
npm start
```

## How reminders work

`src/reminder.js` runs a cron job every minute (Asia/Tehran timezone). For every
active pill whose `times` array contains the current `HH:mm`, and whose owner has
granted `allows_write_to_pm`, it calls the Eitaa `sendMessage` API. A `reminder_log`
table with a unique `(pill_id, sent_for)` index prevents double-sends if the job
overlaps or restarts.

## API

- `POST /api/auth/verify-init` — body `{ initData }`, validates the Eitaa hash,
  upserts the user, returns a signed session `token`.
- `POST /api/auth/write-access` — body `{ granted }` (Bearer token), records whether
  the user granted PM write access after `requestWriteAccess()`.
- `GET /api/pills` — list the caller's pills.
- `POST /api/pills` — body `{ name, times: ["08:00", "20:00"] }`.
- `PUT /api/pills/:id` — partial update, e.g. `{ active: false }`.
- `DELETE /api/pills/:id`

## Deploying with the frontend

This server also serves static files from `./public` for any path that isn't
`/api/*`. Build/copy the contents of `../../frontend/ghorsam` into `./public` if you
want one process to serve both — otherwise host the frontend separately and set
`window.GHORSAM_API_BASE` in the page to this server's URL.
