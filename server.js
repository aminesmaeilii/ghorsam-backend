require('dotenv').config();
const express = require('express');
const path = require('node:path');

const { router: authRouter } = require('./src/routes/auth');
const pillsRouter = require('./src/routes/pills');
const { startReminderScheduler } = require('./src/reminder');

const app = express();
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/pills', pillsRouter);

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ghorsam backend listening on port ${PORT}`);
  startReminderScheduler();
});
