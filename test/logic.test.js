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
  assert.ok(L.feedback(s, now).some((m) => m.text === 'Stayed within your daily limit 3 days in a row. Keep going!'));
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
  assert.deepEqual(s.settings, { ...L.DEFAULT_SETTINGS, daily: 4 });
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

test('full activity breakdown adds up to 100% with Other split into your own answers', () => {
  let s = withEntries([7, 8, 9, 13, 14, 15, 19, 20].map((h) => at(2026, 11, 4, h)));
  const ids = s.entries.map((e) => e.id);
  const tag = (i, a) => { s = L.setEntryActivity(s, ids[i], a); };
  tag(0, 'Studying/Working'); tag(1, 'Studying/Working'); tag(2, 'Studying/Working');
  tag(3, 'At the gym'); tag(4, 'at the gym'); tag(5, 'Painting');
  tag(6, 'Outside'); // ids[7] stays untagged
  const st = L.activityStats(s.entries, new Date(2026, 10, 4, 22), 30);
  assert.equal(st.total, 8);
  assert.equal(st.tagged, 7);
  assert.equal(st.untagged, 1);
  const by = Object.fromEntries(st.rows.map((r) => [r.name, r]));
  assert.equal(by['Studying/Working'].count, 3);
  assert.equal(by['Studying/Working'].mostly, 'morning');
  assert.equal(by.Other.count, 3);
  assert.equal(by.Other.mostly, 'afternoon');
  assert.deepEqual(by.Other.children.map((c) => [c.name, c.count]), [['At the gym', 2], ['Painting', 1]]);
  assert.equal(by.Other.pct, by.Other.children.reduce((a, c) => a + c.pct, 0));
  const total = st.rows.filter((r) => r.name !== 'Other').reduce((a, r) => a + r.pct, 0) + by.Other.pct;
  assert.equal(total, 100);
  assert.equal(by.Drinking.count, 0);
  assert.equal(by.Drinking.mostly, null);
  assert.equal(by.Outside.last, at(2026, 11, 4, 19));
});

test('shares always add up to 100', () => {
  assert.deepEqual(L.sharesOf([1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(L.sharesOf([0, 0]), [0, 0]);
  assert.equal(L.sharesOf([3, 7, 11, 13, 2]).reduce((a, n) => a + n, 0), 100);
});

test('typed answers that match a standard option count as that option', () => {
  let s = withEntries([at(2026, 11, 4, 8), at(2026, 11, 4, 9)]);
  s = L.setEntryActivity(s, s.entries[0].id, 'gaming');
  s = L.setEntryActivity(s, s.entries[1].id, 'Chilling');
  const st = L.activityStats(s.entries, new Date(2026, 10, 4, 20), 30);
  const by = Object.fromEntries(st.rows.map((r) => [r.name, r]));
  assert.equal(by.Gaming.count, 1);
  assert.equal(by.Chilling.count, 1);
  assert.equal(by.Other.count, 0);
  assert.ok(L.ACTIVITIES.includes('With coffee'));
});

test('undo target is the entry logged most recently, not the latest time', () => {
  let s = L.emptyState();
  s = L.addEntry(s, at(2026, 11, 4, 14), { c: at(2026, 11, 4, 14) });
  s = L.addEntry(s, at(2026, 11, 4, 10), { c: at(2026, 11, 4, 15) }); // forgot one, added later
  assert.equal(L.lastAdded(s.entries).t, at(2026, 11, 4, 10));
  // Old entries without a "logged at" time fall back to their own time.
  assert.equal(L.lastAdded([{ id: 'a', t: 5 }, { id: 'b', t: 9 }]).id, 'b');
  assert.equal(L.lastAdded([]), null);
});

test('day can start at 4am so late nights count towards the day before', () => {
  try {
    L.setDayStart(4);
    const s = withEntries([at(2026, 11, 4, 22), at(2026, 11, 5, 1, 30), at(2026, 11, 5, 9)], { daily: 5 });
    // At 2am on the 5th, it's still "the 4th".
    const twoAm = new Date(2026, 10, 5, 2);
    assert.equal(L.dayKey(L.startOfDay(twoAm)), '2026-11-04');
    assert.equal(L.summary(s, twoAm).day.count, 2);
    assert.equal(L.summary(s, new Date(2026, 10, 5, 12)).day.count, 1);
    // Picking 01:30 inside "the 4th" means the early hours of the 5th.
    assert.equal(+L.timeInDay(L.startOfDay(twoAm), 1, 30), at(2026, 11, 5, 1, 30));
    assert.equal(+L.timeInDay(L.startOfDay(twoAm), 23, 0), at(2026, 11, 4, 23));
    // Month boundary: 1am on Dec 1st still belongs to November.
    assert.equal(L.daysInMonth(new Date(2026, 11, 1, 1)), 30);
    assert.equal(L.dayKey(L.periods(new Date(2026, 11, 1, 1)).month.from), '2026-11-01');
  } finally {
    L.setDayStart(0);
  }
});

test('money and nicotine', () => {
  let s = withEntries([8, 10, 12].map((h) => at(2026, 11, 4, h)), { tinPrice: 5, perTin: 20, mg: 6 });
  const u = L.usage(s, new Date(2026, 10, 4, 20));
  assert.equal(u.today.count, 3);
  assert.equal(u.today.mg, 18);
  assert.equal(u.today.cost, 0.75);
  assert.equal(u.avg.days, 1);
  assert.equal(Math.round(u.yearlyCost * 100) / 100, 273.75);
  assert.equal(u.tinsMonth, 0.15);
  // Nothing configured: no money or nicotine numbers.
  const bare = L.usage(withEntries([at(2026, 11, 4, 8)]), new Date(2026, 10, 4, 20));
  assert.equal(bare.today.cost, null);
  assert.equal(bare.today.mg, null);
  // 20 per tin is assumed when not set.
  assert.equal(L.costPerPillow({ tinPrice: 4 }), 0.2);
});

test('changing strength keeps the old strength on earlier lip pillows', () => {
  let s = withEntries([at(2026, 11, 4, 8)], { mg: 6 });
  s = L.setStrength(s, 4);
  s = L.addEntry(s, at(2026, 11, 4, 9), { mg: s.settings.mg });
  assert.deepEqual(s.entries.map((e) => e.mg), [6, 4]);
  assert.equal(L.usage(s, new Date(2026, 10, 4, 20)).today.mg, 10);
});

test('money formatting', () => {
  assert.equal(L.formatMoney(12.5, '£'), '£12.50');
  assert.equal(L.formatMoney(12.5, 'kr'), '12.50 kr');
  assert.equal(L.formatMoney(3, ''), '3.00');
});

test('backup reminder after 7 days', () => {
  const s = withEntries([1, 2, 3, 4, 5].map((d) => at(2026, 11, d, 12)));
  assert.equal(L.backupStatus(s, new Date(2026, 10, 6)).due, false);
  assert.equal(L.backupStatus(s, new Date(2026, 10, 9)).due, true);
  const backed = { ...s, settings: { ...s.settings, lastBackup: at(2026, 11, 8, 12) } };
  assert.equal(L.backupStatus(backed, new Date(2026, 10, 10)).due, false);
  assert.equal(L.backupStatus(withEntries([at(2026, 11, 1)]), new Date(2026, 11, 30)).due, false);
});

test('imported backups keep the new settings and per-entry details', () => {
  const s = L.normalize({ settings: { mg: '6', tinPrice: '4,50', perTin: 0, currency: ' kr ', dayStart: 9, lastBackup: 123 },
    entries: [{ t: 10, c: 20, mg: 4 }] });
  assert.equal(s.settings.mg, 6);
  assert.equal(s.settings.tinPrice, 4.5);
  assert.equal(s.settings.perTin, null);
  assert.equal(s.settings.currency, 'kr');
  assert.equal(s.settings.dayStart, 0);
  assert.equal(s.settings.lastBackup, 123);
  assert.deepEqual([s.entries[0].c, s.entries[0].mg], [20, 4]);
});
