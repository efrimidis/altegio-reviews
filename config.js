// Configuration for the daily "free slots" Telegram post.
// Edit the text in `header` / `footer` freely — {date} is replaced with DD.MM.
// Dynamic parts (studios → masters → times) are pulled from Altegio automatically.

module.exports = {
  timezone: 'Asia/Tashkent',

  // Cron expressions (in the timezone above) for when to publish.
  postSchedules: ['0 9 * * *', '0 15 * * *'],

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

  // ----- Author-editable text (supports Telegram HTML) ----------------------
  // {date} -> today's date as DD.MM
  header: '🔥 На сегодня еще остались горящие окошки со скидкой 15% | {date}',

  footer: [
    'Расслабляющий массаж всего тела (60 минут) - <s>700 000</s> 595 000',
    '',
    'Запись онлайн <a href="https://b813591.alteg.io/company/1342553/personal/menu?o=m-1">🔗</a> или через Telegram:',
    '',
    '<a href="https://t.me/telo_urda">TELO Урда</a> 🐚',
    '',
    '<a href="https://t.me/telo_studio">TELO Шота Руставели</a> 🪷',
  ].join('\n'),
};
