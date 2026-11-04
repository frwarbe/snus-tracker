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

  // ---- Small inline icons ----
  const ICONS = {
    info: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 10.6v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.4" r="1.2" fill="currentColor"/></svg>',
    alert: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 6.8v6.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1.3" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m7.6 12.4 3 3 5.8-6.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const ICON_FOR = { bad: 'alert', warn: 'alert', good: 'check', info: 'info' };

  // ---- Render ----
  let showAllHistory = false;

  function render() {
    const now = new Date();
    const s = L.summary(state, now);

    // Today
    $('todayCount').textContent = s.day.limit == null ? `${s.day.count}` : `${s.day.count} / ${s.day.limit}`;
    $('todayCount').className = 'count' + (s.day.status === 'over' ? ' over' : '');
    $('countNote').textContent = s.day.status === 'over' ? `over by ${s.day.over}` : '';
    const last = L.lastEntry(state.entries, now);
    $('lastPouch').textContent = last
      ? `Last lip pillow: ${fmtTime(last.t)} · ${L.formatDuration(now - last.t)} ago`
      : 'No lip pillows yet';
    $('undo').disabled = state.entries.length === 0;

    renderAsk();

    // Feedback notes
    let fb = L.feedback(state, now);
    if (!fb.some((m) => m.level !== 'info') && s.limits.daily != null) {
      fb = [{ level: 'good', text: 'All within your limits.' }, ...fb];
    }
    $('feedback').replaceChildren(
      ...fb.map((m) => {
        const li = el('li', { className: `note ${m.level}` });
        li.innerHTML = ICONS[ICON_FOR[m.level]];
        li.append(el('span', { textContent: m.text }));
        return li;
      })
    );

    // Progress
    $('progress').replaceChildren(
      ...[
        ['Today', s.day, false],
        ['This week', s.week, s.limits.weeklyAuto],
        ['This month', s.month, s.limits.monthlyAuto],
      ].map(([name, x, auto]) => {
        const row = el('div', { className: 'prog' });
        row.append(el('span', { className: 'prog-label', textContent: name }));
        if (x.limit == null) {
          row.append(el('span'), el('span', { className: 'prog-count', textContent: `${x.count}` }));
          return row;
        }
        const pct = x.limit ? Math.min(100, (x.count / x.limit) * 100) : x.count ? 100 : 0;
        const bar = el('div', { className: `bar ${x.status === 'over' ? 'over' : ''}` }, el('span'));
        bar.firstChild.style.width = `${pct}%`;
        bar.setAttribute('role', 'img');
        bar.setAttribute('aria-label', `${name}: ${x.count} of ${x.limit}`);
        row.append(bar, el('span', { className: 'prog-count', textContent: `${x.count} / ${x.limit}` }));
        const sub = x.over
          ? el('span', { className: 'prog-sub over', textContent: `over by ${x.over}` })
          : el('span', { className: 'prog-sub', textContent: `${x.left} left${auto ? ' · auto limit' : ''}` });
        row.append(sub);
        return row;
      })
    );

    // Today's lip pillows
    const p = L.periods(now).day;
    const todays = L.entriesBetween(state.entries, p.from, p.to).slice().reverse();
    $('todayList').replaceChildren(
      ...(todays.length
        ? todays.map((e) => {
            const time = el('input', { type: 'time', className: 'entry-time' });
            time.setAttribute('aria-label', 'Time of lip pillow');
            time.value = `${pad(new Date(e.t).getHours())}:${pad(new Date(e.t).getMinutes())}`;
            time.addEventListener('change', () => {
              if (!time.value) return;
              const [h, m] = time.value.split(':').map(Number);
              const d = new Date(e.t);
              d.setHours(h, m, 0, 0);
              commit(L.updateEntryTime(state, e.id, +d), 'Time updated');
            });
            const del = el('button', { className: 'del', textContent: 'Delete', type: 'button' });
            del.setAttribute('aria-label', `Delete lip pillow at ${fmtTime(e.t)}`);
            del.addEventListener('click', () => {
              if (e.id === askFor) hideActivityAsk();
              commit(L.removeEntry(state, e.id), 'Lip pillow deleted');
            });
            return el('li', {}, time, activitySelect(e), del);
          })
        : [el('li', { className: 'empty', textContent: 'Nothing yet today.' })])
    );

    renderChart(now);
    renderActivities(now);
    renderTimeOfDay(now);
    renderHistory(now);
    renderLimits(now);
  }

  function renderChart(now) {
    for (const b of $('ranges').children) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === range));
    // Start at the first logged day so empty days before you began don't drag the line down.
    const firstDay = state.entries.length ? L.startOfDay(state.entries[0].t) : L.startOfDay(now);
    const series = L.dailySeries(state.entries, now, range).filter((d, i, all) => d.date >= firstDay || i === all.length - 1);
    const limit = state.settings.daily;
    const W = 360, H = 200, padL = 26, padR = 8, padT = 10, padB = 24;
    const rawMax = Math.max(1, limit || 0, ...series.map((d) => d.count));
    const step = rawMax <= 5 ? 1 : rawMax <= 10 ? 2 : rawMax <= 25 ? 5 : 10;
    const max = Math.ceil(rawMax / step) * step;
    const n = series.length;
    const x = (i) => padL + 8 + (n === 1 ? (W - padL - padR - 16) / 2 : (i / (n - 1)) * (W - padL - padR - 16));
    const y = (v) => padT + (1 - v / max) * (H - padT - padB);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    const add = (tag, attrs, text, parent = svg) => {
      const node = document.createElementNS(ns, tag);
      for (const k in attrs) node.setAttribute(k, attrs[k]);
      if (text != null) node.textContent = text;
      parent.append(node);
      return node;
    };
    const css = getComputedStyle(document.documentElement);
    const c = (name) => css.getPropertyValue(name).trim();

    // Grid and y labels
    for (let v = 0; v <= max; v += step) {
      add('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), stroke: c('--light-pencil'), 'stroke-width': v === 0 ? 1.5 : 0.7, opacity: v === 0 ? 1 : 0.6 });
      add('text', { x: padL - 7, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: c('--pencil'), 'font-family': 'DM Sans, sans-serif' }, v);
    }
    // x labels
    const every = n <= 7 ? 1 : Math.ceil(n / 5);
    series.forEach((d, i) => {
      if (n > 7 && i % every !== 0 && i !== n - 1) return;
      if (n > 7 && i !== n - 1 && n - 1 - i < every * 0.6) return; // avoid crowding the last label
      const label = n <= 7
        ? d.date.toLocaleDateString([], { weekday: 'short' })
        : d.date.toLocaleDateString([], { day: 'numeric', month: 'short' });
      add('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: c('--graphite'), 'font-family': 'DM Sans, sans-serif' }, label);
    });
    // Limit line
    if (limit != null) {
      add('line', { x1: padL, x2: W - padR, y1: y(limit), y2: y(limit), stroke: c('--red'), 'stroke-width': 1.5, 'stroke-dasharray': '6 5', opacity: 0.85 });
      add('text', { x: W - padR, y: y(limit) - 5, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 600, fill: c('--red'), 'font-family': 'DM Sans, sans-serif' }, 'limit');
    }
    // Trend line
    const pts = series.map((d, i) => `${x(i)},${y(d.count)}`).join(' ');
    add('polyline', { points: pts, fill: 'none', stroke: c('--ink'), 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    const r = n > 45 ? 2.2 : n > 14 ? 3 : 4.2;
    series.forEach((d, i) => {
      const over = limit != null && d.count > limit;
      add('circle', {
        cx: x(i), cy: y(d.count), r: over ? r + 0.8 : r,
        fill: over ? c('--red') : c('--ink'), stroke: c('--paper'), 'stroke-width': 1,
      }).append(Object.assign(document.createElementNS(ns, 'title'), { textContent: `${fmtDay(d.date)}: ${d.count}${over ? ' (over limit)' : ''}` }));
    });

    const total = series.reduce((a, d) => a + d.count, 0);
    const overDays = limit == null ? 0 : series.filter((d) => d.count > limit).length;
    const summaryText = `Average ${(total / n).toFixed(1)} a day over ${n} day${n === 1 ? '' : 's'}` +
      (limit == null ? '' : ` · ${overDays} day${overDays === 1 ? '' : 's'} over your limit`);
    svg.setAttribute('aria-label', `Line graph of lip pillows per day. ${summaryText}.`);
    $('chart').replaceChildren(svg);
    $('chartNote').textContent = summaryText;
  }

  // Dropdown on each of today's entries to set or change what you were doing.
  function activitySelect(e) {
    const sel = el('select', { className: 'entry-act' + (e.activity ? '' : ' unset') });
    sel.setAttribute('aria-label', 'What were you doing');
    const opts = ['', ...L.ACTIVITIES];
    if (e.activity && !opts.includes(e.activity)) opts.push(e.activity);
    for (const o of opts) sel.append(el('option', { value: o, textContent: o || 'Activity…' }));
    sel.append(el('option', { value: '__other', textContent: 'Other…' }));
    sel.value = e.activity || '';
    sel.addEventListener('change', () => {
      let v = sel.value;
      if (v === '__other') {
        v = prompt('What were you doing?', '');
        if (v == null) return render();
      }
      commit(L.setEntryActivity(state, e.id, v), 'Saved');
    });
    return sel;
  }

  // Vertical hatched bars with the count on top and labels underneath.
  function columns(target, rows, emptyText) {
    const box = $(target);
    let labels = box.nextElementSibling;
    if (!labels || !labels.classList.contains('col-labels')) {
      labels = el('div', { className: 'col-labels' });
      box.after(labels);
    }
    const total = rows.reduce((a, r) => a + r.count, 0);
    if (!total) {
      box.replaceChildren(el('p', { className: 'empty-chart', textContent: emptyText }));
      labels.replaceChildren();
      box.removeAttribute('aria-label');
      return;
    }
    const max = Math.max(...rows.map((r) => r.count));
    box.replaceChildren(
      ...rows.map((r) => {
        const bar = el('div', { className: 'col-bar' });
        // Leave room above the tallest bar for its number.
        bar.style.height = `calc((100% - 24px) * ${r.count / max})`;
        const col = el('div', { className: 'col' }, el('span', { className: 'col-n', textContent: r.count }), bar);
        return col;
      })
    );
    labels.replaceChildren(...rows.map((r) => el('span', { textContent: r.name })));
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', rows.map((r) => `${r.name}: ${r.count}`).join(', '));
  }

  const MOSTLY = { morning: 'Mostly mornings', afternoon: 'Mostly afternoons', evening: 'Mostly evenings', night: 'Mostly at night' };
  function fmtLast(t) {
    const day = L.startOfDay(new Date());
    if (t >= +day) return `today ${fmtTime(t)}`;
    if (t >= +L.addDays(day, -1)) return `yesterday ${fmtTime(t)}`;
    return new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function renderActivities(now) {
    const st = L.activityStats(state.entries, now, 30);
    // Full breakdown: every answer with its count and share; your own answers sit under Other.
    const box = $('breakdown');
    $('activityEmpty').hidden = st.tagged > 0;
    box.hidden = st.tagged === 0;
    if (!st.tagged) return box.replaceChildren();
    const row = (r, child) => {
      const bar = el('div', { className: 'bd-bar' }, el('span'));
      bar.firstChild.style.width = `${r.pct}%`;
      return el('div', { className: 'bd-row' + (child ? ' child' : '') + (r.count ? '' : ' zero') },
        el('div', { className: 'bd-main' },
          el('span', { className: 'bd-name', textContent: r.name }),
          el('span', { className: 'bd-nums' },
            el('span', { className: 'bd-count', textContent: `${r.count}` }),
            el('span', { className: 'bd-pct', textContent: `${r.pct}%` }))),
        bar,
        r.count ? el('div', { className: 'bd-sub', textContent: `${MOSTLY[r.mostly]} · last ${fmtLast(r.last)}` }) : '');
    };
    const out = [];
    const unused = st.rows.filter((r) => !r.count && r.name !== 'Other').map((r) => r.name);
    for (const r of st.rows) {
      if (!r.count) continue;
      out.push(row(r, false));
      for (const c of r.children || []) out.push(row(c, true));
    }
    const foot = `Based on ${st.tagged} tagged lip pillow${st.tagged === 1 ? '' : 's'}` +
      (st.untagged ? ` · ${st.untagged} not tagged` : '') +
      (unused.length ? `. Not picked yet: ${unused.join(', ')}.` : '');
    box.replaceChildren(
      el('div', { className: 'bd-head' }, el('span', { textContent: 'Breakdown' }), el('span', { textContent: 'count · share' })),
      ...out,
      el('p', { className: 'bd-foot', textContent: foot }));
  }

  function renderTimeOfDay(now) {
    const counts = L.timeOfDay(state.entries, now, 30);
    const names = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
    columns('timeOfDay', L.BUCKETS.map((b) => ({ name: names[b], count: counts[b] })), 'Nothing logged yet');
  }

  function renderHistory(now) {
    const limit = state.settings.daily;
    const days = L.dailySeries(state.entries, now, 30).reverse().slice(1); // skip today
    const all = state.entries.length ? days.filter((d) => d.date >= L.startOfDay(state.entries[0].t)) : [];
    const shown = showAllHistory ? all : all.slice(0, 3);
    $('history').replaceChildren(
      ...(shown.length
        ? shown.map((d) => {
            const over = limit != null && d.count > limit;
            const mark = limit == null ? '' : over ? `over by ${d.count - limit}` : 'within limit';
            return el('li', { className: 'hist-row' + (over ? ' over' : '') },
              el('span', { className: 'hist-day', textContent: d.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) }),
              el('span', { className: 'hist-count', textContent: d.count }),
              el('span', { className: 'hist-mark', textContent: mark }));
          })
        : [el('li', { className: 'empty', textContent: 'No past days yet.' })])
    );
    $('moreHistory').hidden = all.length <= 3;
    $('moreHistory').textContent = showAllHistory ? 'Show less' : `Show more (${all.length - 3})`;
  }

  function renderLimits(now) {
    const s = state.settings;
    const autoW = s.daily != null ? s.daily * 7 : null;
    const autoM = s.daily != null ? s.daily * L.daysInMonth(now) : null;
    $('limWeekly').placeholder = autoW != null ? 'auto' : 'none';
    $('limMonthly').placeholder = autoM != null ? 'auto' : 'none';
    $('limWeeklyHint').textContent = s.weekly == null ? (autoW != null ? `= ${autoW}` : '') : 'set by you · clear for auto';
    $('limMonthlyHint').textContent = s.monthly == null ? (autoM != null ? `= ${autoM}` : '') : 'set by you · clear for auto';
    // Don't overwrite what the user is typing.
    if ($('limits').contains(document.activeElement)) return;
    $('limDaily').value = s.daily ?? '';
    $('limWeekly').value = s.weekly ?? '';
    $('limMonthly').value = s.monthly ?? '';
  }

  // ---- "What were you doing?" after logging ----
  // Stays open for the lip pillow you just logged; tap a chip to tag it, tap again to untag.
  let askFor = null;
  function showActivityAsk(id) {
    askFor = id;
    renderAsk();
  }
  function hideActivityAsk() {
    askFor = null;
    renderAsk();
  }
  function renderAsk() {
    const entry = askFor && state.entries.find((e) => e.id === askFor);
    if (!entry) {
      askFor = null;
      $('activityAsk').hidden = true;
      return;
    }
    $('activityAsk').hidden = false;
    // Don't rebuild while you're typing in the "Other" box.
    if ($('activityChips').contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const current = entry.activity || null;
    const isCustom = current && !L.ACTIVITIES.includes(current);
    const chips = L.ACTIVITIES.map((name) => {
      const b = el('button', { className: 'chip', textContent: name, type: 'button' });
      b.setAttribute('aria-pressed', String(current === name));
      b.addEventListener('click', () => setAskedActivity(current === name ? '' : name));
      return b;
    });
    const other = el('input', { className: 'chip-input' + (isCustom ? ' filled' : ''), placeholder: 'Other…', maxLength: 60, value: isCustom ? current : '' });
    other.setAttribute('aria-label', 'Other: type what you were doing');
    other.setAttribute('enterkeyhint', 'done');
    const saveOther = () => {
      const v = L.cleanActivity(other.value);
      if ((v || '') === (isCustom ? current : '')) return;
      setAskedActivity(v || '');
    };
    other.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); other.blur(); } });
    other.addEventListener('blur', saveOther);
    const done = el('button', { className: 'chip skip', textContent: current ? 'Done' : 'Skip', type: 'button' });
    done.addEventListener('click', hideActivityAsk);
    $('activityChips').replaceChildren(...chips, other, done);
  }
  function setAskedActivity(name) {
    if (!askFor) return;
    commit(L.setEntryActivity(state, askFor, name), name ? `Saved: ${name}` : 'Cleared');
  }

  // Show the first feedback message that changed after logging.
  function logAt(t) {
    const before = new Set(L.feedback(state, new Date()).map((m) => m.text));
    const oldIds = new Set(state.entries.map((e) => e.id));
    const next = L.addEntry(state, t);
    const added = next.entries.find((e) => !oldIds.has(e.id));
    askFor = added ? added.id : null;
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
    if (last && last.id === askFor) askFor = null;
    if (last) commit(L.removeEntry(state, last.id), `Removed lip pillow from ${fmtTime(last.t)}`);
  });
  $('moreHistory').addEventListener('click', () => { showAllHistory = !showAllHistory; renderHistory(new Date()); });
  $('settingsBtn').addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('settings').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  });
  $('ranges').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    const d = Number(btn && btn.dataset.days);
    if (!d) return;
    range = d;
    try { localStorage.setItem(RANGE_KEY, String(d)); } catch (err) { /* ignore */ }
    renderChart(new Date());
  });
  // Limits apply as you type; no Save button needed.
  function readLimits() {
    return {
      daily: L.toLimit($('limDaily').value),
      weekly: L.toLimit($('limWeekly').value),
      monthly: L.toLimit($('limMonthly').value),
    };
  }
  for (const id of ['limDaily', 'limWeekly', 'limMonthly']) {
    $(id).addEventListener('input', () => commit({ ...state, settings: readLimits() }));
    $(id).addEventListener('change', () => toast('Limits saved'));
  }
  $('limits').addEventListener('submit', (e) => {
    e.preventDefault();
    document.activeElement.blur();
  });
  $('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'snuswatch', version: 1, ...state }, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `snuswatch-${L.dayKey(new Date())}.json` });
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
      askFor = null;
      commit(next, 'Backup restored');
    } catch (err) {
      toast("That file isn't a SNUSwatch backup");
    }
  });
  $('clear').addEventListener('click', () => {
    if (confirm('Delete all lip pillows and limits on this device? This cannot be undone.')) {
      askFor = null;
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
    // When a new version takes over, reload once so the page shows it.
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
  }
})();
