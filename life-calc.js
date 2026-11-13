// ---------- Life calculations ----------
// Every number on the Life pages is worked out here: streaks, completion %,
// goal progress and pace, credits, sleep hours, personal records.
// Nothing here touches the screen or storage: functions take data and return
// numbers. Dates are "YYYY-MM-DD" text, times "HH:MM" (24-hour).

const LifeCalc = {
  // ================= Dates =================
  today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },
  toUTC(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); },
  fromUTC(ms) { return new Date(ms).toISOString().slice(0, 10); },
  addDays(s, n) { return this.fromUTC(this.toUTC(s) + n * 86400000); },
  daysBetween(from, to) { return Math.round((this.toUTC(to) - this.toUTC(from)) / 86400000); },
  weekday(s) { return new Date(this.toUTC(s)).getUTCDay(); },           // 0 = Sunday … 6 = Saturday
  weekStart(s) { return this.addDays(s, -((this.weekday(s) + 6) % 7)); }, // the Monday of that week
  // Same day next month (or the month's last day if it's shorter)
  addMonths(s, k) {
    const [y, m, d] = s.split("-").map(Number);
    const months = m - 1 + k;
    const year = y + Math.floor(months / 12), month = ((months % 12) + 12) % 12;
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return this.fromUTC(Date.UTC(year, month, Math.min(d, last)));
  },
  sum(list, fn) { return list.reduce((t, x) => t + (fn ? fn(x) : x), 0); },
  round1(n) { return Math.round(n * 10) / 10; },

  // ================= Habits =================
  // schedule: { type: "daily" } | { type: "days", days: [0-6] } | { type: "weekly", times: n }
  isScheduled(h, date) {
    const s = h.schedule || { type: "daily" };
    if (s.type === "days") return (s.days || []).includes(this.weekday(date));
    return true; // daily, and "X times a week" (any day can count)
  },
  isDone(h, date) { return (h.done || []).includes(date); },
  // The day a habit's history starts: when it was made, or its first tick if earlier
  habitStart(h) { return [h.created || this.today(), ...(h.done || [])].sort()[0]; },
  weekCount(h, date) {
    const start = this.weekStart(date), end = this.addDays(start, 6);
    return (h.done || []).filter((d) => d >= start && d <= end).length;
  },
  isWeekly(h) { return (h.schedule || {}).type === "weekly"; },
  weeklyTarget(h) { return Math.max(1, Math.min(7, Number((h.schedule || {}).times) || 1)); },

  // Current streak. Days for daily / weekday habits (days off don't break it),
  // weeks for "X times a week" habits. Today (or this week) only counts once
  // it's done, and doesn't break the streak while it's still in progress.
  streak(h, today) {
    const start = this.habitStart(h);
    if (this.isWeekly(h)) {
      const target = this.weeklyTarget(h);
      let wk = this.weekStart(today), n = 0;
      if (this.weekCount(h, wk) >= target) n++;
      wk = this.addDays(wk, -7);
      while (wk >= this.weekStart(start) && this.weekCount(h, wk) >= target) { n++; wk = this.addDays(wk, -7); }
      return n;
    }
    const done = new Set(h.done || []);
    let d = today, n = 0;
    if (this.isScheduled(h, d) && !done.has(d)) d = this.addDays(d, -1); // today not done yet: start from yesterday
    for (; d >= start; d = this.addDays(d, -1)) {
      if (!this.isScheduled(h, d)) continue;
      if (!done.has(d)) break;
      n++;
    }
    return n;
  },

  bestStreak(h, today) {
    const start = this.habitStart(h);
    let best = 0, run = 0;
    if (this.isWeekly(h)) {
      const target = this.weeklyTarget(h);
      for (let wk = this.weekStart(start); wk <= today; wk = this.addDays(wk, 7)) {
        if (this.weekCount(h, wk) >= target) best = Math.max(best, ++run);
        else if (wk !== this.weekStart(today)) run = 0;
      }
      return best;
    }
    const done = new Set(h.done || []);
    for (let d = start; d <= today; d = this.addDays(d, 1)) {
      if (!this.isScheduled(h, d)) continue;
      if (done.has(d)) best = Math.max(best, ++run);
      else if (d !== today) run = 0;
    }
    return best;
  },

  // % of the last 30 days done (only since the habit started). For "X a week":
  // ticks ÷ what the target asks for in that time, at most 100%.
  completion(h, today, days = 30) {
    const from = [this.addDays(today, -(days - 1)), this.habitStart(h)].sort()[1];
    const span = this.daysBetween(from, today) + 1;
    const done = (h.done || []).filter((d) => d >= from && d <= today);
    if (this.isWeekly(h)) {
      const wanted = (this.weeklyTarget(h) * span) / 7;
      return Math.min(100, Math.round((done.length / Math.max(1, wanted)) * 100));
    }
    let due = 0, hit = 0;
    for (let d = from; d <= today; d = this.addDays(d, 1)) {
      if (!this.isScheduled(h, d)) continue;
      due++;
      if (this.isDone(h, d)) hit++;
    }
    if (due && !this.isDone(h, today) && this.isScheduled(h, today)) due--; // today isn't over yet
    return due ? Math.round((hit / due) * 100) : 0;
  },

  // 12 weeks (Monday-first columns) ending this week: [{ date, done, scheduled, future }]
  heatmap(h, today, weeks = 12) {
    const first = this.addDays(this.weekStart(today), -(weeks - 1) * 7);
    const cols = [];
    for (let w = 0; w < weeks; w++) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        const date = this.addDays(first, w * 7 + i);
        col.push({ date, done: this.isDone(h, date), scheduled: this.isScheduled(h, date), future: date > today });
      }
      cols.push(col);
    }
    return cols;
  },

  // Shown on Today: daily ones, today's weekday ones, and weekly ones (still
  // short of this week's target, or ticked today)
  dueToday(h, today) {
    if (h.archived) return false;
    if (this.isWeekly(h)) return this.weekCount(h, today) < this.weeklyTarget(h) || this.isDone(h, today);
    return this.isScheduled(h, today);
  },

  // ================= Day score =================
  // Worked out automatically for every day, never entered. Parts that apply:
  //   habits: % of that day's scheduled habits done ("X a week" habits only
  //           count on days they were ticked, so they never pull a day down;
  //           a gym habit is how workouts count)
  //   tasks:  % of tasks due that day that are done (skipped if none due)
  //   sleep:  100 within 1h of the target, 50 within 2h, else 0 (skipped if not logged)
  // Sections switched off in My sections are ignored (see visible() below).
  // Score = average of the parts that apply. Grey ("none") when nothing at all
  // was logged that day. Which parts count and the colour thresholds are in
  // settings.dayScore.
  DAY_SCORE: { good: 80, mid: 50, habits: true, tasks: true, sleep: true },
  dayScoreSettings(data) { return { ...this.DAY_SCORE, ...((data.settings || {}).dayScore || {}) }; },
  habitActiveOn(h, date) { return date >= this.habitStart(h) && (!h.archived || date < h.archived); },

  // ================= My sections (what the person has switched on) =================
  // Saved in settings.sections as { key: true|false }. Anything not saved counts
  // as ON, so accounts from before this existed keep everything.
  SECTION_KEYS: ["pnl", "life", "journal", "habits", "plans", "fitness", "school", "sleep"],
  sections(data) {
    const saved = ((data && data.settings) || {}).sections || {};
    const out = {};
    for (const k of this.SECTION_KEYS) out[k] = saved[k] !== false;
    return out;
  },
  // The data with switched-off sections left out (nothing is deleted: this is
  // only what the screens and the day score look at). Tasks tied to a school
  // standard count as School.
  visible(data) {
    const on = this.sections(data);
    if (on.habits && on.plans && on.fitness && on.school && on.sleep) return data;
    return {
      ...data,
      habits: on.habits ? data.habits : [],
      goals: on.plans ? data.goals : [],
      tasks: !on.plans ? [] : on.school ? data.tasks : data.tasks.filter((t) => !t.standardId),
      standards: on.school ? data.standards : [],
      workouts: on.fitness ? data.workouts : [],
      bodyweight: on.fitness ? data.bodyweight : [],
      sleep: on.sleep ? data.sleep : [],
    };
  },

  dayScore(data, date, today = this.today()) {
    data = this.visible(data); // only sections that are switched on count (as they are now, also for past days)
    const cfg = this.dayScoreSettings(data);
    if (date > today) return { date, future: true, colour: "future", score: null, parts: {} };
    const parts = {};
    const habits = data.habits.filter((h) => this.habitActiveOn(h, date) &&
      (this.isWeekly(h) ? this.isDone(h, date) : this.isScheduled(h, date)));
    if (cfg.habits && habits.length) {
      const done = habits.filter((h) => this.isDone(h, date)).length;
      parts.habits = { done, total: habits.length, pct: (done / habits.length) * 100 };
    }
    const due = data.tasks.filter((t) => t.due === date);
    if (cfg.tasks && due.length) {
      const done = due.filter((t) => t.done).length;
      parts.tasks = { done, total: due.length, pct: (done / due.length) * 100 };
    }
    const night = data.sleep.find((s) => s.date === date);
    if (cfg.sleep && night) {
      const hours = this.sleepHours(night.bed, night.wake);
      const target = Number((data.settings || {}).sleepTarget) || 8;
      const off = Math.abs(hours - target);
      parts.sleep = { hours, target, pct: off <= 1 ? 100 : off <= 2 ? 50 : 0 };
    }
    const logged = data.habits.some((h) => this.isDone(h, date)) || data.tasks.some((t) => t.done === date) ||
      due.some((t) => t.done) || !!night || data.workouts.some((w) => w.date === date);
    const list = Object.values(parts);
    if (!logged || !list.length) return { date, colour: "none", score: null, parts, logged };
    const score = Math.round(this.sum(list, (p) => p.pct) / list.length);
    return { date, score, parts, logged, colour: score >= cfg.good ? "good" : score >= cfg.mid ? "mid" : "bad" };
  },

  daysInMonth(month) { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); },
  addMonthsToMonth(month, k) { return this.addMonths(month + "-01", k).slice(0, 7); },
  // Every day of a month ("YYYY-MM") with its score, plus colour counts
  monthScores(data, month, today = this.today()) {
    const days = [];
    for (let i = 1; i <= this.daysInMonth(month); i++) days.push(this.dayScore(data, `${month}-${String(i).padStart(2, "0")}`, today));
    const counts = { good: 0, mid: 0, bad: 0, none: 0, future: 0 };
    days.forEach((d) => counts[d.colour]++);
    return { month, days, counts };
  },

  // ================= Tasks and goals =================
  PRIORITY: { high: 0, med: 1, low: 2 },
  sortTasks(list) {
    return list.slice().sort((a, b) =>
      (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1
        : (this.PRIORITY[a.priority] ?? 1) - (this.PRIORITY[b.priority] ?? 1));
  },
  // The next due date of a repeating task
  nextDue(due, repeat, today) {
    const from = due || today;
    if (repeat === "daily") return this.addDays(from, 1);
    if (repeat === "weekly") return this.addDays(from, 7);
    if (repeat === "monthly") return this.addMonths(from, 1);
    return null;
  },
  // Open tasks split up for the Plans inbox / Today
  taskBuckets(tasks, today) {
    const open = this.sortTasks(tasks.filter((t) => !t.done));
    return {
      overdue: open.filter((t) => t.due && t.due < today),
      today: open.filter((t) => t.due === today),
      upcoming: open.filter((t) => t.due && t.due > today),
      noDate: open.filter((t) => !t.due),
    };
  },

  goalTasks(goal, tasks) { return tasks.filter((t) => t.goalId === goal.id); },
  // Latest logged value (by date) for a number goal, or its start value
  goalCurrent(goal) {
    const ups = (goal.updates || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return ups.length ? Number(ups[ups.length - 1].value) : Number(goal.start) || 0;
  },
  // 0 … 1
  goalProgress(goal, tasks) {
    if (goal.kind === "number") {
      const start = Number(goal.start) || 0, target = Number(goal.target);
      if (!isFinite(target) || target === start) return this.goalCurrent(goal) === target ? 1 : 0;
      return Math.max(0, Math.min(1, (this.goalCurrent(goal) - start) / (target - start)));
    }
    const list = this.goalTasks(goal, tasks);
    return list.length ? list.filter((t) => t.done).length / list.length : 0;
  },
  goalAchieved(goal, tasks) {
    if (goal.achieved) return true;
    if (goal.kind === "number") return this.goalProgress(goal, tasks) >= 1;
    const list = this.goalTasks(goal, tasks);
    return list.length > 0 && list.every((t) => t.done);
  },
  // On track = progress at least where a straight line from the start date
  // to the deadline says it should be today (with a little leeway).
  goalPace(goal, tasks, today) {
    if (!goal.deadline) return { daysLeft: null, expected: null, onTrack: null };
    const start = goal.created || today;
    const total = Math.max(1, this.daysBetween(start, goal.deadline));
    const expected = Math.max(0, Math.min(1, this.daysBetween(start, today) / total));
    const progress = this.goalProgress(goal, tasks);
    return { daysLeft: this.daysBetween(today, goal.deadline), expected, onTrack: progress + 0.05 >= expected };
  },

  // ================= School (NCEA) =================
  STATUSES: ["Not started", "In progress", "Submitted", "Achieved", "Merit", "Excellence", "Not achieved"],
  PASS: ["Achieved", "Merit", "Excellence"],
  isPassed(s) { return this.PASS.includes(s.status); },
  isFinished(s) { return ["Submitted", "Achieved", "Merit", "Excellence", "Not achieved"].includes(s.status); },
  // Per level: credits gained, the A/M/E split, and credits still to come
  credits(standards) {
    const out = {};
    for (const s of standards) {
      const lv = String(s.level || 1);
      const c = Number(s.credits) || 0;
      const L = out[lv] || (out[lv] = { level: lv, gained: 0, A: 0, M: 0, E: 0, pending: 0, notAchieved: 0, count: 0 });
      L.count++;
      if (s.status === "Achieved") { L.gained += c; L.A += c; }
      else if (s.status === "Merit") { L.gained += c; L.M += c; }
      else if (s.status === "Excellence") { L.gained += c; L.E += c; }
      else if (s.status === "Not achieved") L.notAchieved += c;
      else L.pending += c;
    }
    return out;
  },
  // Not yet handed in, due within `days` (overdue ones included), soonest first
  dueStandards(standards, today, days) {
    const last = this.addDays(today, days);
    return standards.filter((s) => s.due && !this.isFinished(s) && s.due <= last)
      .sort((a, b) => (a.due < b.due ? -1 : 1));
  },

  // ================= Sleep =================
  minutes(t) { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + m; },
  // Hours between bedtime and wake time; past midnight is handled (23:30 → 07:00 = 7.5h)
  sleepHours(bed, wake) {
    if (!bed || !wake) return 0;
    let diff = this.minutes(wake) - this.minutes(bed);
    if (diff <= 0) diff += 1440;
    return diff / 60;
  },
  // Average of clock times around midnight: 23:00 and 01:00 average to 00:00, not 12:00.
  // Times are measured from noon so the night doesn't wrap.
  avgClock(times) {
    if (!times.length) return null;
    const fromNoon = times.map((t) => (this.minutes(t) - 720 + 1440) % 1440);
    const avg = Math.round(this.sum(fromNoon) / fromNoon.length);
    const m = (avg + 720) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  },
  // Averages over the last `days` nights (date = the morning you woke up)
  sleepStats(sleep, today, days) {
    const from = this.addDays(today, -(days - 1));
    const list = sleep.filter((s) => s.date >= from && s.date <= today);
    return {
      nights: list.length,
      hours: list.length ? this.sum(list, (s) => this.sleepHours(s.bed, s.wake)) / list.length : null,
      bedtime: this.avgClock(list.map((s) => s.bed)),
      quality: list.length ? this.sum(list, (s) => Number(s.quality) || 0) / list.length : null,
    };
  },
  // One slot per night for the chart, oldest first; entry null when not logged
  lastNights(sleep, today, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const date = this.addDays(today, -i);
      const entry = sleep.find((s) => s.date === date) || null;
      out.push({ date, entry, hours: entry ? this.sleepHours(entry.bed, entry.wake) : null });
    }
    return out;
  },

  // ================= Fitness =================
  // Estimated 1-rep max (Epley): the most you could probably lift once
  e1rm(kg, reps) {
    kg = Number(kg) || 0; reps = Number(reps) || 0;
    if (!kg || !reps) return 0;
    return reps === 1 ? kg : kg * (1 + reps / 30);
  },
  sortWorkouts(list) { return list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created || 0) - (b.created || 0))); },
  // Exercise names, most recently used first
  exerciseNames(workouts) {
    const seen = new Map();
    for (const w of this.sortWorkouts(workouts).reverse()) {
      for (const e of w.exercises || []) {
        const key = e.name.trim().toLowerCase();
        if (key && !seen.has(key)) seen.set(key, e.name.trim());
      }
    }
    return [...seen.values()];
  },
  // The sets from the last time this exercise was done (for pre-filling)
  lastSets(workouts, name, excludeId) {
    const key = name.trim().toLowerCase();
    for (const w of this.sortWorkouts(workouts).reverse()) {
      if (w.id === excludeId) continue;
      const e = (w.exercises || []).find((x) => x.name.trim().toLowerCase() === key);
      if (e && e.sets && e.sets.length) return e.sets.map((s) => ({ reps: s.reps, kg: s.kg }));
    }
    return null;
  },
  // Best of one exercise entry: heaviest weight and best estimated 1RM
  bestOf(e) {
    let kg = 0, e1 = 0;
    for (const s of e.sets || []) {
      if (!(Number(s.reps) > 0)) continue;
      kg = Math.max(kg, Number(s.kg) || 0);
      e1 = Math.max(e1, this.e1rm(s.kg, s.reps));
    }
    return { kg, e1 };
  },
  // Personal records per exercise, replaying workouts oldest first. Also marks
  // which workout beat a record (prs: { workoutId: ["Bench press", ...] }).
  records(workouts) {
    const best = {}, prs = {};
    for (const w of this.sortWorkouts(workouts)) {
      for (const e of w.exercises || []) {
        const key = e.name.trim().toLowerCase();
        if (!key) continue;
        const b = this.bestOf(e);
        if (!b.kg && !b.e1) continue;
        const r = best[key];
        if (r && (b.kg > r.kg + 1e-9 || b.e1 > r.e1 + 1e-9)) (prs[w.id] = prs[w.id] || []).push(e.name.trim());
        if (!r) best[key] = { name: e.name.trim(), kg: b.kg, kgDate: w.date, e1: b.e1, e1Date: w.date, sessions: 1 };
        else {
          r.sessions++;
          if (b.kg > r.kg) { r.kg = b.kg; r.kgDate = w.date; }
          if (b.e1 > r.e1) { r.e1 = b.e1; r.e1Date = w.date; }
        }
      }
    }
    return { best: Object.values(best).sort((a, b) => a.name.localeCompare(b.name)), prs };
  },
  // Workouts per week (Monday-first), oldest first, ending this week
  weeklyWorkouts(workouts, today, weeks = 12) {
    const out = [];
    const thisWeek = this.weekStart(today);
    for (let i = weeks - 1; i >= 0; i--) {
      const start = this.addDays(thisWeek, -i * 7), end = this.addDays(start, 6);
      const list = workouts.filter((w) => w.date >= start && w.date <= end);
      out.push({ start, count: list.length, minutes: this.sum(list, (w) => Number(w.minutes) || 0) });
    }
    return out;
  },
};
