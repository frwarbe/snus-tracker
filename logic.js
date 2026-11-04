// Pure tracking logic: no DOM, no storage. Used by app.js and by the tests.
(function (root) {
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ---- Dates (all in the device's local time) ----
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
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
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }
  function dayKey(d) {
    const x = new Date(d);
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${x.getFullYear()}-${m}-${day}`;
  }

  // ---- State ----
  function emptyState() {
    return { settings: { daily: null, weekly: null, monthly: null }, entries: [] };
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
        return out;
      })
      .sort((a, b) => a.t - b.t);
    return {
      settings: { daily: toLimit(s.daily), weekly: toLimit(s.weekly), monthly: toLimit(s.monthly) },
      entries,
    };
  }

  let idCounter = 0;
  function newId(t) {
    idCounter += 1;
    return `${Number(t).toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function addEntry(state, t) {
    const entries = state.entries.concat({ id: newId(t), t: Number(t) }).sort((a, b) => a.t - b.t);
    return { ...state, entries };
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
      month: { from: month, to: new Date(month.getFullYear(), month.getMonth() + 1, 1) },
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
