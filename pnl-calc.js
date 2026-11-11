// ---------- PnL calculations ----------
// Every number on the PnL pages is worked out here, so totals always agree.
// Nothing in this file touches the screen or storage: each function takes the
// data and returns numbers. Totals are never saved; they're recalculated fresh
// from the raw entries, so editing or deleting an entry updates everything.

const Calc = {
  // Selling-price tiers (by quantity in one sale)
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

  // ---- Prices ----
  tierFor(qty) {
    let tier = this.TIERS[0];
    for (const t of this.TIERS) if (qty >= t.min) tier = t;
    return tier;
  },
  tierPrice(product, qty) {
    if (!product || !product.prices) return null;
    const v = product.prices[this.tierFor(qty).key];
    return v === null || v === undefined || v === "" ? null : Number(v);
  },

  // ---- Sales ----
  saleRevenue(s) { return (Number(s.unitPrice) || 0) * (Number(s.qty) || 0); },
  saleCost(s, snap) { return snap.inv.saleCogs[s.id] || 0; },
  saleProfit(s, snap) { return this.saleRevenue(s) - this.saleCost(s, snap); },

  // ---- Inventory (weighted average cost) ----
  // Replays every receipt and sale in date order, per product:
  //  - a receipt adds its units and their full cost to the pool
  //  - a sale takes units out at the pool's current average cost per unit
  // Returns stock per product, the cost of goods for every sale, and any
  // product whose stock would drop below zero (used to block impossible entries).
  inventory(data) {
    const events = [];
    for (const o of data.orders) {
      if (o.receivedDate) {
        events.push({ date: o.receivedDate, order: 0, productId: o.productId, qty: Number(o.receivedQty) || 0, cost: this.orderTotal(o) });
      }
    }
    for (const s of data.sales) {
      events.push({ date: s.date, order: 1, productId: s.productId, qty: Number(s.qty) || 0, saleId: s.id });
    }
    // Same day: receipts count before sales
    events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

    const pools = {};
    const saleCogs = {};
    const shortages = {};
    for (const e of events) {
      const pool = pools[e.productId] || (pools[e.productId] = { qty: 0, value: 0, lastAvg: 0, batches: 0 });
      if (e.order === 0) {
        pool.qty += e.qty;
        pool.value += e.cost;
        pool.batches += 1;
        if (pool.qty > 0) pool.lastAvg = pool.value / pool.qty;
      } else {
        const avg = pool.qty > 0 ? pool.value / pool.qty : pool.lastAvg;
        saleCogs[e.saleId] = avg * e.qty;
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
    for (const s of data.sales) add(s.accountId, this.saleRevenue(s));
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
    return {
      inv, balances, cashTotal, stockValue, stockUnits, onTheWayValue, onTheWayUnits,
      capital: cashTotal + stockValue + onTheWayValue,
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
