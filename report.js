// Builds the daily "payroll per shift" report from Altegio records.
//
// For each studio we list every master who had attended visits today, with the
// number of sessions, the factual turnover (what clients actually paid) and the
// ФОТ to pay out. ФОТ = config.report.fotPercent% of the *undiscounted* program
// price (Altegio `cost_per_unit`), so any discount the visit was closed with
// does not lower what the master earns.

const config = require('./config');
const { fetchRecords } = require('./altegio');

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 700000 -> "700 000"
const fmtMoney = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// "сеанс" / "сеанса" / "сеансов" for the given count.
const pluralSessions = (n) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сеанс';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сеанса';
  return 'сеансов';
};

// Today's date in the configured timezone.
const longDateFmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: config.timezone,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
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
    display: longDateFmt.format(now),                     // "воскресенье, 14 июня"
  };
}

const ATTENDED = 1; // Altegio attendance: client actually came.

// For one studio: { name, masters: [{ name, sessions, revenue, fot, items }] }.
async function buildStudioReport(studio, apiDate) {
  let records;
  try {
    records = await fetchRecords(studio.locationId, apiDate, apiDate);
  } catch (err) {
    console.error(`records failed (loc ${studio.locationId}):`, err.message);
    return { name: studio.name, masters: [], failed: true };
  }

  const fotRate = config.report.fotPercent / 100;
  const byMaster = new Map();

  for (const rec of records) {
    if (rec.deleted || rec.attendance !== ATTENDED) continue;
    const staff = rec.staff || {};
    if (!byMaster.has(staff.id)) {
      byMaster.set(staff.id, { name: staff.name, sessions: 0, fot: 0, items: [] });
    }
    const master = byMaster.get(staff.id);
    master.sessions += 1;
    for (const s of rec.services || []) {
      const amount = s.amount || 1;
      // Undiscounted catalog price drives the payout, regardless of any discount.
      const base = (s.cost_per_unit || s.first_cost || 0) * amount;
      master.fot += base * fotRate;
      master.items.push({ title: s.title, base });
    }
  }

  return { name: studio.name, masters: [...byMaster.values()], failed: false };
}

// Returns the formatted report string. Always returns a message (even on an
// empty day) so the morning payout always has something to open.
async function buildReportMessage(now = new Date()) {
  const { apiDate, display } = dateParts(now);

  const studios = await Promise.all(
    config.studios.map((studio) => buildStudioReport(studio, apiDate)),
  );

  const lines = [config.report.header.replace('{date}', display)];
  let grandSessions = 0;
  let grandFot = 0;

  for (const studio of studios) {
    lines.push('', studio.name);
    if (studio.failed) {
      lines.push('⚠️ не удалось получить данные');
      continue;
    }
    if (studio.masters.length === 0) {
      lines.push(config.report.emptyStudioNote);
      continue;
    }

    let studioSessions = 0;
    let studioFot = 0;
    for (const m of studio.masters) {
      studioSessions += m.sessions;
      studioFot += m.fot;

      // Skip free add-ons (душ, «тишина», …): they carry no payout and add noise.
      // Each line shows the full (100%) price and the master's cut right after it.
      const fotRate = config.report.fotPercent / 100;
      const items = m.items
        .filter((it) => it.base > 0)
        .map(
          (it) =>
            `• ${escapeHtml(it.title)} — ${fmtMoney(it.base)} → ` +
            `мастеру ${fmtMoney(it.base * fotRate)}`,
        )
        .join('\n');
      // Lead with the one number that matters — what to hand the master — and
      // tuck the per-program breakdown into an expandable quote (tap to open).
      lines.push(
        '',
        `<b>${escapeHtml(m.name)}</b>`,
        `К выплате: <b>${fmtMoney(m.fot)} сум</b> · ${m.sessions} ${pluralSessions(m.sessions)}`,
      );
      if (items) lines.push(`<blockquote expandable>${items}</blockquote>`);
    }

    grandSessions += studioSessions;
    grandFot += studioFot;
    lines.push(
      '',
      `<i>Итого по студии: ${studioSessions} ${pluralSessions(studioSessions)}, ` +
        `к выплате ${fmtMoney(studioFot)} сум</i>`,
    );
  }

  lines.push(
    '',
    '',
    `<b>Всего за день:</b> ${grandSessions} ${pluralSessions(grandSessions)} · ` +
      `к выплате ${fmtMoney(grandFot)} сум`,
  );

  return lines.join('\n');
}

module.exports = { buildReportMessage };
