// Configuration for the daily "free slots" Telegram post.
// Headers/links below support Telegram HTML. Placeholders:
//   {date}     -> DD.MM of the targeted day
//   {discount} -> active discount percent (see `discount` below)
// Dynamic parts (studios → masters → times, prices) are generated automatically.

module.exports = {
  timezone: 'Asia/Tashkent',

  // When to publish (cron in the timezone above). Each schedule targets a day
  // ('today' | 'tomorrow') and has its own header.
  // `headerScarce` (optional) is used instead of `header` when the deeper
  // discount kicks in (few windows left). The "скидка …%" part is bold.
  postSchedules: [
    {
      cron: '0 20 * * *', // evening: announce tomorrow's windows
      day: 'tomorrow',
      header: '🌚 🔥 Горящие окна на завтра со <b>скидкой {discount}%</b>\nна сеансы от 60 минут | {date}',
      headerScarce: '🌚 🔥 Последние горящие окна на завтра - <b>скидка {discount}%</b>\nна сеансы от 60 минут | {date}',
    },
    {
      cron: '0 15 * * *', // afternoon: remaining windows for tonight
      day: 'today',
      header: '🔥 На сегодня еще остались горящие окошки со <b>скидкой {discount}%</b> | {date}',
      headerScarce: '🔥 Последние горящие окна на сегодня - <b>скидка {discount}%</b> | {date}',
    },
  ],

  // Discount scales with scarcity: when the post has `scarceThreshold` windows
  // or fewer (counted across the whole post), bump to the deeper discount.
  discount: {
    normal: 15,
    scarce: 20,
    scarceThreshold: 4,
  },

  // Studios to include, in display order. locationId = Altegio location/company id.
  studios: [
    { name: '📍 Студия на Урде', locationId: '1342553' },
    { name: '📍 Студия на Шота Руставели', locationId: '764321' },
  ],

  // Slots are computed for this Altegio service so that only "full" windows
  // where a 60-min session fits before the next booking are shown. 30/45-min
  // sessions are sold manually by admins. 13281421 = "Расслабляющий массаж
  // всего тела (60 минут)" (same id in both studios).
  serviceId: 13281421,

  // Extra guard on the latest start time (HH:MM). With the 60-min service the
  // API already won't offer starts past 20:00, so this rarely bites.
  latestSlotTime: '20:30',

  // If true and no studio has any free slots, the post is skipped entirely.
  skipIfEmpty: true,

  // ----- Daily payroll report (private group) -------------------------------
  // Sent every evening to a private Telegram group (REPORT_BOT_TOKEN /
  // REPORT_CHAT_ID) so each master can be paid out next morning without manual
  // Altegio counting. Counts only attended visits (Altegio attendance === 1).
  // ФОТ = `fotPercent`% of the undiscounted program price (Altegio
  // `cost_per_unit` × amount) — independent of any discount the visit was
  // actually closed with. `{date}` -> DD.MM of the reported day.
  report: {
    cron: '0 22 * * *', // 22:00 in `timezone`, reports the day that just ended
    fotPercent: 30,
    header: '💰 <b>Отчёт по сменам за {date}</b>',
    emptyStudioNote: '— нет состоявшихся записей',
  },

  // ----- Price list (base prices; discount applied at render) ---------------
  // `null` entries render as a blank separator line. Shown in an expandable
  // Telegram quote so prices don't dominate the post.
  priceList: [
    { name: 'Расслабляющий 60 минут', base: 700000 },
    { name: 'Расслабляющий 90 минут', base: 800000 },
    null,
    { name: 'Спортивный 60 минут', base: 850000 },
    { name: 'Спортивный 90 минут', base: 950000 },
    null,
    { name: 'Лимфодренажный 60 минут', base: 750000 },
    { name: 'Лимфодренажный 90 минут', base: 850000 },
    null,
    { name: 'Восстанавливающий 90 минут', base: 850000 },
    null,
    { name: 'Медовый 60 минут', base: 700000 },
  ],

  // ----- Static footer links ------------------------------------------------
  footerLinks: [
    'Запись <a href="https://b813591.alteg.io/company/1342553/personal/menu?o=m-1">онлайн 🔗</a> или через Telegram:',
    '',
    '<a href="https://t.me/telo_urda">TELO Урда</a> 🐚',
    '',
    '<a href="https://t.me/telo_studio">TELO Шота Руставели</a> 🪷',
  ].join('\n'),
};
