require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const config = require('./config');
const { fetchReviews } = require('./altegio');
const { buildSlotsMessage } = require('./slots');
const { buildReportMessage, togglePayButton } = require('./report');
const telegram = require('./telegram');
const state = require('./state');
const { matchesSecret, getBearerToken } = require('./security');

// --- Configuration ---------------------------------------------------------
const PORT = process.env.PORT || 3000;
const COMPANY_ID = process.env.ALTEGIO_COMPANY_ID;
const PUBLISH_SECRET = process.env.PUBLISH_SECRET;
const REPORT_WEBHOOK_SECRET = process.env.REPORT_WEBHOOK_SECRET;

function positiveNumberEnv(name, fallback, integer = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    console.error(`${name} must be a positive${integer ? ' integer' : ''} number.`);
    process.exit(1);
  }
  return value;
}

const REVIEWS_COUNT = positiveNumberEnv('REVIEWS_COUNT', 20, true);
const CACHE_TTL_MS = positiveNumberEnv('CACHE_TTL_MINUTES', 10) * 60 * 1000;

function publicBaseUrl() {
  const raw = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error('HTTPS is required');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch (err) {
    console.warn(`Invalid public URL (${err.message}) — report callback buttons are disabled.`);
    return null;
  }
}

const PUBLIC_BASE_URL = publicBaseUrl();
const WEBHOOK_SECRET_IS_VALID =
  typeof REPORT_WEBHOOK_SECRET === 'string' && /^[A-Za-z0-9_-]{24,256}$/.test(REPORT_WEBHOOK_SECRET);
const REPORT_CALLBACKS_ENABLED = Boolean(
  telegram.isReportConfigured && PUBLIC_BASE_URL && WEBHOOK_SECRET_IS_VALID,
);

// Fail fast on misconfiguration instead of returning broken data at runtime.
const missing = ['ALTEGIO_COMPANY_ID', 'ALTEGIO_BEARER_TOKEN', 'ALTEGIO_USER_TOKEN']
  .filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

if (!PUBLISH_SECRET) {
  console.warn('PUBLISH_SECRET is not configured — manual publishing routes are disabled.');
} else if (PUBLISH_SECRET.length < 24) {
  console.warn('PUBLISH_SECRET is short; use a random value of at least 24 characters.');
}

// --- Reviews ---------------------------------------------------------------
let cachedReviews = null;
let lastFetchTime = 0;
let reviewsFetchPromise = null;

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

async function refreshReviews() {
  if (!reviewsFetchPromise) {
    reviewsFetchPromise = getReviews()
      .then((reviews) => {
        cachedReviews = reviews;
        lastFetchTime = Date.now();
        return reviews;
      })
      .finally(() => {
        reviewsFetchPromise = null;
      });
  }
  return reviewsFetchPromise;
}

// --- Slots publishing ------------------------------------------------------
// Each run supersedes the previous post: the new post (15:00 → today) replaces
// the evening "tomorrow" post, and vice versa, so the channel never shows a
// stale offer. Calls are serialized to prevent cron/manual races.
let slotsPublishQueue = Promise.resolve();

async function publishSlotsNow(schedule) {
  const message = await buildSlotsMessage(schedule);
  const prev = state.read();
  const previousMessageId = prev.slotMessageId || prev.messageId; // migrate old state shape

  if (!message) {
    if (previousMessageId) {
      try {
        await telegram.deleteMessage(previousMessageId);
      } catch (err) {
        console.error('Failed to delete previous post:', err.message);
        return { posted: false, reason: 'empty', cleanupPending: true };
      }
    }
    state.update((current) => {
      const next = { ...current };
      delete next.messageId;
      delete next.slotMessageId;
      return next;
    });
    console.log(`No free slots (${schedule.day}) — previous post removed.`);
    return { posted: false, reason: 'empty' };
  }

  // Publish first. If Telegram rejects the new post, the old useful post stays
  // visible. A failed cleanup can leave a duplicate, but never an empty channel.
  const sent = await telegram.postToChannel(message);
  state.update((current) => {
    const next = { ...current, slotMessageId: sent.message_id };
    delete next.messageId;
    return next;
  });

  let previousDeleted = true;
  if (previousMessageId && previousMessageId !== sent.message_id) {
    try {
      await telegram.deleteMessage(previousMessageId);
    } catch (err) {
      previousDeleted = false;
      console.error('Failed to delete previous post:', err.message);
    }
  }
  console.log(`Posted free slots (${schedule.day}) to Telegram (id ${sent.message_id}).`);
  return { posted: true, messageId: sent.message_id, previousDeleted };
}

function publishSlots(schedule) {
  const run = slotsPublishQueue.then(() => publishSlotsNow(schedule));
  slotsPublishQueue = run.catch(() => {});
  return run;
}

// --- Payroll report --------------------------------------------------------
// Posts the end-of-day payroll report to the private group. Unlike the slots
// post, reports are kept (one per day) and duplicate calls are ignored.
const reportDateKey = (now = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

let reportPublishQueue = Promise.resolve();

async function publishReportNow({ force = false, now = new Date() } = {}) {
  const date = reportDateKey(now);
  const prev = state.read();
  if (!force && prev.lastReportDate === date) {
    return { posted: false, reason: 'already-posted', messageId: prev.lastReportMessageId };
  }

  const { text, keyboard } = await buildReportMessage(now);
  const replyMarkup = REPORT_CALLBACKS_ENABLED && keyboard.length
    ? { inline_keyboard: keyboard }
    : undefined;
  const sent = await telegram.postReport(text, replyMarkup);
  state.update((current) => ({
    ...current,
    lastReportDate: date,
    lastReportMessageId: sent.message_id,
  }));
  console.log(`Posted payroll report to Telegram (id ${sent.message_id}).`);
  return { posted: true, messageId: sent.message_id };
}

function publishReport(options) {
  const run = reportPublishQueue.then(() => publishReportNow(options));
  reportPublishQueue = run.catch(() => {});
  return run;
}

// Webhook path for the report bot's "mark paid" buttons.
const REPORT_WEBHOOK_PATH = '/telegram/report-callback';

// Toggle the tapped master's checkbox (⬜ <-> ✅) in place.
async function handleReportCallback(update) {
  const cq = update.callback_query;
  if (!cq) return;
  const match = /^pay:(\d+)$/.exec(cq.data || '');
  const keyboard = cq.message && cq.message.reply_markup && cq.message.reply_markup.inline_keyboard;
  if (match && keyboard) {
    const button = keyboard[Number(match[1])] && keyboard[Number(match[1])][0];
    if (button) {
      const paid = togglePayButton(button);
      await telegram.editReportMarkup(cq.message.chat.id, cq.message.message_id, {
        inline_keyboard: keyboard,
      });
      await telegram.answerReportCallback(cq.id, paid ? 'Отмечено как выплачено ✅' : 'Снято ⬜');
      return;
    }
  }
  await telegram.answerReportCallback(cq.id);
}

// --- HTTP server -----------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/', (req, res) => res.json({
  status: 'ok',
  schedulers: {
    slots: telegram.isConfigured,
    report: telegram.isReportConfigured,
    reportCallbacks: REPORT_CALLBACKS_ENABLED,
  },
}));

function requirePublishAuth(req, res, next) {
  if (!PUBLISH_SECRET) {
    return res.status(503).json({ error: 'Manual publishing is disabled' });
  }
  const provided = getBearerToken(req.get('Authorization'));
  if (!matchesSecret(provided, PUBLISH_SECRET)) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

// Telegram pushes "mark paid" button taps here. Verify the secret header, ack
// immediately, then process (Telegram retries on non-2xx, so never block).
app.post(REPORT_WEBHOOK_PATH, (req, res) => {
  if (!REPORT_CALLBACKS_ENABLED) return res.sendStatus(503);
  if (!matchesSecret(req.get('X-Telegram-Bot-Api-Secret-Token'), REPORT_WEBHOOK_SECRET)) {
    return res.sendStatus(403);
  }
  res.sendStatus(200);
  handleReportCallback(req.body).catch((err) =>
    console.error('Report callback failed:', err.message),
  );
});

app.get('/altegio-reviews', async (req, res) => {
  const now = Date.now();
  if (cachedReviews && now - lastFetchTime < CACHE_TTL_MS) {
    return res.json(cachedReviews);
  }
  try {
    const reviews = await refreshReviews();
    res.json(reviews);
  } catch (error) {
    console.error('Failed to fetch reviews from Altegio:', error.message);
    if (cachedReviews) return res.json(cachedReviews); // serve stale data on failure
    res.status(502).json({ error: 'Failed to fetch reviews' });
  }
});

// Manual trigger for testing. JSON body: { day: "today" | "tomorrow", dry: true }.
app.post('/publish-slots', requirePublishAuth, async (req, res) => {
  const day = req.body && req.body.day === 'tomorrow' ? 'tomorrow' : 'today';
  const schedule = config.postSchedules.find((s) => s.day === day) || config.postSchedules[0];
  try {
    if (req.body && req.body.dry === true) {
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

// Manual report trigger. `force: true` intentionally sends a second report for
// the same local calendar day; otherwise duplicate requests are idempotent.
app.post('/publish-report', requirePublishAuth, async (req, res) => {
  try {
    if (req.body && req.body.dry === true) {
      const { text } = await buildReportMessage();
      return res.json({ dryRun: true, message: text });
    }
    const result = await publishReport({ force: Boolean(req.body && req.body.force === true) });
    res.json(result);
  } catch (error) {
    console.error('publishReport failed:', error.message);
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

if (telegram.isReportConfigured) {
  cron.schedule(config.report.cron, () => {
    publishReport().catch((err) => console.error('Scheduled report failed:', err.message));
  }, { timezone: config.timezone });
  console.log(`Payroll report scheduler active (${config.timezone}): ${config.report.cron}`);

  // Register the callback webhook only when both a public HTTPS URL and an
  // independent Telegram-compatible secret are available.
  if (REPORT_CALLBACKS_ENABLED) {
    telegram
      .setReportWebhook(`${PUBLIC_BASE_URL}${REPORT_WEBHOOK_PATH}`, REPORT_WEBHOOK_SECRET)
      .then(() => console.log(`Report webhook set: ${PUBLIC_BASE_URL}${REPORT_WEBHOOK_PATH}`))
      .catch((err) => console.error('setReportWebhook failed:', err.message));
  } else if (!PUBLIC_BASE_URL) {
    console.warn('No valid public HTTPS URL — report callback buttons are disabled.');
  } else if (!WEBHOOK_SECRET_IS_VALID) {
    console.warn('REPORT_WEBHOOK_SECRET is missing or invalid — report callback buttons are disabled.');
  } else {
    console.warn('Report callback buttons are disabled.');
  }
} else {
  console.warn('Report Telegram not configured — payroll report scheduler is disabled.');
}

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
