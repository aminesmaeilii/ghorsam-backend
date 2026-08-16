# قرصام — Frontend (Eitaa Mini App)

Plain HTML/CSS/JS, no build step, no login screen. Identity comes from Eitaa's
`initData` (see `js/app.js` → `authenticate()`), which is sent once to the backend
and exchanged for a session token stored in `localStorage`.

This folder is served directly by the parent `server.js` at `/` (same-origin as the
API), so this **is** the canonical copy — edit files here directly.

## Local development

Run the backend (see the parent `../README.md`) with `DEV_SKIP_AUTH=1` in its `.env`,
then open `http://localhost:3000` — it serves this folder and the API from the same
origin, so nothing else needs configuring.

To iterate on the frontend alone with a separate static server instead:

```bash
npx serve .
```

In that case `window.Eitaa` won't exist (outside the real Eitaa client) and this page
is on a different origin than the API, so add before `js/app.js` in `index.html`:

```html
<script>window.GHORSAM_API_BASE = 'http://localhost:3000';</script>
```

and set `ALLOWED_ORIGINS` on the backend to match.

## Publishing as an Eitaa Mini App

1. Deploy the parent backend app (see `../README.md` — Docker image included) over
   HTTPS; it serves this folder at `/`.
2. Register the Mini App in the Eitaa developer panel and set its URL to that
   deployment.
3. The page loads `https://developer.eitaa.com/eitaa-web-app.js` directly per
   Eitaa's docs — don't vendor/self-host that script.

## UI notes

- RTL, gradient hero header, a floating "+" button that opens a bottom sheet
  (add/edit name, icon/color, one or more reminder times via an analog clock picker,
  optional stock count, delete).
- Colors follow Eitaa's theme CSS variables (`--tg-theme-*`) with a red-gradient
  accent fallback, so it adapts to the user's light/dark Eitaa theme.
- No client-side notification logic — reminders are pushed via Eitaa PV messages
  sent by the backend cron job (which Eitaa also turns into a native phone push
  notification, same as any new chat message), so they arrive even if the Mini App
  is closed.
