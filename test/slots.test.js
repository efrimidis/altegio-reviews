const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../config');
const { selectSlotTimes, getDiscountPercent, dateParts } = require('../slots');

test('discount is 15% for four or fewer slots and 10% otherwise', () => {
  assert.equal(config.discount.scarceThreshold, 4);
  assert.equal(getDiscountPercent(0), 15);
  assert.equal(getDiscountPercent(4), 15);
  assert.equal(getDiscountPercent(5), 10);
});

test('slot selection keeps the earliest future time in each hour up to cutoff', () => {
  const nowMs = new Date('2026-08-14T05:15:00.000Z').getTime(); // 10:15 in Tashkent
  const slots = [
    { time: '11:45', datetime: '2026-08-14T06:45:00.000Z' },
    { time: '10:00', datetime: '2026-08-14T05:00:00.000Z' },
    { time: '20:45', datetime: '2026-08-14T15:45:00.000Z' },
    { time: '10:45', datetime: '2026-08-14T05:45:00.000Z' },
    { time: '20:30', datetime: '2026-08-14T15:30:00.000Z' },
    { time: '11:15', datetime: '2026-08-14T06:15:00.000Z' },
    { time: '10:30', datetime: '2026-08-14T05:30:00.000Z' },
  ];

  assert.deepEqual(selectSlotTimes(slots, nowMs), ['10:30', '11:15', '20:30']);
});

test('date formatting uses the configured Tashkent calendar day', () => {
  const value = dateParts(new Date('2026-08-13T20:30:00.000Z'));
  assert.deepEqual(value, { apiDate: '2026-08-14', display: '14.08' });
});
