// Thin client for the Altegio API (reviews + online booking).

const PARTNER_TOKEN = process.env.ALTEGIO_BEARER_TOKEN;
const USER_TOKEN = process.env.ALTEGIO_USER_TOKEN;
const API_BASE = 'https://api.alteg.io/api/v1';

function numericEnv(name, fallback, { min = 0, integer = false } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be a number${integer ? ' without a fractional part' : ''} >= ${min}`);
  }
  return value;
}

const REQUEST_TIMEOUT_MS = numericEnv('REQUEST_TIMEOUT_SECONDS', 10, { min: 0.001 }) * 1000;
const MAX_RETRIES = numericEnv('ALTEGIO_MAX_RETRIES', 2, { min: 0, integer: true });
const MIN_REQUEST_INTERVAL_MS = numericEnv('ALTEGIO_MIN_INTERVAL_MS', 210, { min: 0 });
const RECORDS_PAGE_SIZE = 100;
const MAX_RECORD_PAGES = 100;

// Reviews need both partner + user tokens; the public booking endpoints need only
// the partner token (per Altegio docs).
const partnerAuth = `Bearer ${PARTNER_TOKEN}`;
const partnerUserAuth = `Bearer ${PARTNER_TOKEN}, User ${USER_TOKEN}`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Altegio documents a five-requests-per-second limit. Calls may still execute
// concurrently, but their start times are spaced out across the whole process.
let requestGate = Promise.resolve();
let nextRequestAt = 0;
async function waitForRequestSlot() {
  const gate = requestGate.then(async () => {
    const delay = Math.max(0, nextRequestAt - Date.now());
    if (delay) await wait(delay);
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  });
  requestGate = gate.catch(() => {});
  await gate;
}

async function fetchAttempt(path, auth) {
  await waitForRequestSlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: auth,
        Accept: 'application/vnd.api.v2+json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function retryDelay(response, attempt) {
  const retryAfterSeconds = Number(response && response.headers.get('retry-after'));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return 500 * (2 ** attempt);
}

async function apiGetResult(path, auth) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetchAttempt(path, auth);
    } catch (err) {
      lastError = err.name === 'AbortError'
        ? new Error(`Altegio request timed out for ${path}`)
        : err;
      if (attempt === MAX_RETRIES) throw lastError;
      await wait(retryDelay(null, attempt));
      continue;
    }

    let result;
    try {
      result = await response.json();
    } catch {
      lastError = new Error(`Altegio returned invalid JSON (HTTP ${response.status}) for ${path}`);
      if (attempt < MAX_RETRIES && (response.status === 429 || response.status >= 500)) {
        await wait(retryDelay(response, attempt));
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      lastError = new Error(`Altegio HTTP ${response.status} for ${path}`);
      if (attempt < MAX_RETRIES && (response.status === 429 || response.status >= 500)) {
        await wait(retryDelay(response, attempt));
        continue;
      }
      throw lastError;
    }
    if (!result.success) {
      throw new Error(`Altegio error for ${path}: ${JSON.stringify(result.meta || result)}`);
    }
    return result;
  }
  throw lastError;
}

async function apiGet(path, auth) {
  const result = await apiGetResult(path, auth);
  return result.data;
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
  const records = [];
  for (let page = 1; page <= MAX_RECORD_PAGES; page += 1) {
    const query = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      count: String(RECORDS_PAGE_SIZE),
      page: String(page),
    });
    const result = await apiGetResult(`/records/${companyId}?${query}`, partnerUserAuth);
    const pageRecords = Array.isArray(result.data) ? result.data : [];
    records.push(...pageRecords);

    const totalCount = Number(result.meta && result.meta.total_count);
    if (Number.isFinite(totalCount) && records.length >= totalCount) return records;
    if (pageRecords.length < RECORDS_PAGE_SIZE) return records;
  }
  throw new Error(`Altegio records pagination exceeded ${MAX_RECORD_PAGES} pages`);
}

module.exports = { fetchReviews, fetchBookStaff, fetchBookTimes, fetchRecords };
