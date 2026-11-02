// UI wiring. All calculations live in logic.js.
(function () {
  const L = window.SnusLogic;
  const KEY = 'snus-tracker-v1';
  const RANGE_KEY = 'snus-tracker-range';
  const $ = (id) => document.getElementById(id);

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return L.normalize(JSON.parse(raw));
    } catch (e) {
      console.warn('Could not read saved data', e);
    }
    return L.emptyState();
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save on this device');
    }
  }

  let state = load();
  let range = 30;
  try {
    range = Number(localStorage.getItem(RANGE_KEY)) || 30;
  } catch (e) { /* ignore */ }

  // ---- Helpers ----
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (d) => new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  const pad = (n) => String(n).padStart(2, '0');
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    Object.assign(n, props || {});
    for (const k of kids) n.append(k);
    return n;
  }

  let toastTimer;
  function toast(text) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = el('div', { className: 'toast', role: 'status' });
      document.body.append(t);
    }
    t.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 3500);
  }

  function commit(next, message) {
    state = next;
    save();
    render();
    if (message) toast(message);
  }

  // ---- Render ----
  function render() {
    const now = new Date();
    const s = L.summary(state, now);

    $('todayCount').textContent = s.day.limit == null ? `${s.day.count}` : `${s.day.count} / ${s.day.limit}`;
    $('todayCount').className = 'big' + (s.day.status === 'over' ? ' over' : '');
    const last = L.lastEntry(state.entries, now);
    $('lastPouch').textContent = last
      ? `Last lip pillow: ${fmtTime(last.t)}\n${L.formatDuration(now - last.t)} ago`
      : 'No lip pillows yet';
    $('lastPouch').style.whiteSpace = 'pre-line';
    $('undo').disabled = state.entries.length === 0;

    // Feedback
    const fb = L.feedback(state, now);
    $('feedback').replaceChildren(
      ...(fb.length ? fb : [{ level: 'good', text: 'All within your limits.' }]).map((m) =>
        el('li', { className: `msg-${m.level}`, textContent: m.text })
      )
    );

    // Progress
    $('progress').replaceChildren(
      ...[
        ['Today', s.day],
        ['This week', s.week, s.limits.weeklyAuto],
        ['This month', s.month, s.limits.monthlyAuto],
      ].map(([name, x, auto]) => {
        const pct = x.limit ? Math.min(100, (x.count / x.limit) * 100) : x.limit === 0 && x.count ? 100 : 0;
        const right =
          x.limit == null
            ? `${x.count}`
            : `${x.count} / ${x.limit}${auto && name !== 'Today' ? ' (auto)' : ''} · ${
                x.over ? `${x.over} over` : `${x.left} left`
              }`;
        const bar = el('div', { className: `bar ${x.status}` }, el('span'));
        bar.firstChild.style.width = `${pct}%`;
        return el('div', { style: 'margin-bottom:10px' },
          el('div', { className: 'row between' }, el('span', { textContent: name }), el('span', { textContent: right })),
          x.limit == null ? '' : bar);
      })
    );

    // Today's lip pillows
    const p = L.periods(now).day;
    const todays = L.entriesBetween(state.entries, p.from, p.to).slice().reverse();
    $('todayList').replaceChildren(
      ...(todays.length
        ? todays.map((e) => {
            const time = el('input', { type: 'time' });
            time.setAttribute('aria-label', 'Time of lip pillow');
            time.value = `${pad(new Date(e.t).getHours())}:${pad(new Date(e.t).getMinutes())}`;
            time.addEventListener('change', () => {
              if (!time.value) return;
              const [h, m] = time.value.split(':').map(Number);
              const d = new Date(e.t);
              d.setHours(h, m, 0, 0);
              commit(L.updateEntryTime(state, e.id, +d), 'Time updated');
            });
            const del = el('button', { textContent: 'Delete' });
            del.addEventListener('click', () => commit(L.removeEntry(state, e.id), 'Lip pillow deleted'));
            return el('li', { className: 'row between' }, time, del);
          })
        : [el('li', { className: 'muted', textContent: 'None today' })])
    );

    renderChart(now);
    renderTimeOfDay(now);
    renderHistory(now);
    renderLimits(now, s.limits);
  }

  function renderChart(now) {
    for (const b of $('ranges').children) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === range));
    // Start at the first logged day so empty days before you began don't drag the line down.
    const firstDay = state.entries.length ? L.startOfDay(state.entries[0].t) : L.startOfDay(now);
    const series = L.dailySeries(state.entries, now, range).filter((d, i, all) => d.date >= firstDay || i === all.length - 1);
    const limit = state.settings.daily;
    const W = 600, H = 220, padL = 32, padR = 10, padT = 12, padB = 26;
    const max = Math.max(1, limit || 0, ...series.map((d) => d.count));
    const x = (i) => padL + (series.length === 1 ? 0 : (i / (series.length - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - v / max) * (H - padT - padB);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Lip pillows per day, last ${range} days`);
    const add = (tag, attrs, text) => {
      const n = document.createElementNS(ns, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text != null) n.textContent = text;
      svg.append(n);
      return n;
    };
    const css = getComputedStyle(document.documentElement);
    const c = (name) => css.getPropertyValue(name).trim();

    // Axis lines and labels
    add('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), stroke: c('--line') });
    add('text', { x: padL - 6, y: y(max) + 4, 'text-anchor': 'end', 'font-size': 12, fill: c('--muted') }, max);
    add('text', { x: padL - 6, y: y(0) + 4, 'text-anchor': 'end', 'font-size': 12, fill: c('--muted') }, 0);
    const labelIdx = [0, Math.floor((series.length - 1) / 2), series.length - 1];
    labelIdx.forEach((i, k) =>
      add('text', {
        x: x(i), y: H - 6, 'font-size': 12, fill: c('--muted'),
        'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle',
      }, series[i].date.toLocaleDateString([], { day: 'numeric', month: 'short' }))
    );
    // Limit line
    if (limit != null) {
      add('line', { x1: padL, x2: W - padR, y1: y(limit), y2: y(limit), stroke: c('--bad'), 'stroke-dasharray': '6 5' });
      add('text', { x: W - padR, y: y(limit) - 4, 'text-anchor': 'end', 'font-size': 12, fill: c('--bad') }, `limit ${limit}`);
    }
    // Trend line and points
    add('polyline', {
      points: series.map((d, i) => `${x(i)},${y(d.count)}`).join(' '),
      fill: 'none', stroke: c('--accent'), 'stroke-width': 2.5, 'stroke-linejoin': 'round',
    });
    const r = range > 30 ? 2 : 3.5;
    series.forEach((d, i) => {
      const over = limit != null && d.count > limit;
      add('circle', { cx: x(i), cy: y(d.count), r: over ? r + 1 : r, fill: over ? c('--bad') : c('--accent') })
        .append(Object.assign(document.createElementNS(ns, 'title'), { textContent: `${fmtDay(d.date)}: ${d.count}` }));
    });
    $('chart').replaceChildren(svg);

    const total = series.reduce((a, d) => a + d.count, 0);
    const overDays = limit == null ? 0 : series.filter((d) => d.count > limit).length;
    $('chartNote').textContent =
      `Average ${(total / series.length).toFixed(1)} a day` + (limit == null ? '' : ` · ${overDays} day${overDays === 1 ? '' : 's'} over limit`);
  }

  function renderTimeOfDay(now) {
    const counts = L.timeOfDay(state.entries, now, 30);
    const total = L.BUCKETS.reduce((a, b) => a + counts[b], 0);
    const labels = { morning: 'Morning (5–12)', afternoon: 'Afternoon (12–17)', evening: 'Evening (17–22)', night: 'Night (22–5)' };
    $('timeOfDay').replaceChildren(
      ...L.BUCKETS.map((b) => {
        const pct = total ? Math.round((counts[b] / total) * 100) : 0;
        const bar = el('div', { className: 'bar' }, el('span'));
        bar.firstChild.style.width = `${pct}%`;
        return el('div', { style: 'margin-bottom:8px' },
          el('div', { className: 'row between' }, el('span', { textContent: labels[b] }),
            el('span', { textContent: `${counts[b]} (${pct}%)` })),
          bar);
      })
    );
  }

  function renderHistory(now) {
    const limit = state.settings.daily;
    const days = L.dailySeries(state.entries, now, 30).reverse().slice(1); // skip today
    const shown = state.entries.length ? days.filter((d) => d.date >= L.startOfDay(state.entries[0].t)) : [];
    $('history').replaceChildren(
      ...(shown.length
        ? shown.map((d) => {
            const over = limit != null && d.count > limit;
            const mark = limit == null ? '' : over ? ` · over by ${d.count - limit}` : ' · within limit';
            return el('li', { className: 'row between' + (over ? ' over' : '') },
              el('span', { textContent: fmtDay(d.date) }), el('span', { textContent: `${d.count}${mark}` }));
          })
        : [el('li', { className: 'muted', textContent: 'No past days yet' })])
    );
  }

  function renderLimits(now, lim) {
    // Don't overwrite what the user is typing.
    if ($('limits').contains(document.activeElement)) return;
    const s = state.settings;
    $('limDaily').value = s.daily ?? '';
    $('limWeekly').value = s.weekly ?? '';
    $('limMonthly').value = s.monthly ?? '';
    $('limWeekly').placeholder = s.daily != null ? `auto: ${s.daily * 7}` : 'none';
    $('limMonthly').placeholder = s.daily != null ? `auto: ${s.daily * L.daysInMonth(now)}` : 'none';
  }

  // ---- Events ----
  // Show the first feedback message that changed after logging.
  function logAt(t) {
    const before = new Set(L.feedback(state, new Date()).map((m) => m.text));
    const next = L.addEntry(state, t);
    const msg = L.feedback(next, new Date()).find((m) => !before.has(m.text) && m.level !== 'info');
    const s = L.summary(next, new Date());
    commit(next, msg ? msg.text : s.day.limit == null ? 'Logged' : `Logged · ${s.day.left} left today`);
  }

  // The time field follows the clock until you change it. After logging it goes back to "now".
  let timeChanged = false;
  function syncLogTime() {
    if (!timeChanged) {
      const d = new Date();
      $('logTime').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    $('logTimeNote').textContent = timeChanged ? 'earlier today' : 'now';
    $('nowBtn').hidden = !timeChanged;
  }
  $('logTime').addEventListener('input', () => { timeChanged = true; syncLogTime(); });
  $('nowBtn').addEventListener('click', () => { timeChanged = false; syncLogTime(); });

  $('log').addEventListener('click', () => {
    if (!timeChanged) return logAt(Date.now());
    if (!$('logTime').value) return toast('Pick a time');
    const [h, m] = $('logTime').value.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (+d > Date.now()) return toast("That time hasn't happened yet");
    logAt(+d);
    timeChanged = false;
    syncLogTime();
  });
  setInterval(syncLogTime, 15000);
  syncLogTime();
  $('undo').addEventListener('click', () => {
    const last = state.entries[state.entries.length - 1];
    if (last) commit(L.removeEntry(state, last.id), `Removed lip pillow from ${fmtTime(last.t)}`);
  });
  $('ranges').addEventListener('click', (e) => {
    const d = Number(e.target.dataset && e.target.dataset.days);
    if (!d) return;
    range = d;
    try { localStorage.setItem(RANGE_KEY, String(d)); } catch (err) { /* ignore */ }
    renderChart(new Date());
  });
  $('limits').addEventListener('submit', (e) => {
    e.preventDefault();
    const settings = {
      daily: L.toLimit($('limDaily').value),
      weekly: L.toLimit($('limWeekly').value),
      monthly: L.toLimit($('limMonthly').value),
    };
    document.activeElement.blur();
    commit({ ...state, settings }, 'Limits saved');
  });
  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'snus-tracker', version: 1, ...state }, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `snus-tracker-${L.dayKey(new Date())}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async () => {
    const file = $('importFile').files[0];
    $('importFile').value = '';
    if (!file) return;
    try {
      const next = L.normalize(JSON.parse(await file.text()));
      if (!confirm(`Replace your data with this backup (${next.entries.length} lip pillows)?`)) return;
      commit(next, 'Backup restored');
    } catch (err) {
      toast("That file isn't a snus tracker backup");
    }
  });
  $('clear').addEventListener('click', () => {
    if (confirm('Delete all lip pillows and limits on this device? This cannot be undone.')) {
      commit(L.emptyState(), 'All data deleted');
    }
  });

  // Keep "x ago" and day rollover fresh.
  setInterval(render, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('storage', (e) => { if (e.key === KEY) { state = load(); render(); } });

  render();

  // Offline support (only works when served over http(s), not from a file).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
