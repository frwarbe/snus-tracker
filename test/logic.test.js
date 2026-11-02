const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
function withEntries(times, settings = {}) {
  let s = { ...L.emptyState(), settings: { daily: null, weekly: null, monthly: null, ...settings } };
  for (const t of times) s = L.addEntry(s, t);
  return s;
}

test('weeks start on Monday', () => {
  // 2026-11-01 is a Sunday, 2026-11-02 a Monday.
  assert.equal(L.dayKey(L.startOfWeek(new Date(2026, 10, 1))), '2026-10-26');
  assert.equal(L.dayKey(L.startOfWeek(new Date(2026, 10, 2))), '2026-11-02');
  assert.equal(L.dayKey(L.startOfWeek(new Date(2026, 10, 8, 23))), '2026-11-02');
});

test('weekly and monthly limits are worked out from daily unless set', () => {
  const now = new Date(2026, 1, 10); // February 2026: 28 days
  assert.deepEqual(
    { ...L.limitsFor({ daily: 5, weekly: null, monthly: null }, now) },
    { daily: 5, weekly: 35, monthly: 140, weeklyAuto: true, monthlyAuto: true }
  );
  const custom = L.limitsFor({ daily: 5, weekly: 30, monthly: null }, now);
  assert.equal(custom.weekly, 30);
  assert.equal(custom.weeklyAuto, false);
  assert.equal(L.limitsFor({ daily: null, weekly: null, monthly: null }, now).weekly, null);
});

test('status levels', () => {
  assert.equal(L.status(3, null), 'none');
  assert.equal(L.status(3, 10), 'ok');
  assert.equal(L.status(8, 10), 'near');
  assert.equal(L.status(10, 10), 'at');
  assert.equal(L.status(11, 10), 'over');
  assert.equal(L.status(0, 0), 'at');
});

test('summary counts today, this week and this month', () => {
  const now = new Date(2026, 10, 4, 18); // Wednesday
  const s = withEntries(
    [at(2026, 10, 31), at(2026, 11, 2), at(2026, 11, 3), at(2026, 11, 4, 8), at(2026, 11, 4, 9)],
    { daily: 2 }
  );
  const sum = L.summary(s, now);
  assert.equal(sum.day.count, 2);
  assert.equal(sum.day.status, 'at');
  assert.equal(sum.week.count, 4);
  assert.equal(sum.week.limit, 14);
  assert.equal(sum.month.count, 4);
  assert.equal(sum.month.limit, 60);
});

test('feedback says when you went over', () => {
  const now = new Date(2026, 10, 4, 20);
  const s = withEntries([8, 9, 10, 11, 12].map((h) => at(2026, 11, 4, h)), { daily: 3 });
  const fb = L.feedback(s, now);
  assert.equal(fb[0].level, 'bad');
  assert.equal(fb[0].text, "You went over today's limit by 2 lip pillows.");
});

test('feedback warns near the limit', () => {
  const now = new Date(2026, 10, 4, 20);
  const s = withEntries([8, 9, 10, 11].map((h) => at(2026, 11, 4, h)), { daily: 5 });
  assert.ok(L.feedback(s, now).some((m) => m.text === '1 lip pillow left today.'));
});

test('streak counts days within the limit back from yesterday', () => {
  const now = new Date(2026, 10, 10, 9);
  const s = withEntries(
    [at(2026, 11, 6), at(2026, 11, 6, 13), at(2026, 11, 6, 14), at(2026, 11, 7), at(2026, 11, 8), at(2026, 11, 9)],
    { daily: 2 }
  );
  // Nov 6 is over (3), Nov 7-9 within -> 3.
  assert.equal(L.underStreak(s, now), 3);
  assert.ok(L.feedback(s, now).some((m) => m.text === 'Stayed within your daily limit 3 days in a row.'));
});

test('longest gap today, including the gap since the last lip pillow', () => {
  const s = withEntries([at(2026, 11, 4, 8), at(2026, 11, 4, 11, 10), at(2026, 11, 4, 12)]);
  const g1 = L.longestGapToday(s.entries, new Date(2026, 10, 4, 13));
  assert.equal(L.formatDuration(g1.ms), '3h 10m');
  assert.equal(g1.ongoing, false);
  const g2 = L.longestGapToday(s.entries, new Date(2026, 10, 4, 17));
  assert.equal(L.formatDuration(g2.ms), '5h 0m');
  assert.equal(g2.ongoing, true);
  assert.equal(L.longestGapToday(s.entries, new Date(2026, 10, 5, 9)), null);
});

test('time of day buckets', () => {
  assert.equal(L.bucketOf(at(2026, 11, 4, 4)), 'night');
  assert.equal(L.bucketOf(at(2026, 11, 4, 5)), 'morning');
  assert.equal(L.bucketOf(at(2026, 11, 4, 12)), 'afternoon');
  assert.equal(L.bucketOf(at(2026, 11, 4, 17)), 'evening');
  assert.equal(L.bucketOf(at(2026, 11, 4, 22)), 'night');
  const s = withEntries([at(2026, 11, 4, 7), at(2026, 11, 4, 8), at(2026, 11, 4, 23)]);
  assert.deepEqual(L.timeOfDay(s.entries, new Date(2026, 10, 4, 23, 30), 30), { morning: 2, afternoon: 0, evening: 0, night: 1 });
});

test('daily series is oldest first and includes empty days', () => {
  const s = withEntries([at(2026, 11, 2), at(2026, 11, 4), at(2026, 11, 4, 15)]);
  const series = L.dailySeries(s.entries, new Date(2026, 10, 4, 20), 3);
  assert.deepEqual(series.map((d) => [d.key, d.count]), [['2026-11-02', 1], ['2026-11-03', 0], ['2026-11-04', 2]]);
});

test('edit and delete entries', () => {
  let s = withEntries([at(2026, 11, 4, 8), at(2026, 11, 4, 9)]);
  const [first, second] = s.entries;
  s = L.updateEntryTime(s, first.id, at(2026, 11, 4, 10));
  assert.deepEqual(s.entries.map((e) => e.id), [second.id, first.id]);
  s = L.removeEntry(s, second.id);
  assert.equal(s.entries.length, 1);
});

test('normalize cleans imported data and rejects junk', () => {
  const s = L.normalize({ settings: { daily: '4', weekly: '', monthly: -1 }, entries: [300, { t: 100 }, { t: 'x' }] });
  assert.deepEqual(s.settings, { daily: 4, weekly: null, monthly: null });
  assert.deepEqual(s.entries.map((e) => e.t), [100, 300]);
  assert.throws(() => L.normalize({ foo: 1 }));
});

test('activity can be set, changed and cleared', () => {
  let s = withEntries([at(2026, 11, 4, 8)]);
  const id = s.entries[0].id;
  s = L.setEntryActivity(s, id, '  Drinking ');
  assert.equal(s.entries[0].activity, 'Drinking');
  s = L.updateEntryTime(s, id, at(2026, 11, 4, 9));
  assert.equal(s.entries[0].activity, 'Drinking');
  s = L.setEntryActivity(s, id, '');
  assert.equal('activity' in s.entries[0], false);
});

test('activity breakdown and import keep activities', () => {
  let s = withEntries([at(2026, 11, 4, 8), at(2026, 11, 4, 9), at(2026, 11, 4, 10)]);
  s = L.setEntryActivity(s, s.entries[0].id, 'Outside');
  s = L.setEntryActivity(s, s.entries[1].id, 'Outside');
  assert.deepEqual(L.activityBreakdown(s.entries, new Date(2026, 10, 4, 20), 30),
    [{ name: 'Outside', count: 2 }, { name: 'Not set', count: 1 }]);
  const back = L.normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(back.entries[0].activity, 'Outside');
  assert.equal(L.normalize({ entries: [{ t: 1, activity: 42 }] }).entries[0].activity, undefined);
});
