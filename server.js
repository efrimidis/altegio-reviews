require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const config = require('./config');
const { fetchReviews } = require('./altegio');
const { buildSlotsMessage } = require('./slots');
const telegram = require('./telegram');
const state = require('./state');

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
// Each run supersedes the previous post: the new post (15:00 → today) replaces
// the evening "tomorrow" post, and vice versa, so the channel never shows a
// stale offer. Build first so a fetch failure leaves the old post intact.
async function publishSlots(schedule) {
  const message = await buildSlotsMessage(schedule);

  const prev = state.read();
  if (prev.messageId) {
    try {
      await telegram.deleteMessage(prev.messageId);
    } catch (err) {
      console.error('Failed to delete previous post:', err.message);
    }
  }

  if (!message) {
    state.write({}); // previous offer is gone; nothing relevant to show now
    console.log(`No free slots (${schedule.day}) — previous post removed.`);
    return { posted: false, reason: 'empty' };
  }

  const sent = await telegram.postToChannel(message);
  state.write({ messageId: sent.message_id });
  console.log(`Posted free slots (${schedule.day}) to Telegram (id ${sent.message_id}).`);
  return { posted: true, messageId: sent.message_id };
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

// Manual trigger for testing. ?day=today|tomorrow picks the schedule.
// ?dry=1 previews the message without posting.
// Requires ?secret=<PUBLISH_SECRET> when that env var is set.
app.get('/publish-slots', async (req, res) => {
  if (PUBLISH_SECRET && req.query.secret !== PUBLISH_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const day = req.query.day === 'tomorrow' ? 'tomorrow' : 'today';
  const schedule = config.postSchedules.find((s) => s.day === day) || config.postSchedules[0];
  try {
    if (req.query.dry) {
      const message = await buildSlotsMessage(schedule);
      return res.json({ dryRun: true, day, message });
    }
    const result = await publishSlots(schedule);
    res.json(result);
  } catch (error) {
    console.error('publishSlots failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// --- Scheduler -------------------------------------------------------------
if (telegram.isConfigured) {
  for (const schedule of config.postSchedules) {
    cron.schedule(schedule.cron, () => {
      publishSlots(schedule).catch((err) => console.error('Scheduled publish failed:', err.message));
    }, { timezone: config.timezone });
  }
  const summary = config.postSchedules.map((s) => `${s.cron} → ${s.day}`).join(', ');
  console.log(`Slot scheduler active (${config.timezone}): ${summary}`);
} else {
  console.warn('Telegram not configured — slot scheduler is disabled.');
}

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
