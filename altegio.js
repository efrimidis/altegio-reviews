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
// When serviceId is given, slots are constrained to fit that service's duration.
async function fetchBookTimes(locationId, staffId, date, serviceId) {
  const query = serviceId ? `?service_ids%5B%5D=${serviceId}` : '';
  return apiGet(`/book_times/${locationId}/${staffId}/${date}${query}`, partnerAuth);
}

// --- Records (visits / payroll) --------------------------------------------
// All records for a company in a [startDate, endDate] window (YYYY-MM-DD).
// Needs the user token (private data). Each record carries staff, attendance
// and per-service pricing (cost / cost_per_unit / first_cost / discount).
async function fetchRecords(companyId, startDate, endDate) {
  return apiGet(
    `/records/${companyId}?start_date=${startDate}&end_date=${endDate}&count=300`,
    partnerUserAuth,
  );
}

module.exports = { fetchReviews, fetchBookStaff, fetchBookTimes, fetchRecords };
