require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const config = require('./config');
const { fetchReviews } = require('./altegio');
const { buildSlotsMessage } = require('./slots');
const telegram = require('./telegram');

// --- Configuration ---------------------------------------------------------
const PORT = process.env.PORT || 3000;
const COMPANY_ID = process.env.ALTEGIO_COMPANY_ID;
const REVIEWS_COUNT = Number(process.env.REVIEWS_COUNT) || 20;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_MINUTES) || 10) * 60 * 1000;
const PUBLISH_SECRET = process.env.PUBLISH_SECRET; // protects the manual trigger route

// Fail fast on misconfiguration instead of returning broken data at runtime.
const missing = ['ALTEGIO_COMPANY_ID', 'ALTEGIO_BEARER_TOKEN', 'ALTEGIO_USER_TOKEN']
  .filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// --- Reviews ---------------------------------------------------------------
let cachedReviews = null;
let lastFetchTime = 0;

const reviewDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const formatReviewDate = (raw) =>
  reviewDateFormatter.format(new Date(raw)).replace(/\sг\.$/, ''); // strip trailing " г."

async function getReviews() {
  const data = await fetchReviews(COMPANY_ID, REVIEWS_COUNT);
  return data
    .filter((r) => r.text && r.text.trim().length > 0)
    .map((r) => ({
      name: r.user_name,
      text: r.text.trim(),
      date: formatReviewDate(r.date),
      rating: r.rating,
    }));
}

// --- Slots publishing ------------------------------------------------------
async function publishSlots() {
  const message = await buildSlotsMessage();
  if (!message) {
    console.log('No free slots today — skipping post.');
    return { posted: false, reason: 'empty' };
  }
  await telegram.postToChannel(message);
  console.log('Posted free slots to Telegram.');
  return { posted: true };
}

// --- HTTP server -----------------------------------------------------------
const app = express();
app.use(cors());

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.get('/altegio-reviews', async (req, res) => {
  const now = Date.now();
  if (cachedReviews && now - lastFetchTime < CACHE_TTL_MS) {
    return res.json(cachedReviews);
  }
  try {
    cachedReviews = await getReviews();
    lastFetchTime = now;
    res.json(cachedReviews);
  } catch (error) {
    console.error('Failed to fetch reviews from Altegio:', error.message);
    if (cachedReviews) return res.json(cachedReviews); // serve stale data on failure
    res.status(502).json({ error: 'Failed to fetch reviews' });
  }
});

// Manual trigger for testing. ?dry=1 previews the message without posting.
// Requires ?secret=<PUBLISH_SECRET> when that env var is set.
app.get('/publish-slots', async (req, res) => {
  if (PUBLISH_SECRET && req.query.secret !== PUBLISH_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    if (req.query.dry) {
      const message = await buildSlotsMessage();
      return res.json({ dryRun: true, message });
    }
    const result = await publishSlots();
    res.json(result);
  } catch (error) {
    console.error('publishSlots failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Scheduler -------------------------------------------------------------
if (telegram.isConfigured) {
  for (const expr of config.postSchedules) {
    cron.schedule(expr, () => {
      publishSlots().catch((err) => console.error('Scheduled publish failed:', err.message));
    }, { timezone: config.timezone });
  }
  console.log(`Slot scheduler active (${config.timezone}): ${config.postSchedules.join(', ')}`);
} else {
  console.warn('Telegram not configured — slot scheduler is disabled.');
}

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
