// Thin client for the Altegio API (reviews + online booking).

const PARTNER_TOKEN = process.env.ALTEGIO_BEARER_TOKEN;
const USER_TOKEN = process.env.ALTEGIO_USER_TOKEN;
const API_BASE = 'https://api.alteg.io/api/v1';
const REQUEST_TIMEOUT_MS = (Number(process.env.REQUEST_TIMEOUT_SECONDS) || 10) * 1000;

// Reviews need both partner + user tokens; the public booking endpoints need only
// the partner token (per Altegio docs).
const partnerAuth = `Bearer ${PARTNER_TOKEN}`;
const partnerUserAuth = `Bearer ${PARTNER_TOKEN}, User ${USER_TOKEN}`;

async function apiGet(path, auth) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: auth,
        Accept: 'application/vnd.api.v2+json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Altegio HTTP ${response.status} for ${path}`);
    }
    const result = await response.json();
    if (!result.success) {
      throw new Error(`Altegio error for ${path}: ${JSON.stringify(result.meta || result)}`);
    }
    return result.data;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Reviews ---------------------------------------------------------------
async function fetchReviews(companyId, count) {
  return apiGet(`/comments/${companyId}?count=${count}`, partnerUserAuth);
}

// --- Online booking --------------------------------------------------------
// Team members bookable at a location.
async function fetchBookStaff(locationId) {
  return apiGet(`/book_staff/${locationId}`, partnerAuth);
}

// Available booking time slots for a team member on a given date (YYYY-MM-DD).
async function fetchBookTimes(locationId, staffId, date) {
  return apiGet(`/book_times/${locationId}/${staffId}/${date}`, partnerAuth);
}

module.exports = { fetchReviews, fetchBookStaff, fetchBookTimes };
