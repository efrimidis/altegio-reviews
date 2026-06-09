// Builds the "free slots for today" message from Altegio booking data.

const config = require('./config');
const { fetchBookStaff, fetchBookTimes } = require('./altegio');

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const toMinutes = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const LATEST_MINUTES = toMinutes(config.latestSlotTime);

// Date helpers in the configured timezone.
function dateParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    apiDate: `${parts.year}-${parts.month}-${parts.day}`, // YYYY-MM-DD for the API
    display: `${parts.day}.${parts.month}`,               // DD.MM for the header
  };
}

// For one studio: return { name, masters: [{ name, times: [...] }] } with only
// masters that still have future slots today.
async function buildStudioBlock(studio, apiDate, nowMs) {
  const staff = await fetchBookStaff(studio.locationId);

  const masters = await Promise.all(
    staff.map(async (member) => {
      let slots;
      try {
        slots = await fetchBookTimes(studio.locationId, member.id, apiDate, config.serviceId);
      } catch (err) {
        console.error(`book_times failed (loc ${studio.locationId}, staff ${member.id}):`, err.message);
        return null;
      }
      // Keep only future slots no later than the cutoff, then the earliest
      // available time per hour.
      const seenHours = new Set();
      const times = slots
        .filter((s) => new Date(s.datetime).getTime() > nowMs)
        .filter((s) => toMinutes(s.time) <= LATEST_MINUTES)
        .filter((s) => {
          const hour = s.time.split(':')[0];
          if (seenHours.has(hour)) return false;
          seenHours.add(hour);
          return true;
        })
        .map((s) => s.time);
      return times.length ? { name: member.name, times } : null;
    }),
  );

  return { name: studio.name, masters: masters.filter(Boolean) };
}

// Returns the formatted message string, or null if there are no slots and
// config.skipIfEmpty is set.
async function buildSlotsMessage(now = new Date()) {
  const { apiDate, display } = dateParts(now);
  const nowMs = now.getTime();

  const blocks = await Promise.all(
    config.studios.map((studio) => buildStudioBlock(studio, apiDate, nowMs)),
  );

  const withSlots = blocks.filter((b) => b.masters.length > 0);
  if (withSlots.length === 0 && config.skipIfEmpty) {
    return null;
  }

  const lines = [config.header.replace('{date}', display)];

  for (const block of withSlots) {
    lines.push('', block.name);
    for (const master of block.masters) {
      lines.push('', master.times.join(', '), `Мастер - ${escapeHtml(master.name)}`);
    }
  }

  lines.push('', '', config.footer);
  return lines.join('\n');
}

module.exports = { buildSlotsMessage };
