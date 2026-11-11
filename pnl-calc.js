// ---------- PnL calculations ----------
// Every number on the PnL pages is worked out here, so totals always agree.
// Nothing in this file touches the screen or storage: each function takes the
// data and returns numbers. Totals are never saved; they're recalculated fresh
// from the raw entries, so editing or deleting an entry updates everything.

const Calc = {
  // The OLD fixed selling-price tiers. Only used to read products saved before
  // flexible tiers existed (prices: { t1, t5, t10 }).
  TIERS: [
    { key: "t1", label: "1–4", min: 1 },
    { key: "t5", label: "5–9", min: 5 },
    { key: "t10", label: "10+", min: 10 },
  ],

  // ---- Small helpers ----
  round2(n) { return Math.round((Number(n) || 0) * 100) / 100; },
  sum(list, fn) { return list.reduce((total, x) => total + (fn ? fn(x) : x), 0); },

  // ---- Dates ----
  // Dates are stored as "YYYY-MM-DD" text: easy to read and sorts correctly.
  today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },
  toUTC(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); },
  fromUTC(ms) { return new Date(ms).toISOString().slice(0, 10); },
  daysBetween(from, to) { return Math.round((this.toUTC(to) - this.toUTC(from)) / 86400000); },
  monthOf(s) { return String(s || "").slice(0, 7); },

  // The k-th repeat of a recurring expense that started on `start` (k = 0 is the start).
  // Monthly repeats keep the same day of the month, or the last day if the month is shorter.
  nthOccurrence(start, freq, k) {
    if (freq === "weekly") return this.fromUTC(this.toUTC(start) + k * 7 * 86400000);
    const [y, m, d] = start.split("-").map(Number);
    const months = m - 1 + k;
    const year = y + Math.floor(months / 12);
    const month = months % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return this.fromUTC(Date.UTC(year, month, Math.min(d, lastDay)));
  },
  // How many repeats (after the start) fall on or before `date`
  occurrencesUpTo(start, freq, date) {
    let k = 0;
    while (this.nthOccurrence(start, freq, k + 1) <= date) k++;
    return k;
  },

  // ---- Orders ----
  // Total paid for the whole order. Orders store one `total`; older entries
  // stored unit cost + shipping + fees, which still add up the same way.
  orderTotal(o) {
    if (o.total !== undefined && o.total !== null) return Number(o.total) || 0;
    return (Number(o.unitCost) || 0) * (Number(o.qty) || 0) + (Number(o.shipping) || 0) + (Number(o.fees) || 0);
  },
  // Landed cost per unit. Once received, the full cost is spread over the units
  // that actually arrived (so damaged/missing units raise the cost of the rest).
  landedUnitCost(o) {
    const units = o.receivedDate ? Number(o.receivedQty) : Number(o.qty);
    return units > 0 ? this.orderTotal(o) / units : 0;
  },

  // ---- Prices (quantity tiers) ----
  // Each product has its own list of tiers: "from `min` units → `price` per unit".
  // Older products stored three fixed prices { t1, t5, t10 }; those are read as
  // tiers from 1, 5 and 10 (Store also converts them when data is loaded).
  productTiers(product) {
    if (!product) return [];
    let list = product.tiers;
    if (!Array.isArray(list)) {
      const old = product.prices || {};
      list = this.TIERS.map((t) => ({ min: t.min, price: old[t.key] }));
    }
    return list
      .filter((t) => t && t.price !== null && t.price !== undefined && t.price !== "" && Number(t.min) >= 1)
      .map((t) => ({ min: Math.floor(Number(t.min)), price: Number(t.price) }))
      .sort((a, b) => a.min - b.min);
  },
  // The tier a sale of `qty` units uses: the one with the highest "from" qty
  // that the sale reaches (e.g. 120 units → the 100+ tier). null if none.
  tierFor(product, qty) {
    let found = null;
    for (const t of this.productTiers(product)) if (qty >= t.min) found = t;
    return found;
  },
  tierPrice(product, qty) {
    const t = this.tierFor(product, qty);
    return t ? t.price : null;
  },
  // "1–9", "10–49", "500+" for the tier starting at `min` in `tiers`
  tierRange(tiers, min) {
    const next = tiers.find((t) => t.min > min);
    if (!next) return `${min}+`;
    return next.min - 1 === min ? String(min) : `${min}–${next.min - 1}`;
  },
  // Margin per unit and margin % (of the price) for a price, given the cost
  // per unit. Both null when the cost isn't known yet.
  margin(price, cost) {
    if (cost === null || cost === undefined) return { perUnit: null, pct: null };
    const perUnit = price - cost;
    return { perUnit, pct: price > 0 ? (perUnit / price) * 100 : null };
  },

  // ---- Sales ----
  // A sale stores its price per unit; when it was entered as a total for the
  // whole lot (e.g. 500 units for $10,000) it also stores `total`, which wins,
  // so odd per-unit prices (e.g. $33.333…) never cause rounding gaps.
  saleRevenue(s) {
    if (s.total !== undefined && s.total !== null && s.total !== "") return Number(s.total) || 0;
    return (Number(s.unitPrice) || 0) * (Number(s.qty) || 0);
  },
  saleUnitPrice(s) { return Number(s.qty) > 0 ? this.saleRevenue(s) / Number(s.qty) : Number(s.unitPrice) || 0; },
  // "Paid later" sales count as sales straight away (stock leaves, profit
  // counts) but only bring money in through their payments.
  salePaid(s) {
    if (!s.paidLater) return this.saleRevenue(s);
    return this.sum(s.payments || [], (p) => Number(p.amount) || 0);
  },
  saleOwed(s) { return s.paidLater ? Math.max(0, this.round2(this.saleRevenue(s) - this.salePaid(s))) : 0; },
  // Unpaid sales, oldest first: { sale, owed, overdue, days (since the sale) }
  owedList(data, today) {
    return data.sales
      .filter((s) => this.saleOwed(s) > 0)
      .map((s) => ({
        sale: s,
        owed: this.saleOwed(s),
        overdue: !!(s.dueDate && s.dueDate < today),
        days: this.daysBetween(s.date, today),
      }))
      .sort((a, b) => (a.sale.date < b.sale.date ? -1 : a.sale.date > b.sale.date ? 1 : 0));
  },
  saleCost(s, snap) { return snap.inv.saleCogs[s.id] || 0; },
  // Expected cost of goods for a sale not saved yet (used by the forms' previews)
  estimateSaleCost(snap, productId, qty) {
    const st = snap.inv.byProduct[productId];
    return st ? st.avgCost * (Number(qty) || 0) : 0;
  },
  saleProfit(s, snap) { return this.saleRevenue(s) - this.saleCost(s, snap); },

  // ---- Inventory (weighted average cost) ----
  // Replays every receipt and sale in date order, per product:
  //  - a receipt adds its units and their full cost to the pool
  //  - a sale takes units out at the pool's current average cost per unit
  //  - a stock adjustment ("Set stock") adds units at the cost you enter,
  //    or removes units at the current average cost (no money moves)
  // Returns stock per product, the cost of goods for every sale, and any
  // product whose stock would drop below zero (used to block impossible entries).
  inventory(data) {
    const events = [];
    for (const o of data.orders) {
      if (o.receivedDate) {
        events.push({ date: o.receivedDate, order: 0, productId: o.productId, qty: Number(o.receivedQty) || 0, cost: this.orderTotal(o), fromOrder: true });
      }
    }
    for (const a of data.stockAdjustments || []) {
      const q = Number(a.qty) || 0;
      if (q > 0) events.push({ date: a.date, order: 0, productId: a.productId, qty: q, cost: q * (Number(a.unitCost) || 0) });
      else if (q < 0) events.push({ date: a.date, order: 1, productId: a.productId, qty: -q });
    }
    for (const s of data.sales) {
      events.push({ date: s.date, order: 1, productId: s.productId, qty: Number(s.qty) || 0, saleId: s.id });
    }
    // Same day: units coming in count before units going out
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

    const pools = {};
    const saleCogs = {};
    const shortages = {};
    for (const e of events) {
      const pool = pools[e.productId] || (pools[e.productId] = { qty: 0, value: 0, lastAvg: 0, batches: 0 });
      if (e.order === 0) {
        pool.qty += e.qty;
        pool.value += e.cost;
        if (e.fromOrder) pool.batches += 1;
        if (pool.qty > 0) pool.lastAvg = pool.value / pool.qty;
      } else {
        const avg = pool.qty > 0 ? pool.value / pool.qty : pool.lastAvg;
        if (e.saleId) saleCogs[e.saleId] = avg * e.qty;
        pool.qty -= e.qty;
        pool.value -= avg * e.qty;
        if (pool.qty <= 0) pool.value = 0;
        if (pool.qty < 0 && !shortages[e.productId]) shortages[e.productId] = { date: e.date, short: -pool.qty };
      }
    }
    const byProduct = {};
    for (const id in pools) {
      const p = pools[id];
      byProduct[id] = { qty: p.qty, value: p.qty > 0 ? p.value : 0, avgCost: p.qty > 0 ? p.value / p.qty : p.lastAvg, batches: p.batches };
    }
    return { byProduct, saleCogs, shortages };
  },

  // ---- Days to sell ----
  // How long stock sits before it sells. Separate from the cost maths above:
  // for timing, units are assumed to sell oldest first (first in, first out).
  // Arrivals = received orders (received date) and stock added with Set stock
  // (adjustment date). Each unit sold counts the days from its arrival to the
  // sale; units removed by Set stock just leave without counting.
  // Returns per product: { avgDays (null if nothing sold yet), unitsTimed,
  //   unsold, oldestDate, oldestDays (null if none in stock) }
  sellTimes(data, today) {
    const events = [];
    for (const o of data.orders) {
      if (o.receivedDate) events.push({ date: o.receivedDate, order: 0, productId: o.productId, qty: Number(o.receivedQty) || 0 });
    }
    for (const a of data.stockAdjustments || []) {
      const q = Number(a.qty) || 0;
      if (q > 0) events.push({ date: a.date, order: 0, productId: a.productId, qty: q });
      else if (q < 0) events.push({ date: a.date, order: 1, productId: a.productId, qty: -q });
    }
    for (const s of data.sales) events.push({ date: s.date, order: 1, productId: s.productId, qty: Number(s.qty) || 0, sale: true });
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

    const lots = {};   // productId → [{ date, qty }] oldest first
    const timed = {};  // productId → { units, unitDays }
    for (const e of events) {
      const list = lots[e.productId] || (lots[e.productId] = []);
      const t = timed[e.productId] || (timed[e.productId] = { units: 0, unitDays: 0 });
      if (e.order === 0) { if (e.qty > 0) list.push({ date: e.date, qty: e.qty }); continue; }
      let left = e.qty;
      while (left > 0 && list.length) {
        const lot = list[0];
        const take = Math.min(left, lot.qty);
        if (e.sale) { t.units += take; t.unitDays += take * this.daysBetween(lot.date, e.date); }
        lot.qty -= take;
        left -= take;
        if (lot.qty === 0) list.shift();
      }
    }
    const out = {};
    for (const p of data.products) {
      const list = lots[p.id] || [];
      const t = timed[p.id] || { units: 0, unitDays: 0 };
      const oldestDate = list.length ? list[0].date : null;
      out[p.id] = {
        avgDays: t.units ? t.unitDays / t.units : null,
        unitsTimed: t.units,
        unsold: this.sum(list, (l) => l.qty),
        oldestDate,
        oldestDays: oldestDate ? Math.max(0, this.daysBetween(oldestDate, today)) : null,
      };
    }
    return out;
  },
  // The product with the oldest unsold stock: { productId, days } or null
  oldestStock(times) {
    let best = null;
    for (const id in times) {
      const d = times[id].oldestDays;
      if (d !== null && (!best || d > best.days)) best = { productId: id, days: d };
    }
    return best;
  },
  // Slowest sellers first. Ranked by the longer of: average days to sell, and
  // the age of the oldest unsold stock (so stock that's stuck shows up too).
  slowestSellers(times, n = 5) {
    return Object.entries(times)
      .map(([productId, t]) => ({ productId, ...t, slowness: Math.max(t.avgDays ?? 0, t.oldestDays ?? 0) }))
      .filter((x) => x.avgDays !== null || x.oldestDays !== null)
      .sort((a, b) => b.slowness - a.slowness)
      .slice(0, n);
  },

  // Current landed cost per unit for a product: the stock average if known,
  // otherwise the newest incoming order's landed cost, otherwise unknown (null).
  currentUnitCost(data, snap, productId) {
    const st = snap.inv.byProduct[productId];
    if (st && st.avgCost > 0) return st.avgCost;
    const incoming = data.orders
      .filter((o) => o.productId === productId && !o.receivedDate)
      .sort((a, b) => (a.orderDate < b.orderDate ? 1 : -1));
    return incoming.length ? this.landedUnitCost(incoming[0]) : null;
  },

  // ---- Accounts ----
  // Balance = starting balance + sales in − orders out − expenses out ± transfers/adjustments
  balances(data) {
    const b = {};
    for (const a of data.accounts) b[a.id] = Number(a.opening) || 0;
    const add = (id, amount) => { if (id in b) b[id] += amount; };
    for (const o of data.orders) add(o.accountId, -this.orderTotal(o));
    for (const s of data.sales) {
      if (s.paidLater) for (const p of s.payments || []) add(p.accountId, Number(p.amount) || 0);
      else add(s.accountId, this.saleRevenue(s));
    }
    for (const e of data.expenses) add(e.accountId, -(Number(e.amount) || 0));
    for (const t of data.transfers) {
      if (t.type === "adjust") add(t.accountId, Number(t.amount) || 0);
      else { add(t.fromId, -(Number(t.amount) || 0)); add(t.toId, Number(t.amount) || 0); }
    }
    return b;
  },

  // ---- Everything at once (computed once per screen refresh) ----
  snapshot(data) {
    const inv = this.inventory(data);
    const balances = this.balances(data);
    const cashTotal = this.sum(Object.values(balances));
    let stockValue = 0, stockUnits = 0;
    for (const id in inv.byProduct) {
      const st = inv.byProduct[id];
      if (st.qty > 0) { stockValue += st.value; stockUnits += st.qty; }
    }
    const incoming = data.orders.filter((o) => !o.receivedDate);
    const onTheWayValue = this.sum(incoming, (o) => this.orderTotal(o));
    const onTheWayUnits = this.sum(incoming, (o) => Number(o.qty) || 0);
    const owedTotal = this.sum(data.sales, (s) => this.saleOwed(s));
    return {
      inv, balances, cashTotal, stockValue, stockUnits, onTheWayValue, onTheWayUnits, owedTotal,
      capital: cashTotal + stockValue + owedTotal, // stock on the way is not counted
    };
  },

  // ---- Profit for a month ("YYYY-MM") or all time (month = null) ----
  periodStats(data, snap, month) {
    const inPeriod = (date) => !month || this.monthOf(date) === month;
    const sales = data.sales.filter((s) => inPeriod(s.date));
    const revenue = this.sum(sales, (s) => this.saleRevenue(s));
    const cogs = this.sum(sales, (s) => this.saleCost(s, snap));
    const expenses = this.sum(data.expenses.filter((e) => inPeriod(e.date)), (e) => Number(e.amount) || 0);
    return {
      revenue, cogs, expenses,
      gross: revenue - cogs,
      net: revenue - cogs - expenses,
      units: this.sum(sales, (s) => Number(s.qty) || 0),
    };
  },

  // "YYYY-MM" moved by k months (k can be negative)
  addMonths(month, k) {
    const [y, m] = month.split("-").map(Number);
    const total = y * 12 + (m - 1) + k;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  },
  // Profit figures for the `n` months ending with `endMonth`, oldest first (for the chart)
  monthlyStats(data, snap, endMonth, n = 12) {
    const out = [];
    for (let k = n - 1; k >= 0; k--) {
      const month = this.addMonths(endMonth, -k);
      out.push({ month, ...this.periodStats(data, snap, month) });
    }
    return out;
  },

  // Totals per category for a list of expenses, biggest first
  categoryTotals(expenses) {
    const totals = {};
    for (const e of expenses) totals[e.category] = (totals[e.category] || 0) + (Number(e.amount) || 0);
    return Object.entries(totals)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
  },

  // Per-product totals (all time). Net profit also subtracts expenses linked to the product.
  productStats(data, snap) {
    const stats = {};
    for (const p of data.products) stats[p.id] = { id: p.id, name: p.name, unitsSold: 0, revenue: 0, cogs: 0, expenses: 0 };
    for (const s of data.sales) {
      const st = stats[s.productId];
      if (!st) continue;
      st.unitsSold += Number(s.qty) || 0;
      st.revenue += this.saleRevenue(s);
      st.cogs += this.saleCost(s, snap);
    }
    for (const e of data.expenses) {
      if (e.productId && stats[e.productId]) stats[e.productId].expenses += Number(e.amount) || 0;
    }
    return Object.values(stats).map((st) => ({ ...st, gross: st.revenue - st.cogs, net: st.revenue - st.cogs - st.expenses }));
  },
};
