// Pure tracking logic: no DOM, no storage. Used by app.js and by the tests.
(function (root) {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ---- Dates (all in the device's local time) ----
  // A "day" can start later than midnight (e.g. 4am), so a late night counts towards the day before.
  let DAY_START_H = 0;
  function setDayStart(h) {
    const n = Math.floor(Number(h));
    DAY_START_H = Number.isFinite(n) && n >= 0 && n <= 6 ? n : 0;
  }
  function getDayStart() {
    return DAY_START_H;
  }
  function startOfDay(d) {
    const x = new Date(+new Date(d) - DAY_START_H * 3600000);
    x.setHours(DAY_START_H, 0, 0, 0);
    return x;
  }
  // A clock time (h:m) inside the day that starts at `dayStart` (times before the day's start
  // hour belong to the early hours of the next calendar date).
  function timeInDay(dayStart, h, m) {
    const x = new Date(dayStart);
    x.setHours(h, m, 0, 0);
    return x < dayStart ? addDays(x, 1) : x;
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  // Weeks start on Monday.
  function startOfWeek(d) {
    const x = startOfDay(d);
    return addDays(x, -((x.getDay() + 6) % 7));
  }
  function startOfMonth(d) {
    const x = startOfDay(d);
    x.setDate(1);
    return x;
  }
  function daysInMonth(d) {
    const x = startOfDay(d);
    return new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  }
  function dayKey(d) {
    const x = new Date(d);
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${x.getFullYear()}-${m}-${day}`;
  }

  // ---- State ----
  const DEFAULT_SETTINGS = {
    daily: null, weekly: null, monthly: null,
    dayStart: 0,          // hour the day starts (0-6)
    mg: null,             // nicotine per lip pillow, mg
    tinPrice: null,       // price of one tin
    perTin: null,         // lip pillows per tin (20 when not set)
    currency: '',         // shown with money, e.g. "kr", "£"
    lastBackup: null,     // when you last exported
  };
  function emptyState() {
    return { settings: { ...DEFAULT_SETTINGS }, entries: [] };
  }

  // A positive (or zero) number, optionally with decimals and a maximum; otherwise null.
  function toNum(v, max = Infinity) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  }
  function cleanSettings(s) {
    s = s || {};
    const perTin = toLimit(s.perTin);
    return {
      daily: toLimit(s.daily),
      weekly: toLimit(s.weekly),
      monthly: toLimit(s.monthly),
      dayStart: (() => { const n = Math.floor(Number(s.dayStart)); return n >= 0 && n <= 6 ? n : 0; })(),
      mg: toNum(s.mg, 200),
      tinPrice: toNum(s.tinPrice, 100000),
      perTin: perTin && perTin >= 1 ? perTin : null,
      currency: typeof s.currency === 'string' ? s.currency.trim().slice(0, 5) : '',
      lastBackup: Number.isFinite(Number(s.lastBackup)) && s.lastBackup !== null && s.lastBackup !== '' ? Number(s.lastBackup) : null,
    };
  }

  function toLimit(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  // Accepts anything (e.g. an imported file) and returns a clean state, or throws.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) {
      throw new Error('Not a SNUSwatch backup');
    }
    const s = raw.settings || {};
    const entries = raw.entries
      .map((e) => (typeof e === 'number' ? { id: newId(e), t: e } : e))
      .filter((e) => e && Number.isFinite(Number(e.t)))
      .map((e) => {
        const out = { id: String(e.id || newId(e.t)), t: Number(e.t) };
        const a = cleanActivity(e.activity);
        if (a) out.activity = a;
        if (Number.isFinite(Number(e.c)) && e.c !== null) out.c = Number(e.c);
        const mg = toNum(e.mg, 200);
        if (mg) out.mg = mg;
        return out;
      })
      .sort((a, b) => a.t - b.t);
    return { settings: cleanSettings(s), entries };
  }

  let idCounter = 0;
  function newId(t) {
    idCounter += 1;
    return `${Number(t).toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // `opts.c`: when it was logged (for Undo); `opts.mg`: strength at the time.
  function addEntry(state, t, opts = {}) {
    const e = { id: newId(t), t: Number(t), c: Number.isFinite(opts.c) ? opts.c : Number(t) };
    if (opts.mg) e.mg = opts.mg;
    const entries = state.entries.concat(e).sort((a, b) => a.t - b.t);
    return { ...state, entries };
  }
  // The entry you logged most recently (not necessarily the latest time).
  function lastAdded(entries) {
    let best = null;
    for (const e of entries) {
      const k = e.c ?? e.t;
      if (!best || k > (best.c ?? best.t) || (k === (best.c ?? best.t) && e.t > best.t)) best = e;
    }
    return best;
  }
  // Change the strength setting. Lip pillows logged before keep the old strength.
  function setStrength(state, mg) {
    const old = state.settings.mg;
    const entries = old ? state.entries.map((e) => (e.mg ? e : { ...e, mg: old })) : state.entries;
    return { ...state, entries, settings: { ...state.settings, mg: toNum(mg, 200) } };
  }
  // ---- Activities (optional "what were you doing?") ----
  const ACTIVITIES = [
    'Studying/Working', 'Chilling', 'Outside', 'Gaming', 'With friends', 'Gym/Sport', 'Drinking',
    'After a meal', 'With coffee', 'Bored', 'Stressed', 'Misc.',
  ];
  function cleanActivity(v) {
    if (typeof v !== 'string') return null;
    const x = v.trim().replace(/\s+/g, ' ').slice(0, 60);
    return x || null;
  }
  function setEntryActivity(state, id, activity) {
    const a = cleanActivity(activity);
    const entries = state.entries.map((e) => {
      if (e.id !== id) return e;
      const { activity: _old, ...rest } = e;
      return a ? { ...rest, activity: a } : rest;
    });
    return { ...state, entries };
  }
  // Counts per activity over the last `days` days, biggest first. Untagged ones are "Not set".
  function activityBreakdown(entries, now, days) {
    const from = addDays(startOfDay(now), -(days - 1));
    const counts = new Map();
    for (const e of entriesBetween(entries, from, addDays(startOfDay(now), 1))) {
      const k = e.activity || 'Not set';
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }

  // Rounds shares to whole percentages that add up to exactly 100 (largest remainder).
  function sharesOf(counts) {
    const total = counts.reduce((a, n) => a + n, 0);
    if (!total) return counts.map(() => 0);
    const raw = counts.map((n) => (n / total) * 100);
    const out = raw.map(Math.floor);
    let left = 100 - out.reduce((a, n) => a + n, 0);
    raw.map((r, i) => [r - Math.floor(r), i]).sort((x, y) => y[0] - x[0] || x[1] - y[1])
      .forEach(([, i]) => { if (left > 0) { out[i] += 1; left -= 1; } });
    return out;
  }

  // Full breakdown of what you were doing over the last `days` days. Every tagged lip pillow is
  // counted once: the standard answers, plus "Other" which holds your own answers as children.
  // Percentages are of all tagged lip pillows and add up to 100; children add up to Other's share.
  // Spelling/case differences in your own answers ("gym" vs "Gym") count as the same answer.
  function activityStats(entries, now, days) {
    const from = addDays(startOfDay(now), -(days - 1));
    const list = entriesBetween(entries, from, addDays(startOfDay(now), 1));
    const make = (name) => ({ name, count: 0, last: null, buckets: { morning: 0, afternoon: 0, evening: 0, night: 0 } });
    const std = new Map(ACTIVITIES.map((n) => [n, make(n)]));
    const custom = new Map();
    let untagged = 0;
    for (const e of list) {
      let g;
      if (!e.activity) { untagged += 1; continue; }
      // A typed answer that matches a standard one (e.g. "gaming") counts as that one.
      const stdName = ACTIVITIES.find((n) => n.toLowerCase() === e.activity.toLowerCase());
      if (stdName) g = std.get(stdName);
      else {
        const key = e.activity.toLowerCase();
        if (!custom.has(key)) custom.set(key, make(e.activity));
        g = custom.get(key);
      }
      g.count += 1;
      g.buckets[bucketOf(e.t)] += 1;
      if (g.last == null || e.t > g.last) g.last = e.t;
    }
    const children = [...custom.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const leaves = [...std.values(), ...children];
    const pcts = sharesOf(leaves.map((g) => g.count));
    leaves.forEach((g, i) => { g.pct = pcts[i]; });
    const finish = (g) => {
      const best = BUCKETS.reduce((a, b) => (g.buckets[b] > g.buckets[a] ? b : a), BUCKETS[0]);
      return { name: g.name, count: g.count, pct: g.pct, last: g.last, mostly: g.count ? best : null };
    };
    const other = make('Other');
    for (const c of children) {
      other.count += c.count;
      for (const b of BUCKETS) other.buckets[b] += c.buckets[b];
      if (c.last != null && (other.last == null || c.last > other.last)) other.last = c.last;
    }
    other.pct = children.reduce((a, c) => a + c.pct, 0);
    const rows = [...[...std.values()].map(finish), { ...finish(other), children: children.map(finish) }]
      .sort((a, b) => b.count - a.count);
    const tagged = list.length - untagged;
    return { total: list.length, tagged, untagged, rows };
  }

  function removeEntry(state, id) {
    return { ...state, entries: state.entries.filter((e) => e.id !== id) };
  }
  function updateEntryTime(state, id, t) {
    const entries = state.entries
      .map((e) => (e.id === id ? { ...e, t: Number(t) } : e))
      .sort((a, b) => a.t - b.t);
    return { ...state, entries };
  }

  // ---- Limits ----
  // Weekly and monthly limits default to daily x 7 and daily x days in that month.
  function limitsFor(settings, now) {
    const daily = settings.daily;
    return {
      daily,
      weekly: settings.weekly ?? (daily != null ? daily * 7 : null),
      monthly: settings.monthly ?? (daily != null ? daily * daysInMonth(now) : null),
      weeklyAuto: settings.weekly == null,
      monthlyAuto: settings.monthly == null,
    };
  }

  // ---- Counting ----
  function countBetween(entries, from, to) {
    const a = +from;
    const b = +to;
    let n = 0;
    for (const e of entries) if (e.t >= a && e.t < b) n += 1;
    return n;
  }
  function entriesBetween(entries, from, to) {
    return entries.filter((e) => e.t >= +from && e.t < +to);
  }

  function periods(now) {
    const day = startOfDay(now);
    const week = startOfWeek(now);
    const month = startOfMonth(now);
    return {
      day: { from: day, to: addDays(day, 1) },
      week: { from: week, to: addDays(week, 7) },
      month: { from: month, to: (() => { const x = new Date(month); x.setMonth(x.getMonth() + 1); return x; })() },
    };
  }

  // 'none' (no limit), 'ok', 'near' (80%+), 'at', 'over'
  function status(count, limit) {
    if (limit == null) return 'none';
    if (count > limit) return 'over';
    if (count === limit) return 'at';
    if (limit > 0 && count >= 0.8 * limit) return 'near';
    return 'ok';
  }

  function summary(state, now) {
    const p = periods(now);
    const lim = limitsFor(state.settings, now);
    const make = (key, limKey) => {
      const count = countBetween(state.entries, p[key].from, p[key].to);
      const limit = lim[limKey];
      return {
        count,
        limit,
        left: limit == null ? null : Math.max(0, limit - count),
        over: limit == null ? 0 : Math.max(0, count - limit),
        status: status(count, limit),
      };
    };
    return { day: make('day', 'daily'), week: make('week', 'weekly'), month: make('month', 'monthly'), limits: lim };
  }

  // Counts per day for the last `days` days, oldest first, ending today.
  function dailySeries(entries, now, days) {
    const today = startOfDay(now);
    const out = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const from = addDays(today, -i);
      out.push({ date: from, key: dayKey(from), count: countBetween(entries, from, addDays(from, 1)) });
    }
    return out;
  }

  // Days in a row at or under the daily limit, counting back from yesterday.
  // Only counts days on or after the first logged lip pillow.
  function underStreak(state, now) {
    const daily = state.settings.daily;
    if (daily == null || state.entries.length === 0) return 0;
    const first = startOfDay(state.entries[0].t);
    let d = addDays(startOfDay(now), -1);
    let n = 0;
    while (d >= first) {
      if (countBetween(state.entries, d, addDays(d, 1)) > daily) break;
      n += 1;
      d = addDays(d, -1);
    }
    return n;
  }

  // ---- Time ----
  function lastEntry(entries, now) {
    for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i].t <= +now) return entries[i];
    return null;
  }

  // Longest gap between lip pillows today. The gap from the last lip pillow until now
  // counts too ("so far"). Needs at least one lip pillow today.
  function longestGapToday(entries, now) {
    const p = periods(now).day;
    const today = entriesBetween(entries, p.from, Math.min(+p.to, +now + 1));
    if (today.length === 0) return null;
    let best = 0;
    let ongoing = false;
    for (let i = 1; i < today.length; i += 1) best = Math.max(best, today[i].t - today[i - 1].t);
    const sinceLast = +now - today[today.length - 1].t;
    if (sinceLast > best) {
      best = sinceLast;
      ongoing = true;
    }
    return best > 0 ? { ms: best, ongoing } : null;
  }

  // Morning 05-12, afternoon 12-17, evening 17-22, night 22-05.
  const BUCKETS = ['morning', 'afternoon', 'evening', 'night'];
  function bucketOf(t) {
    const h = new Date(t).getHours();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 22) return 'evening';
    return 'night';
  }
  function timeOfDay(entries, now, days) {
    const from = addDays(startOfDay(now), -(days - 1));
    const counts = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    for (const e of entriesBetween(entries, from, addDays(startOfDay(now), 1))) counts[bucketOf(e.t)] += 1;
    return counts;
  }

  function formatDuration(ms) {
    const mins = Math.max(0, Math.floor(ms / 60000));
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  // ---- Money and nicotine ----
  function costPerPillow(settings) {
    if (settings.tinPrice == null) return null;
    return settings.tinPrice / (settings.perTin || 20);
  }
  function usage(state, now) {
    const st = state.settings;
    const per = costPerPillow(st);
    const mgOf = (e) => e.mg || st.mg || 0;
    const anyMg = !!st.mg || state.entries.some((e) => e.mg);
    const agg = (list) => ({
      count: list.length,
      mg: anyMg ? list.reduce((a, e) => a + mgOf(e), 0) : null,
      cost: per == null ? null : list.length * per,
    });
    const p = periods(now);
    const today = agg(entriesBetween(state.entries, p.day.from, p.day.to));
    const week = agg(entriesBetween(state.entries, p.week.from, p.week.to));
    const month = agg(entriesBetween(state.entries, p.month.from, p.month.to));
    // Daily average over the last 30 days (or since you started, if sooner).
    const end = addDays(startOfDay(now), 1);
    let from = addDays(startOfDay(now), -29);
    if (state.entries.length && startOfDay(state.entries[0].t) > from) from = startOfDay(state.entries[0].t);
    const days = Math.max(1, Math.round((end - from) / DAY_MS));
    const recent = agg(entriesBetween(state.entries, from, end));
    const avg = {
      days,
      count: recent.count / days,
      mg: recent.mg == null ? null : recent.mg / days,
      cost: recent.cost == null ? null : recent.cost / days,
    };
    return {
      today, week, month, avg,
      yearlyCost: avg.cost == null ? null : avg.cost * 365,
      tinsMonth: month.count / (st.perTin || 20),
      total: agg(state.entries),
      costPer: per,
    };
  }
  function formatMoney(n, currency) {
    const v = (Math.round(n * 100) / 100).toFixed(2);
    const c = (currency || '').trim();
    if (!c) return v;
    return /^[A-Za-z]{2,}$/.test(c) ? `${v} ${c}` : `${c}${v}`;
  }

  // ---- Backup reminder ----
  // Due once you have a few entries and haven't exported for 7+ days.
  function backupStatus(state, now) {
    const last = state.settings.lastBackup;
    if (state.entries.length < 5) return { due: false, last, days: null };
    const ref = last ?? state.entries[0].t;
    const days = Math.floor((+now - ref) / DAY_MS);
    return { due: days >= 7, last, days };
  }

  // ---- Feedback ----
  const PERIOD_WORD = { day: 'today', week: 'this week', month: 'this month' };
  const LIMIT_WORD = { day: "today's", week: "this week's", month: "this month's" };

  function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : word.endsWith('h') ? 'es' : 's'}`;
  }

  // Returns [{level: 'bad'|'warn'|'good'|'info', text}], most important first.
  function feedback(state, now) {
    const s = summary(state, now);
    const out = [];
    for (const key of ['day', 'week', 'month']) {
      const x = s[key];
      if (x.status === 'over') {
        out.push({ level: 'bad', text: `You went over ${LIMIT_WORD[key]} limit by ${plural(x.over, 'lip pillow')}.` });
      } else if (x.status === 'at') {
        out.push({ level: 'warn', text: `That's your limit for ${PERIOD_WORD[key]} (${x.limit}).` });
      } else if (x.status === 'near') {
        out.push({ level: 'warn', text: `${plural(x.left, 'lip pillow')} left ${PERIOD_WORD[key]}.` });
      }
    }
    const streak = underStreak(state, now);
    if (streak >= 2) out.push({ level: 'good', text: `Stayed within your daily limit ${streak} days in a row. Keep going!` });
    const gap = longestGapToday(state.entries, now);
    if (gap && gap.ms >= 60 * 60000) {
      out.push({
        level: 'info',
        text: `Longest gap today: ${formatDuration(gap.ms)}${gap.ongoing ? ' (and counting)' : ''}.`,
      });
    }
    if (s.limits.daily == null) out.push({ level: 'info', text: 'Set a daily limit to get feedback.' });
    return out;
  }

  const api = {
    DAY_MS,
    DEFAULT_SETTINGS,
    setDayStart,
    getDayStart,
    timeInDay,
    toNum,
    cleanSettings,
    lastAdded,
    setStrength,
    usage,
    costPerPillow,
    formatMoney,
    backupStatus,
    BUCKETS,
    startOfDay,
    startOfWeek,
    startOfMonth,
    addDays,
    daysInMonth,
    dayKey,
    emptyState,
    normalize,
    ACTIVITIES,
    cleanActivity,
    setEntryActivity,
    activityBreakdown,
    activityStats,
    sharesOf,
    toLimit,
    addEntry,
    removeEntry,
    updateEntryTime,
    limitsFor,
    countBetween,
    entriesBetween,
    periods,
    status,
    summary,
    dailySeries,
    underStreak,
    lastEntry,
    longestGapToday,
    bucketOf,
    timeOfDay,
    formatDuration,
    feedback,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SnusLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
