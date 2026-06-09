require('dotenv').config();
const express = require('express');
const cors = require('cors');

// --- Configuration ---------------------------------------------------------
const PORT = process.env.PORT || 3000;
const COMPANY_ID = process.env.ALTEGIO_COMPANY_ID;        // location/salon id in Altegio
const PARTNER_TOKEN = process.env.ALTEGIO_BEARER_TOKEN;   // partner (Bearer) token
const USER_TOKEN = process.env.ALTEGIO_USER_TOKEN;        // user token

const REVIEWS_COUNT = Number(process.env.REVIEWS_COUNT) || 20;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_MINUTES) || 10) * 60 * 1000;
const REQUEST_TIMEOUT_MS = (Number(process.env.REQUEST_TIMEOUT_SECONDS) || 10) * 1000;

// Fail fast on misconfiguration instead of returning broken data at runtime.
const missing = ['ALTEGIO_COMPANY_ID', 'ALTEGIO_BEARER_TOKEN', 'ALTEGIO_USER_TOKEN']
  .filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// Altegio B2B v1. Auth format per docs: "Bearer <partner_token>, User <user_token>".
const API_URL = `https://api.alteg.io/api/v1/comments/${COMPANY_ID}`;
const ALTEGIO_HEADERS = {
  Authorization: `Bearer ${PARTNER_TOKEN}, User ${USER_TOKEN}`,
  Accept: 'application/vnd.api.v2+json',
  'Content-Type': 'application/json',
};

// --- Review fetching --------------------------------------------------------
let cachedReviews = null;
let lastFetchTime = 0;

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const formatDate = (raw) =>
  dateFormatter.format(new Date(raw)).replace(/\sг\.$/, ''); // strip trailing " г."

async function fetchReviews() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}?count=${REVIEWS_COUNT}`, {
      headers: ALTEGIO_HEADERS,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Altegio responded with HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(`Altegio error: ${JSON.stringify(result.meta || result)}`);
    }

    return result.data
      .filter((r) => r.text && r.text.trim().length > 0)
      .map((r) => ({
        name: r.user_name,
        text: r.text.trim(),
        date: formatDate(r.date),
        rating: r.rating,
      }));
  } finally {
    clearTimeout(timeout);
  }
}

// --- HTTP server ------------------------------------------------------------
const app = express();
app.use(cors());

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.get('/altegio-reviews', async (req, res) => {
  const now = Date.now();

  if (cachedReviews && now - lastFetchTime < CACHE_TTL_MS) {
    return res.json(cachedReviews);
  }

  try {
    cachedReviews = await fetchReviews();
    lastFetchTime = now;
    res.json(cachedReviews);
  } catch (error) {
    console.error('Failed to fetch reviews from Altegio:', error.message);
    // Serve stale data if we have any — better than failing the site.
    if (cachedReviews) {
      return res.json(cachedReviews);
    }
    res.status(502).json({ error: 'Failed to fetch reviews' });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
