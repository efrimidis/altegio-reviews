const test = require('node:test');
const assert = require('node:assert/strict');

const { summarizeRecords, pluralSessions, togglePayButton } = require('../report');

test('payroll counts attended records and pays 30% of undiscounted services', () => {
  const records = [
    {
      attendance: 1,
      staff: { id: 7, name: 'Алия' },
      services: [{ title: 'Массаж', cost_per_unit: 700000, amount: 1 }],
    },
    {
      attendance: 1,
      staff: { id: 7, name: 'Алия' },
      services: [{ title: 'Массаж × 2', cost_per_unit: 800000, amount: 2 }],
    },
    {
      attendance: 0,
      staff: { id: 7, name: 'Алия' },
      services: [{ title: 'Не состоялся', cost_per_unit: 900000, amount: 1 }],
    },
    {
      attendance: 1,
      deleted: true,
      staff: { id: 8, name: 'Удалённая запись' },
      services: [{ title: 'Удалено', cost_per_unit: 900000, amount: 1 }],
    },
  ];

  assert.deepEqual(summarizeRecords(records), [
    {
      name: 'Алия',
      sessions: 2,
      fot: 690000,
      items: [
        { title: 'Массаж', base: 700000 },
        { title: 'Массаж × 2', base: 1600000 },
      ],
    },
  ]);
});

test('zero catalog price remains free and missing price falls back to first_cost', () => {
  const masters = summarizeRecords([
    {
      attendance: 1,
      staff: { id: 1, name: 'Мастер' },
      services: [
        { title: 'Бесплатное дополнение', cost_per_unit: 0, first_cost: 100000 },
        { title: 'Старая цена', first_cost: 500000 },
      ],
    },
  ]);

  assert.equal(masters[0].fot, 150000);
  assert.deepEqual(masters[0].items.map((item) => item.base), [0, 500000]);
});

test('Russian session plurals are formatted correctly', () => {
  assert.equal(pluralSessions(1), 'сеанс');
  assert.equal(pluralSessions(2), 'сеанса');
  assert.equal(pluralSessions(11), 'сеансов');
  assert.equal(pluralSessions(24), 'сеанса');
});

test('payment button toggles without changing its label', () => {
  const button = { text: '⬜ Алия · 210 000' };
  assert.equal(togglePayButton(button), true);
  assert.equal(button.text, '✅ Алия · 210 000');
  assert.equal(togglePayButton(button), false);
  assert.equal(button.text, '⬜ Алия · 210 000');
});
