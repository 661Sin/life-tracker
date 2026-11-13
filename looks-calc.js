// ---------- Looksmax calculations ----------
// Every number on the Looksmax pages is worked out here: streaks, consistency,
// the heatmap, progress, days left, which photos are first / latest.
// Nothing here touches the screen or storage. Check-ins work exactly like Life
// habits (same schedule shapes, same "done" list of dates), so the streak
// maths is LifeCalc's: an item is handed to it dressed up as a habit.

const LooksCalc = {
  // The item as LifeCalc sees it. Its history starts on its start date (or the
  // day it was made); a finished item stops counting the day after it was finished.
  asHabit(it) {
    return {
      id: it.id, name: it.name, emoji: it.emoji,
      schedule: it.schedule || { type: "daily" },
      done: it.done || [],
      created: it.start || it.created || LifeCalc.today(),
      archived: it.finished ? LifeCalc.addDays(it.finished, 1) : undefined,
    };
  },
  // Numbers for a finished item are frozen on the day it was finished
  asOf(it, today = LifeCalc.today()) { return it.finished && it.finished < today ? it.finished : today; },

  active(data) { return data.items.filter((it) => !it.finished); },
  finished(data) { return data.items.filter((it) => it.finished).sort((a, b) => (a.finished < b.finished ? 1 : -1)); },

  isWeekly(it) { return LifeCalc.isWeekly(this.asHabit(it)); },
  isDone(it, date) { return (it.done || []).includes(date); },
  streak(it, today) { return LifeCalc.streak(this.asHabit(it), this.asOf(it, today)); },
  bestStreak(it, today) { return LifeCalc.bestStreak(this.asHabit(it), this.asOf(it, today)); },
  // % of the last 30 days it was worked on (only the days it was scheduled)
  consistency(it, today, days = 30) { return LifeCalc.completion(this.asHabit(it), this.asOf(it, today), days); },
  heatmap(it, today, weeks = 12) { return LifeCalc.heatmap(this.asHabit(it), today, weeks); },
  weekCount(it, date) { return LifeCalc.weekCount(this.asHabit(it), date); },
  weeklyTarget(it) { return LifeCalc.weeklyTarget(this.asHabit(it)); },

  // Wanted today: not finished, already started, and scheduled (weekly ones
  // until this week's target is reached, or when ticked today)
  dueOn(it, date) {
    const h = this.asHabit(it);
    if (it.finished && date > it.finished) return false;
    if (date < h.created && !this.isDone(it, date)) return false;
    if (LifeCalc.isWeekly(h)) return LifeCalc.weekCount(h, date) < LifeCalc.weeklyTarget(h) || this.isDone(it, date);
    return LifeCalc.isScheduled(h, date);
  },
  dueToday(data, today) { return this.active(data).filter((it) => this.dueOn(it, today)); },

  // Tick / untick a day. Unticking also forgets which actions were done that day.
  toggle(it, date) {
    const was = this.isDone(it, date);
    it.done = was ? it.done.filter((d) => d !== date) : [...(it.done || []), date].sort();
    if (was && it.didActions) delete it.didActions[date];
    return !was;
  },
  // Tick / untick one action for a day (ticking any action also ticks the day)
  toggleAction(it, date, actionId) {
    const map = it.didActions || (it.didActions = {});
    const list = map[date] || [];
    const next = list.includes(actionId) ? list.filter((a) => a !== actionId) : [...list, actionId];
    if (next.length) map[date] = next; else delete map[date];
    if (next.length && !this.isDone(it, date)) it.done = [...(it.done || []), date].sort();
  },
  actionsDone(it, date) { return ((it.didActions || {})[date] || []).filter((id) => (it.actions || []).some((a) => a.id === id)); },

  // ================= Progress (0–100, updated by hand) =================
  progressPoints(it) {
    return (it.progress || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .map((p) => ({ date: p.date, value: Math.max(0, Math.min(100, Number(p.value) || 0)) }));
  },
  progress(it) { const p = this.progressPoints(it); return p.length ? p[p.length - 1].value : 0; },

  // ================= Dates =================
  daysLeft(it, today) { return it.target ? LifeCalc.daysBetween(today, it.target) : null; },
  daysIn(it, today) { const from = it.start || it.created; return from ? LifeCalc.daysBetween(from, this.asOf(it, today)) : null; },

  // ================= Photos =================
  // Newest first (by the date given to the photo, then by when it was added)
  photos(it) {
    return (it.photos || []).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0)));
  },
  latestPhoto(it) { return this.photos(it)[0] || null; },
  firstPhoto(it) { const p = this.photos(it); return p[p.length - 1] || null; },
  mediaOfPhoto(p) { return p ? [...new Set([p.full, p.thumb].filter(Boolean))] : []; },
  mediaOf(it) { return (it.photos || []).flatMap((p) => this.mediaOfPhoto(p)); },

  // Log entries, newest first
  log(it) { return (it.log || []).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.created || 0) - (a.created || 0))); },

  // ================= Day score =================
  // What Life's day score needs: every item as a habit (LifeCalc.dayScore
  // counts them the same way it counts habits, as their own part).
  habits(data) { return data.items.map((it) => this.asHabit(it)); },
};
