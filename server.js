require('dotenv').config();
const express = require('express');
const path = require('node:path');

function validateEnv() {
  const devSkip = process.env.DEV_SKIP_AUTH === '1';
  const problems = [];

  if (!devSkip && !process.env.EITAA_BOT_TOKEN) {
    problems.push('EITAA_BOT_TOKEN is required (unless DEV_SKIP_AUTH=1).');
  }
  if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32) {
    problems.push(
      'APP_SECRET is required and must be at least 32 characters — it signs every session token. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (devSkip && process.env.NODE_ENV === 'production') {
    problems.push('DEV_SKIP_AUTH=1 must never be set in production — it disables identity verification.');
  }

  if (problems.length > 0) {
    console.error('Refusing to start: invalid configuration.\n' + problems.map((p) => ` - ${p}`).join('\n'));
    process.exit(1);
  }
}

validateEnv();

const { router: authRouter } = require('./src/routes/auth');
const pillsRouter = require('./src/routes/pills');
const dosesRouter = require('./src/routes/doses');
const { startReminderScheduler } = require('./src/reminder');

const app = express();
app.set('trust proxy', 1); // behind Hamravesh's reverse proxy / load balancer

// Only needed when the frontend is hosted on a different origin than this
// API. Same-origin deployments (this server also serving ./public) don't
// need it and ALLOWED_ORIGINS can stay empty.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/pills', pillsRouter);
app.use('/api/doses', dosesRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the built frontend if it's been copied next to this server (see README).
const staticDir = path.join(__dirname, 'public');
app.use(express.static(staticDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(staticDir, 'index.html'), (err) => {
    if (err) next();
  });
});

// Don't let one bad request or a transient network error (e.g. a failed
// Eitaa sendMessage call) take the whole process down.
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ghorsam backend listening on port ${PORT}`);
  startReminderScheduler();
});
