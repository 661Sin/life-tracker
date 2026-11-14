// ---------- PnL screens ----------
// Draws the PnL sub-pages and handles their forms, edits and deletes.
// Data comes from Store (pnl-store.js); every number comes from Calc (pnl-calc.js).
// Sub-pages live in the URL hash: #pnl/dashboard, #pnl/products, #pnl/orders, ...

(function () {
  const root = document.getElementById("pnl-root");
  if (!root) return;

  const VIEWS = [
    ["dashboard", "Dashboard"],
    ["products", "Products"],
    ["orders", "On the way"],
    ["stock", "In hand"],
    ["sales", "Sales"],
    ["spent", "Spent"],
    ["accounts", "Accounts"],
  ];
  let view = "dashboard";
  const spentFilter = { month: Calc.monthOf(Calc.today()), category: "" };

  // ================= Formatting helpers =================
  const NZD = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });
  const money = (n) => NZD.format(Calc.round2(n) || 0); // "|| 0" avoids showing -$0.00
  const signed = (n) => (Calc.round2(n) > 0 ? "+" : "") + money(n);
  const tone = (n) => (Calc.round2(n) > 0 ? "pos" : Calc.round2(n) < 0 ? "neg" : "");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (v === "" || v == null ? 0 : Number(v));
  const optNum = (v) => (v === "" || v == null ? null : Number(v));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const DATE_FMT = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const MONTH_FMT = new Intl.DateTimeFormat("en-NZ", { month: "long", year: "numeric", timeZone: "UTC" });
  const fmtDate = (s) => (s ? DATE_FMT.format(Calc.toUTC(s)) : "—");
  const fmtMonth = (m) => MONTH_FMT.format(Calc.toUTC(m + "-01"));
  const byName = (a, b) => a.name.localeCompare(b.name);
  const days = (n) => (n === null || n === undefined ? "—" : plural(Math.round(n), "day"));

  const productName = (id) => { const p = Store.get("products", id); return p ? p.name : "(deleted product)"; };
  const accountName = (id) => { const a = Store.get("accounts", id); return a ? a.name : "(deleted account)"; };
  const isDeposit = (t) => t.type === "transfer" && t.fromId === CASH_ID && t.toId === BANK_ID;
  const isUsedAccount = (id) => {
    const d = Store.data;
    return d.orders.some((x) => x.accountId === id) ||
      d.sales.some((x) => x.accountId === id || (x.payments || []).some((p) => p.accountId === id)) ||
      d.expenses.some((x) => x.accountId === id) ||
      d.transfers.some((x) => x.accountId === id || x.fromId === id || x.toId === id);
  };
  function upsertIn(list, item) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
  }
  function removeFrom(list, id) {
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list.splice(i, 1);
  }

  // ================= HTML building blocks =================
  const btn = (label, action, id = "", cls = "") =>
    `<button type="button" class="btn ${cls}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}>${label}</button>`;
  // ⋯ menu: items = [[label, action, id?]]
  const moreMenu = (items) => !items.length ? "" : `
    <div class="menu-wrap">
      <button type="button" class="btn btn-ghost btn-icon" data-action="menu" aria-label="More options" aria-haspopup="true" aria-expanded="false">⋯</button>
      <div class="menu card" hidden>${items.map(([label, action, id]) =>
        `<button type="button" class="menu-item" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}>${label}</button>`).join("")}</div>
    </div>`;
  // Page title with ⋯ (secondary actions) and the page's one orange action
  const sectionHead = (title, primary = "", menu = []) =>
    `<div class="section-head"><h2>${title}</h2><div class="section-actions">${moreMenu(menu)}${primary}</div></div>`;
  const stat = (label, value, sub = "", cls = "") =>
    `<div class="card stat"><div class="stat-label">${label}</div><div class="stat-value ${cls}">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ""}</div>`;
  const muted = (text) => (text ? `<div class="muted">${text}</div>` : "");
  const badge = (text, cls = "") => `<span class="badge ${cls}">${text}</span>`;
  const empty = (text) => `<div class="card empty">${text}</div>`;

  // cols: [{ label, num? }], rows: [{ cells: [html...], cls?, action?, id? }]
  // A row with an action is tapped to open it (no Edit / Delete buttons on rows).
  function table(cols, rows, emptyText) {
    if (!rows.length) return empty(emptyText);
    const head = cols.map((c) => `<th class="${c.num ? "num" : ""}">${c.label}</th>`).join("");
    const body = rows.map((r) => `<tr class="${r.cls || ""}${r.action ? " tap" : ""}"${r.action
      ? ` data-action="${r.action}" data-id="${esc(r.id)}" tabindex="0" role="button"` : ""}>${r.cells.map((cell, i) =>
      `<td data-label="${cols[i].label}" class="${cols[i].num ? "num" : ""}${cols[i].label ? "" : " actions"}"><div class="cell">${cell}</div></td>`).join("")}</tr>`).join("");
    return `<div class="card table-card"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // ---- Form fields ----
  const field = (label, control, hint = "") =>
    `<label class="field"><span class="field-label">${label}</span>${control}${hint ? `<span class="field-hint">${hint}</span>` : ""}</label>`;
  const row = (...fields) => `<div class="form-row">${fields.join("")}</div>`;
  const moneyInput = (name, value, extra = "") =>
    `<input name="${name}" type="number" step="0.01" min="0" inputmode="decimal" value="${value ?? ""}" ${extra}>`;
  const qtyInput = (name, value, extra = "", min = 1) =>
    `<input name="${name}" type="number" step="1" min="${min}" inputmode="numeric" value="${value ?? ""}" ${extra}>`;
  const dateInput = (name, value, extra = "") => `<input name="${name}" type="date" value="${value || ""}" ${extra}>`;
  const textInput = (name, value, extra = "") => `<input name="${name}" type="text" value="${esc(value)}" ${extra}>`;
  const textArea = (name, value) => `<textarea name="${name}" rows="2">${esc(value)}</textarea>`;
  const select = (name, options, selected, extra = "") =>
    `<select name="${name}" ${extra}>${options.map(([v, t]) => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  const productOptions = (blank) => [...(blank ? [["", blank]] : []), ...Store.data.products.slice().sort(byName).map((p) => [p.id, p.name])];
  const accountOptions = () => Store.data.accounts.map((a) => [a.id, a.name]);
  // "Paid from / into" picker (Cash, Bank or Crypto, default Cash). Hidden if only
  // one account exists, then everything goes to Cash.
  const accountField = (label, value) => Store.data.accounts.length > 1
    ? field(label, select("accountId", accountOptions(), value))
    : `<input type="hidden" name="accountId" value="${esc(value || CASH_ID)}">`;

  // Opens a form in the shared modal. onSubmit(values, form) returns an error
  // message to show, or nothing on success (then the modal closes and the page redraws).
  // opts.onDelete: adds a Delete button at the bottom (asks first), e.g. when editing an entry.
  // opts.extra: [[label, fn]] more buttons in the sheet (e.g. "Mark received…"), shown above the main buttons.
  function openForm(title, fieldsHtml, onSubmit, opts = {}) {
    const body = openModal(title, `
      <form class="form">
        ${fieldsHtml}
        <div class="form-error" hidden></div>
        ${opts.extra && opts.extra.length ? `<div class="form-extra">${opts.extra.map(([label], i) =>
          `<button type="button" class="btn btn-sm" data-form-extra="${i}">${label}</button>`).join("")}</div>` : ""}
        <div class="form-actions">
          ${opts.onDelete ? `<button type="button" class="btn btn-ghost danger form-delete" data-form-delete>Delete</button>` : ""}
          <button type="button" class="btn" data-close-modal>Cancel</button>
          <button type="submit" class="btn btn-primary">${opts.submitLabel || "Save"}</button>
        </div>
      </form>`);
    const form = body.querySelector("form");
    const errorBox = form.querySelector(".form-error");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      for (const k in values) if (typeof values[k] === "string") values[k] = values[k].trim();
      const error = onSubmit(values, form);
      if (error) {
        errorBox.textContent = error;
        errorBox.hidden = false;
        return;
      }
      closeModal();
      render();
      if (opts.after) opts.after();
    });
    form.addEventListener("click", (e) => {
      const x = e.target.closest("[data-form-extra]");
      if (x) opts.extra[Number(x.dataset.formExtra)][1]();
    });
    const del = form.querySelector("[data-form-delete]");
    if (del) del.addEventListener("click", () => {
      if (!opts.skipConfirm && !confirm(opts.confirmText || `Delete this ${opts.deleteWhat || "entry"}? This can't be undone.`)) return;
      const error = opts.onDelete();
      if (error === false) return; // cancelled (onDelete asked its own question)
      if (error) { errorBox.textContent = error; errorBox.hidden = false; return; }
      closeModal();
      render();
    });
    return form;
  }
  const formValues = (form) => Object.fromEntries(new FormData(form));

  function needProducts() {
    if (confirm("Add a product to your catalogue first. Go to Products now?")) location.hash = "#pnl/products";
  }
  function report(error) { if (error) alert(error); else render(); }

  // ================= Pages =================
  const PAGES = {};

  // ---------- Dashboard ----------
  PAGES.dashboard = (data, snap) => {
    const today = Calc.today();
    const month = Calc.monthOf(today);
    const m = Calc.periodStats(data, snap, month);
    const all = Calc.periodStats(data, snap, null);
    const cats = Calc.categoryTotals(data.expenses.filter((e) => Calc.monthOf(e.date) === month)).slice(0, 5);
    const sold = Calc.productStats(data, snap).filter((p) => p.unitsSold > 0);
    const best = sold.slice().sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 5);
    const profitable = sold.slice().sort((a, b) => b.net - a.net).slice(0, 5);
    const overdue = data.orders.filter((o) => !o.receivedDate && o.expectedDate && o.expectedDate < today).length;
    const slow = Calc.slowestSellers(Calc.sellTimes(data, today), 5).map((x) => ({ ...x, name: productName(x.productId) }));

    const rankList = (items, valueOf, labelOf, emptyText) => {
      if (!items.length) return `<p class="muted">${emptyText}</p>`;
      const max = Math.max(...items.map((x) => Math.abs(valueOf(x)))) || 1;
      return items.map((x) => `
        <div class="rank">
          <div class="rank-top"><span>${esc(x.name || x.category)}</span><span class="num">${labelOf(x)}</span></div>
          <div class="bar"><span style="width:${Math.max(2, (Math.abs(valueOf(x)) / max) * 100)}%"></span></div>
        </div>`).join("");
    };
    const period = (label, mVal, allVal, colour) =>
      stat(label, money(mVal), `All time: <span class="${colour ? tone(allVal) : ""}">${money(allVal)}</span>`, colour ? tone(mVal) : "");

    return `
      <button type="button" class="btn btn-primary btn-big" data-action="quick-sale">+ Sale</button>
      ${!data.products.length ? `<div class="card notice">Start in <a href="#pnl/products">Products</a>.</div>` : ""}
      ${overdue ? `<a class="card notice warn" href="#pnl/orders">${plural(overdue, "order")} overdue: check On the way</a>` : ""}
      <div class="card capital">
        <div class="stat-label">Total capital</div>
        <div class="capital-value">${money(snap.capital)}</div>
        <div class="capital-parts">
          <div><span class="muted">Cash</span><b>${money(snap.balances[CASH_ID] || 0)}</b></div>
          <div><span class="muted">Bank</span><b>${money(snap.balances[BANK_ID] || 0)}</b></div>
          <div><span class="muted">Crypto</span><b>${money(snap.balances[CRYPTO_ID] || 0)}</b></div>
          <div><span class="muted">Stock in hand</span><b>${money(snap.stockValue)}</b></div>
          <div><span class="muted">Owed to me</span><b>${money(snap.owedTotal)}</b></div>
        </div>
      </div>
      ${owedSection(Calc.owedList(data, today), snap.owedTotal)}
      ${profitChart(Calc.monthlyStats(data, snap, month, 12))}
      <h3 class="group-title">${fmtMonth(month)}</h3>
      <div class="stats">
        ${period("Revenue", m.revenue, all.revenue)}
        ${period("Gross profit", m.gross, all.gross, true)}
        ${period("Expenses", m.expenses, all.expenses)}
        ${period("Net profit", m.net, all.net, true)}
      </div>
      <div class="panels">
        <div class="card"><h3>Biggest expenses this month</h3>${rankList(cats, (c) => c.total, (c) => money(c.total), "No expenses this month.")}</div>
        <div class="card"><h3>Best sellers</h3>${rankList(best, (p) => p.unitsSold, (p) => plural(p.unitsSold, "unit"), "No sales yet.")}</div>
        <div class="card"><h3>Most profitable</h3>${rankList(profitable, (p) => p.net, (p) => `<span class="${tone(p.net)}">${money(p.net)}</span>`, "No sales yet.")}
          </div>
        <div class="card"><h3>Slowest sellers</h3>${rankList(slow, (x) => x.slowness,
          (x) => [x.avgDays === null ? "no sales" : `${Math.round(x.avgDays)}d avg`, x.oldestDays === null ? "" : `${x.oldestDays}d oldest`].filter(Boolean).join(" · "),
          "No stock or sales yet.")}
          </div>
      </div>`;
  };

  // ---------- Owed to me (Dashboard) ----------
  function owedSection(list, total) {
    if (!list.length) return "";
    const overdue = list.filter((x) => x.overdue).length;
    const rows = list.map(({ sale: s, owed, overdue: late, days }) => ({
      cls: late ? "overdue" : "", action: "mark-paid", id: s.id,
      cells: [
        `<b>${esc(s.buyer)}</b>${muted(`${esc(productName(s.productId))} × ${s.qty}`)}`,
        fmtDate(s.date) + muted(`${plural(days, "day")} ago`),
        !s.dueDate ? `<span class="muted">No due date</span>` : late ? badge(`Overdue since ${fmtDate(s.dueDate)}`, "warn") : fmtDate(s.dueDate),
        `<b>${money(owed)}</b>${Calc.salePaid(s) > 0 ? muted(`of ${money(Calc.saleRevenue(s))}`) : ""}`,
      ],
    }));
    return `<h3 class="group-title">Owed to me: ${money(total)}${overdue ? ` <span class="badge warn">${overdue} overdue</span>` : ""}</h3>` +
      table([{ label: "Buyer" }, { label: "Sold" }, { label: "Due" }, { label: "Owed", num: true }], rows, "");
  }

  // ---------- Monthly net profit chart (Dashboard) ----------
  // Plain SVG bars around a zero line: green = profit, orange = loss.
  // Hover (mouse) or tap (phone) a month to see its breakdown underneath.
  const SHORT_MONTH = new Intl.DateTimeFormat("en-NZ", { month: "short", timeZone: "UTC" });
  let chartMonths = [];   // the 12 months currently drawn
  let chartPick = null;   // the month whose breakdown is shown

  function profitChart(months) {
    chartMonths = months;
    if (!months.some((m) => m.month === chartPick)) chartPick = months[months.length - 1].month;
    const width = Math.max(260, (root.clientWidth || 640) - 46); // card's inner width
    const plotH = 160, labelH = 22, top = 18;
    const max = Math.max(0, ...months.map((m) => m.net));
    const min = Math.min(0, ...months.map((m) => m.net));
    const range = max - min || 1;
    const y = (v) => top + ((max - v) / range) * plotH;  // value → pixel height
    const zeroY = y(0);
    const col = width / months.length;
    const barW = Math.max(6, Math.min(28, col - 6));
    const r = Math.min(4, barW / 2);
    // Bar with rounded corners on the end away from the zero line
    const barPath = (x, v) => {
      const h = Math.abs(y(v) - zeroY);
      if (h < 0.5) return "";
      const rr = Math.min(r, h);
      if (v > 0) {
        const t = zeroY - h;
        return `M${x},${zeroY}V${t + rr}Q${x},${t} ${x + rr},${t}H${x + barW - rr}Q${x + barW},${t} ${x + barW},${t + rr}V${zeroY}Z`;
      }
      const b = zeroY + h;
      return `M${x},${zeroY}V${b - rr}Q${x},${b} ${x + rr},${b}H${x + barW - rr}Q${x + barW},${b} ${x + barW},${b - rr}V${zeroY}Z`;
    };
    const narrow = col < 30;
    const cols = months.map((m, i) => {
      const x = i * col + (col - barW) / 2;
      const label = SHORT_MONTH.format(Calc.toUTC(m.month + "-01"));
      return `<g class="chart-col${m.month === chartPick ? " sel" : ""}" data-month="${m.month}">
          <rect class="chart-hit" x="${i * col}" y="0" width="${col}" height="${top + plotH + labelH}"></rect>
          <path class="${m.net < 0 ? "chart-neg" : "chart-pos"}" d="${barPath(x, m.net)}"></path>
          <text class="chart-label" x="${i * col + col / 2}" y="${top + plotH + 16}" text-anchor="middle">${narrow ? label[0] : label}</text>
        </g>`;
    }).join("");
    const axis = (v) => `<text class="chart-label" x="0" y="${y(v) - 5}">${money(v)}</text>`;
    return `
      <div class="card chart-card">
        <h3>Net profit by month</h3>
        <svg class="chart" width="${width}" height="${top + plotH + labelH}" viewBox="0 0 ${width} ${top + plotH + labelH}"
          role="img" aria-label="Bar chart of net profit for the last 12 months">
          ${max > 0 ? axis(max) : ""}${min < 0 ? axis(min) : ""}
          <line class="chart-zero" x1="0" x2="${width}" y1="${zeroY}" y2="${zeroY}"></line>
          ${cols}
        </svg>
        <div class="chart-detail" data-chart-detail>${chartDetail()}</div>
      </div>`;
  }

  function chartDetail() {
    const m = chartMonths.find((x) => x.month === chartPick);
    if (!m) return "";
    return `<div class="stat-label">${fmtMonth(m.month)}</div>
      <div class="preview">
        <span>Revenue <b>${money(m.revenue)}</b></span>
        <span>Cost of goods <b>${money(m.cogs)}</b></span>
        <span>Expenses <b>${money(m.expenses)}</b></span>
        <span>Net <b class="${tone(m.net)}">${money(m.net)}</b></span>
      </div>`;
  }

  function pickChartMonth(month) {
    if (!month || month === chartPick) return;
    chartPick = month;
    root.querySelectorAll(".chart-col").forEach((g) => g.classList.toggle("sel", g.dataset.month === month));
    const box = root.querySelector("[data-chart-detail]");
    if (box) box.innerHTML = chartDetail();
  }

  // ---------- Products ----------
  PAGES.products = (data, snap) => {
    const times = Calc.sellTimes(data, Calc.today());
    const rows = data.products.slice().sort(byName).map((p) => {
      const cost = Calc.currentUnitCost(data, snap, p.id);
      const st = snap.inv.byProduct[p.id];
      const t = times[p.id];
      return {
        action: "edit-product", id: p.id,
        cells: [
          `<b>${esc(p.name)}</b>${muted(esc(p.notes))}`,
          tierList(p, cost),
          cost === null ? `<span class="muted">Not known yet</span>` : money(cost),
          st && st.qty ? String(st.qty) : "0",
          (t.avgDays === null ? `<span class="muted">No sales yet</span>` : days(t.avgDays) + " avg") +
            (t.oldestDays !== null ? muted(`Oldest unsold: ${days(t.oldestDays)}`) : ""),
        ],
      };
    });
    return sectionHead("Products", btn("Add product", "add-product", "", "btn-primary"), [["Set stock…", "set-stock"]]) +
      table([{ label: "Product" }, { label: "Price tiers (per unit · total · margin)" }, { label: "Landed cost/unit", num: true }, { label: "In stock", num: true }, { label: "Days to sell", num: true }],
        rows, "No products yet.");
  };

  // A product's tiers, one per line: "10–49  $40.00  +$12.00 (30%)"
  function tierList(p, cost) {
    const tiers = Calc.productTiers(p);
    if (!tiers.length) return `<span class="muted">No prices set</span>`;
    return `<div class="tier-list">${tiers.map((t) => {
      const m = Calc.margin(t.price, cost);
      const marginHtml = m.perUnit === null ? "" :
        `<span class="${tone(m.perUnit)}">${signed(m.perUnit)}${m.pct === null ? "" : ` (${Math.round(m.pct)}%)`}</span>`;
      // Total for the tier's starting qty, e.g. 2+ at $60 each = $120 for 2
      const total = Calc.saleRevenue({ qty: t.min, unitPrice: t.price });
      return `<div class="tier-line"><span class="muted">${Calc.tierRange(tiers, t.min)}</span><b>${money(t.price)}</b>` +
        `<span class="muted">${money(total)} for ${t.min}</span>${marginHtml}</div>`;
    }).join("")}</div>`;
  }

  // ---------- On the way ----------
  PAGES.orders = (data, snap) => {
    const today = Calc.today();
    const incoming = data.orders.filter((o) => !o.receivedDate)
      .sort((a, b) => (a.expectedDate || "9999") < (b.expectedDate || "9999") ? -1 : 1);
    const received = data.orders.filter((o) => o.receivedDate)
      .sort((a, b) => (a.receivedDate < b.receivedDate ? 1 : -1));

    const rows = incoming.map((o) => {
      const since = Calc.daysBetween(o.orderDate, today);
      let status = `<span class="muted">No date set</span>`;
      let overdue = false;
      if (o.expectedDate) {
        const until = Calc.daysBetween(today, o.expectedDate);
        if (until > 0) status = `In ${plural(until, "day")}`;
        else if (until === 0) status = badge("Due today");
        else { status = badge(`Overdue by ${plural(-until, "day")}`, "warn"); overdue = true; }
      }
      return {
        cls: overdue ? "overdue" : "", action: "edit-order", id: o.id,
        cells: [
          `<b>${esc(productName(o.productId))}</b>${muted(esc(o.supplier))}`,
          String(o.qty),
          money(Calc.orderTotal(o)) + muted(`${money(Calc.landedUnitCost(o))}/unit`),
          fmtDate(o.orderDate) + muted(`${plural(since, "day")} ago`),
          fmtDate(o.expectedDate),
          status,
        ],
      };
    });

    const receivedRows = received.map((o) => ({
      action: "edit-order", id: o.id,
      cells: [
        `<b>${esc(productName(o.productId))}</b>${muted(esc(o.supplier))}`,
        `${o.receivedQty}${Number(o.receivedQty) !== Number(o.qty) ? muted(`of ${o.qty} ordered`) : ""}`,
        money(Calc.orderTotal(o)) + muted(`${money(Calc.landedUnitCost(o))}/unit`),
        fmtDate(o.orderDate),
        fmtDate(o.receivedDate),
      ],
    }));

    return sectionHead("On the way", btn("Add order", "add-order", "", "btn-primary")) +
      `<div class="stats">
        ${stat("Orders on the way", String(incoming.length))}
        ${stat("Units on the way", String(snap.onTheWayUnits))}
        ${stat("Value on the way", money(snap.onTheWayValue))}
      </div>` +
      table([{ label: "Product" }, { label: "Qty", num: true }, { label: "Total cost", num: true }, { label: "Ordered" }, { label: "Expected" }, { label: "Arrival" }],
        rows, "Nothing on the way.") +
      (received.length ? `<details class="history"><summary>Received orders (${received.length})</summary>${table(
        [{ label: "Product" }, { label: "Qty received", num: true }, { label: "Total cost", num: true }, { label: "Ordered" }, { label: "Received" }],
        receivedRows, "")}</details>` : "");
  };

  // ---------- In hand ----------
  PAGES.stock = (data, snap) => {
    const times = Calc.sellTimes(data, Calc.today());
    const oldest = Calc.oldestStock(times);
    const items = data.products
      .map((p) => ({ p, st: snap.inv.byProduct[p.id] }))
      .filter((x) => x.st && x.st.qty !== 0)
      .sort((a, b) => byName(a.p, b.p));
    const rows = items.map(({ p, st }) => ({
      action: "set-stock", id: p.id,
      cells: [
        `<b>${esc(p.name)}</b>${muted(st.batches ? `From ${plural(st.batches, "order")}` : "Set manually")}`,
        st.qty < 0 ? `<span class="neg">${st.qty}</span>` : String(st.qty),
        money(st.avgCost),
        money(st.value),
        times[p.id].avgDays === null ? `<span class="muted">No sales yet</span>` : days(times[p.id].avgDays),
        times[p.id].oldestDays === null ? "—" : days(times[p.id].oldestDays) + muted(`since ${fmtDate(times[p.id].oldestDate)}`),
      ],
    }));

    const adjustments = (data.stockAdjustments || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const adjRows = adjustments.map((a) => ({
      action: "edit-stock-adj", id: a.id,
      cells: [
        fmtDate(a.date),
        `<b>${esc(productName(a.productId))}</b>${muted(esc(a.note))}`,
        `<span class="${tone(a.qty)}">${a.qty > 0 ? "+" : ""}${a.qty}</span>`,
        a.qty > 0 ? money(a.unitCost) : `<span class="muted">Avg cost</span>`,
      ],
    }));

    return sectionHead("In hand", btn("Record sale", "add-sale", "", "btn-primary"), [["Set stock…", "set-stock"]]) +
      `<div class="stats">
        ${stat("Units in stock", String(snap.stockUnits))}
        ${stat("Inventory value", money(snap.stockValue))}
        ${stat("Oldest unsold stock", oldest ? days(oldest.days) : "—", oldest ? esc(productName(oldest.productId)) : "")}
      </div>` +
      table([{ label: "Product" }, { label: "Qty on hand", num: true }, { label: "Avg landed cost/unit", num: true }, { label: "Stock value", num: true },
        { label: "Avg days to sell", num: true }, { label: "Oldest unsold", num: true }],
        rows, "No stock in hand.") +
      (adjustments.length ? `<details class="history"><summary>Stock adjustments (${adjustments.length})</summary>${table(
        [{ label: "Date" }, { label: "Product" }, { label: "Units", num: true }, { label: "Cost/unit", num: true }],
        adjRows, "")}</details>` : "");
  };

  // ---------- Sales ----------
  PAGES.sales = (data, snap) => {
    const month = Calc.monthOf(Calc.today());
    const m = Calc.periodStats(data, snap, month);
    const all = Calc.periodStats(data, snap, null);
    const today = Calc.today();
    const rows = data.sales.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((s) => {
      const profit = Calc.saleProfit(s, snap);
      const owed = Calc.saleOwed(s);
      const overdue = owed > 0 && s.dueDate && s.dueDate < today;
      let paidCell = esc(accountName(s.accountId));
      if (s.paidLater) {
        const accounts = [...new Set((s.payments || []).map((p) => accountName(p.accountId)))].join(", ");
        paidCell = owed > 0
          ? badge(`Owes ${money(owed)}`, overdue ? "warn" : "") + muted(s.dueDate ? `Due ${fmtDate(s.dueDate)}` : "Paid later")
          : `Paid later${muted(esc(accounts))}`;
      }
      return {
        cls: overdue ? "overdue" : "", action: "edit-sale", id: s.id,
        cells: [
          fmtDate(s.date),
          `<b>${esc(productName(s.productId))}</b>${muted(esc(s.buyer))}`,
          String(s.qty),
          money(Calc.saleUnitPrice(s)),
          money(Calc.saleRevenue(s)),
          money(Calc.saleCost(s, snap)),
          `<span class="${tone(profit)}">${money(profit)}</span>`,
          paidCell,
        ],
      };
    });
    return sectionHead("Sales", btn("Record sale", "add-sale", "", "btn-primary")) +
      `<div class="stats">
        ${stat("Revenue this month", money(m.revenue), `All time: ${money(all.revenue)}`)}
        ${stat("Profit this month", money(m.gross), `All time: <span class="${tone(all.gross)}">${money(all.gross)}</span>`, tone(m.gross))}
        ${stat("Units sold this month", String(m.units), `All time: ${all.units}`)}
      </div>` +
      table([{ label: "Date" }, { label: "Product" }, { label: "Qty", num: true }, { label: "Price/unit", num: true }, { label: "Revenue", num: true },
        { label: "Cost", num: true }, { label: "Profit", num: true }, { label: "Paid" }],
        rows, "No sales yet.");
  };

  // ---------- Spent ----------
  PAGES.spent = (data) => {
    const thisMonth = Calc.monthOf(Calc.today());
    const months = [...new Set([thisMonth, ...data.expenses.map((e) => Calc.monthOf(e.date))])].sort().reverse();
    const inMonth = data.expenses.filter((e) => !spentFilter.month || Calc.monthOf(e.date) === spentFilter.month);
    const shown = inMonth.filter((e) => !spentFilter.category || e.category === spentFilter.category)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const totals = Calc.categoryTotals(inMonth);
    const maxTotal = totals.length ? totals[0].total : 1;

    const rows = shown.map((e) => {
      let tag = "";
      if (e.recurring === "weekly" || e.recurring === "monthly") tag = badge(`Repeats ${e.recurring}`);
      else if (e.fromRecurringId) tag = badge("Auto-logged");
      return {
        action: "edit-expense", id: e.id,
        cells: [
          fmtDate(e.date),
          esc(e.category),
          `${esc(e.description) || '<span class="muted">—</span>'} ${tag}`,
          e.productId ? esc(productName(e.productId)) : `<span class="muted">—</span>`,
          esc(accountName(e.accountId)),
          money(e.amount),
        ],
      };
    });

    return sectionHead("Spent", btn("Add expense", "add-expense", "", "btn-primary"), [["Categories…", "manage-categories"]]) +
      `<div class="filters">
        ${field("Month", select("month", [["", "All time"], ...months.map((mo) => [mo, fmtMonth(mo)])], spentFilter.month, 'data-filter="month"'))}
        ${field("Category", select("category", [["", "All categories"], ...data.categories.map((c) => [c, c])], spentFilter.category, 'data-filter="category"'))}
      </div>
      <div class="panels">
        <div class="card">
          <h3>Total ${spentFilter.month ? `in ${fmtMonth(spentFilter.month)}` : "all time"}</h3>
          <div class="capital-value">${money(Calc.sum(inMonth, (e) => Number(e.amount) || 0))}</div>
          ${spentFilter.category ? `<p class="muted">${esc(spentFilter.category)}: ${money(Calc.sum(shown, (e) => Number(e.amount) || 0))}</p>` : ""}
        </div>
        <div class="card"><h3>By category</h3>${totals.length ? totals.map((t) => `
          <div class="rank">
            <div class="rank-top"><span>${esc(t.category)}</span><span class="num">${money(t.total)}</span></div>
            <div class="bar"><span style="width:${Math.max(2, (t.total / maxTotal) * 100)}%"></span></div>
          </div>`).join("") : `<p class="muted">No expenses in this period.</p>`}</div>
      </div>` +
      table([{ label: "Date" }, { label: "Category" }, { label: "Description" }, { label: "Product" }, { label: "Paid from" }, { label: "Amount", num: true }],
        rows, "No expenses in this period.");
  };

  // ---------- Accounts ----------
  // One hero card (overall balance + Cash / Bank / Crypto tiles, ⋯ menu with Set balance),
  // three actions (Add / Take out / Move), then the history grouped by date.
  // Tapping a tile or chip filters the history to that account; tapping a row
  // opens it for editing (Delete is at the bottom of that form).
  const acctUi = { filter: "", shown: 20 };
  const HISTORY_STEP = 20;
  const touches = (t, acc) => !acc || t.accountId === acc || t.fromId === acc || t.toId === acc;

  // One history row. With an account filter, a move shows as in or out of that
  // account; with "All" it's neutral (the overall balance doesn't change).
  function historyRow(t, acc) {
    const isMove = t.type === "transfer";
    const kind = isMove ? "Moved" : t.cashCount ? "Balance set" : t.amount < 0 ? "Taken out" : "Added";
    const icon = isMove ? "⇄" : t.cashCount ? "=" : t.amount < 0 ? "−" : "+";
    const amount = !isMove ? Number(t.amount) || 0
      : acc === t.fromId ? -(Number(t.amount) || 0)
      : acc === t.toId ? Number(t.amount) || 0 : null;
    const tag = isMove ? `${esc(accountName(t.fromId))} → ${esc(accountName(t.toId))}` : esc(accountName(t.accountId));
    const note = [t.from ? "From " + esc(t.from) : "", esc(t.note)].filter(Boolean).join(" · ");
    return `<button type="button" class="hist-row" data-action="edit-transfer" data-id="${esc(t.id)}">
        <span class="hist-icon" aria-hidden="true">${icon}</span>
        <span class="hist-main">
          <span class="hist-note">${note || kind}</span>
          <span class="hist-meta">${note ? `<span>${kind}</span>` : ""}${badge(tag)}</span>
        </span>
        <span class="hist-amt ${amount === null ? "" : tone(amount)}">${amount === null ? money(t.amount) : signed(amount)}</span>
      </button>`;
  }
  // Rows grouped under a small date header, newest first
  function historyList(list, acc) {
    let html = "", lastDate = null;
    for (const t of list) {
      if (t.date !== lastDate) {
        html += `<div class="hist-date">${fmtDate(t.date)}</div>`;
        lastDate = t.date;
      }
      html += historyRow(t, acc);
    }
    return `<div class="card hist">${html}</div>`;
  }

  PAGES.accounts = (data, snap) => {
    const acc = acctUi.filter;
    const sorted = data.transfers.filter((t) => touches(t, acc)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    // "Set balance" corrections aren't money in or out, so they're listed on their own
    const moves = sorted.filter((t) => !t.cashCount);
    const corrections = sorted.filter((t) => t.cashCount);
    const shown = moves.slice(0, acctUi.shown);
    const tile = (id, label) => {
      const value = snap.balances[id] || 0;
      return `<button type="button" class="acct-tile${acc === id ? " active" : ""}" data-action="acct-filter" data-id="${id}" aria-pressed="${acc === id}">
          <span class="stat-label">${label}</span>
          <b class="${value < 0 ? "neg" : ""}">${money(value)}</b>
        </button>`;
    };
    const chip = (id, label) =>
      `<button type="button" class="chip${acc === id ? " active" : ""}" data-action="acct-filter" data-id="${id}" aria-pressed="${acc === id}">${label}</button>`;

    return sectionHead("Accounts") +
      `<div class="card acct-hero">
        <div class="acct-hero-head">
          <div class="stat-label">Overall balance</div>
          <div class="menu-wrap">
            <button type="button" class="btn btn-ghost btn-icon" data-action="menu" aria-label="More options" aria-haspopup="true" aria-expanded="false">⋯</button>
            <div class="menu card" hidden>
              <button type="button" class="menu-item" data-action="set-balance">Set balance…</button>
              <button type="button" class="menu-item" data-action="export">Export backup</button>
              <button type="button" class="menu-item" data-action="import">Import backup…</button>
            </div>
          </div>
        </div>
        <div class="capital-value ${snap.cashTotal < 0 ? "neg" : ""}">${money(snap.cashTotal)}</div>
        <div class="acct-tiles">${PNL_BUILT_IN.map(([id, name]) => tile(id, name)).join("")}</div>
      </div>
      <div class="acct-actions">
        ${btn("Add", "acct-add", "", "btn-primary")}${btn("Take out", "acct-take")}${btn("Move", "acct-move")}
      </div>
      <h3 class="group-title">Money in and out</h3>
      <div class="chips">${chip("", "All")}${PNL_BUILT_IN.map(([id, name]) => chip(id, name)).join("")}</div>` +
      (shown.length ? historyList(shown, acc) : empty(acc ? `Nothing in or out of ${esc(accountName(acc))} yet.` : "Nothing added, taken out or moved yet.")) +
      (moves.length > shown.length ? `<div class="show-more">${btn(`Show more (${moves.length - shown.length} left)`, "acct-more")}</div>` : "") +
      (corrections.length ? `<h3 class="group-title">Balance corrections</h3>` + historyList(corrections, acc) : "");
  };

  // ================= Forms =================

  // ---------- Product ----------
  function productForm(id) {
    const p = id ? Store.get("products", id) : { name: "", notes: "", tiers: [{ min: 1, price: "" }] };
    const start = Calc.productTiers(p);
    const tierRow = (t = { min: "", price: "" }) => `
      <div class="tier-row" data-tier-row>
        <label class="bill"><span>From qty</span>${qtyInput("tierMin", t.min, 'placeholder="e.g. 10"')}</label>
        <label class="bill"><span>Price per unit</span>${moneyInput("tierPrice", t.price, 'placeholder="0.00"')}</label>
        <button type="button" class="btn btn-sm btn-ghost danger" data-remove-tier aria-label="Remove tier">Remove</button>
      </div>`;
    const form = openForm(id ? "Edit product" : "Add product", `
      ${field("Product name", textInput("name", p.name, "required"))}
      <div class="field">
        <span class="field-label">Price tiers</span>
        <div class="tier-rows" data-tier-rows>${(start.length ? start : [{ min: 1, price: "" }]).map(tierRow).join("")}</div>
        <span class="field-hint">A sale uses the highest tier its quantity reaches.</span>
        <div><button type="button" class="btn btn-sm" data-add-tier>+ Add tier</button></div>
      </div>
      ${field("Notes (optional)", textArea("notes", p.notes))}`,
    (v, f) => {
      if (!v.name) return "Enter a product name.";
      const clash = Store.data.products.find((x) => x.id !== p.id && x.name.toLowerCase() === v.name.toLowerCase());
      if (clash) return "You already have a product with that name.";
      const tiers = [];
      for (const r of f.querySelectorAll("[data-tier-row]")) {
        const minText = r.querySelector("[name=tierMin]").value.trim();
        const priceText = r.querySelector("[name=tierPrice]").value.trim();
        if (minText === "" && priceText === "") continue; // blank row: ignore
        const min = Number(minText);
        if (!Number.isInteger(min) || min < 1) return "Each tier's “from qty” must be a whole number, 1 or more.";
        if (priceText === "" || !(Number(priceText) >= 0)) return `Enter a price for the tier from ${min} units.`;
        if (tiers.some((t) => t.min === min)) return `Two tiers start at ${min} units. Each tier needs a different “from” qty.`;
        tiers.push({ min, price: Number(priceText) });
      }
      tiers.sort((a, b) => a.min - b.min);
      const item = { ...p, id: p.id || Store.uid(), name: v.name, notes: v.notes, tiers };
      delete item.prices; // old fixed-tier format
      return Store.commit((d) => upsertIn(d.products, item));
    }, {
      onDelete: id ? () => deleteProduct(id) : null, skipConfirm: true,
      extra: id ? [["Set stock…", () => setStockForm(id)]] : [],
    });

    const rows = form.querySelector("[data-tier-rows]");
    form.addEventListener("click", (e) => {
      if (e.target.closest("[data-add-tier]")) {
        rows.insertAdjacentHTML("beforeend", tierRow());
        rows.lastElementChild.querySelector("input").focus();
      }
      const rm = e.target.closest("[data-remove-tier]");
      if (rm) rm.closest("[data-tier-row]").remove();
    });
  }

  // ---------- Order ----------
  function orderForm(id) {
    if (!Store.data.products.length) return needProducts();
    const today = Calc.today();
    const o = id ? Store.get("orders", id) : {
      productId: "", supplier: "", qty: "", orderDate: today, expectedDate: "", accountId: CASH_ID, notes: "",
    };
    const received = !!o.receivedDate;
    const form = openForm(id ? "Edit order" : "Add order", `
      ${row(field("Product", select("productId", productOptions("Choose a product…"), o.productId, "required")),
            field("Supplier", textInput("supplier", o.supplier)))}
      ${row(field("Quantity ordered", qtyInput("qty", o.qty, "required")),
            field("Total price", moneyInput("total", id ? Calc.round2(Calc.orderTotal(o)) : "", "required"), "What you paid for the whole order."))}
      ${row(field("Order date", dateInput("orderDate", o.orderDate, "required")),
            field("Expected arrival", dateInput("expectedDate", o.expectedDate)))}
      ${received ? row(field("Received date", dateInput("receivedDate", o.receivedDate, "required")),
            field("Quantity received", qtyInput("receivedQty", o.receivedQty, "required", 0))) : ""}
      ${accountField("Paid from", o.accountId)}
      ${field("Notes (optional)", textArea("notes", o.notes))}
      <div class="preview" data-preview></div>`,
    (v) => {
      if (!v.productId) return "Choose a product.";
      if (!(num(v.qty) >= 1) || !Number.isInteger(num(v.qty))) return "Quantity must be a whole number, 1 or more.";
      if (v.expectedDate && v.expectedDate < v.orderDate) return "Expected arrival can't be before the order date.";
      const item = {
        ...o, id: o.id || Store.uid(), productId: v.productId, supplier: v.supplier, qty: num(v.qty),
        total: num(v.total), orderDate: v.orderDate,
        expectedDate: v.expectedDate, accountId: v.accountId, notes: v.notes,
      };
      // Older orders stored unit cost + shipping + fees; the single total replaces them
      delete item.unitCost; delete item.shipping; delete item.fees;
      if (received) {
        if (!Number.isInteger(num(v.receivedQty)) || num(v.receivedQty) < 0) return "Quantity received must be a whole number.";
        if (v.receivedDate < v.orderDate) return "Received date can't be before the order date.";
        item.receivedDate = v.receivedDate;
        item.receivedQty = num(v.receivedQty);
      }
      return Store.commit((d) => upsertIn(d.orders, item));
    }, {
      onDelete: id ? () => Store.commit((d) => removeFrom(d.orders, id)) : null, deleteWhat: "order",
      extra: !id ? [] : received
        ? [["Undo receive", () => { const r = unreceiveOrder(id); if (r === false) return; closeModal(); report(r); }]]
        : [["Mark received…", () => receiveForm(id)]],
    });

    const preview = form.querySelector("[data-preview]");
    const update = () => {
      const v = formValues(form);
      const draft = { qty: num(v.qty), total: num(v.total), receivedDate: v.receivedDate, receivedQty: num(v.receivedQty) };
      preview.innerHTML = `<span>Landed cost/unit <b>${Calc.landedUnitCost(draft) ? money(Calc.landedUnitCost(draft)) : "—"}</b></span>`;
    };
    form.addEventListener("input", update);
    update();
  }

  // ---------- Mark as received ----------
  function receiveForm(id) {
    const o = Store.get("orders", id);
    const form = openForm(`Receive: ${productName(o.productId)}`, `
      ${row(field("Received date", dateInput("receivedDate", Calc.today(), "required")),
            field("Quantity received", qtyInput("receivedQty", o.qty, "required", 0), `Ordered ${o.qty}. Fewer arrived? The cost spreads over what came.`))}
      <div class="preview" data-preview></div>`,
    (v) => {
      const q = num(v.receivedQty);
      if (!Number.isInteger(q) || q < 0) return "Quantity received must be a whole number.";
      if (v.receivedDate < o.orderDate) return "Received date can't be before the order date.";
      return Store.commit((d) => {
        const x = d.orders.find((y) => y.id === id);
        x.receivedDate = v.receivedDate;
        x.receivedQty = q;
      });
    }, { submitLabel: "Move to In hand" });

    const preview = form.querySelector("[data-preview]");
    const update = () => {
      const v = formValues(form);
      const draft = { ...o, receivedDate: "x", receivedQty: num(v.receivedQty) };
      preview.innerHTML = `<span>Total cost <b>${money(Calc.orderTotal(o))}</b></span>
        <span>Landed cost/unit <b>${num(v.receivedQty) > 0 ? money(Calc.landedUnitCost(draft)) : "—"}</b></span>`;
    };
    form.addEventListener("input", update);
    update();
  }

  // ---------- Sale ----------
  // Qty box with − / + buttons either side (tap-friendly on phones)
  const stepper = (name, value) => `<div class="stepper">
      <button type="button" class="btn" data-step="-1" aria-label="One less">−</button>
      ${qtyInput(name, value, "required")}
      <button type="button" class="btn" data-step="1" aria-label="One more">+</button>
    </div>`;

  // Record / edit a sale. opts.quick = the Dashboard's "+ Sale": same form and
  // rules, laid out for speed (date and buyer tucked under "More").
  function saleForm(id, presetProductId, opts = {}) {
    if (!Store.data.products.length) return needProducts();
    const s = id ? Store.get("sales", id) : {
      productId: presetProductId || "", qty: 1, unitPrice: "", date: Calc.today(), accountId: CASH_ID, buyer: "",
    };
    const snap = Calc.snapshot(Store.data);
    // Units available: current stock, plus this sale's own units when editing it
    const available = (pid) => {
      const st = snap.inv.byProduct[pid];
      return (st ? st.qty : 0) + (id && pid === s.productId ? Number(s.qty) : 0);
    };
    const options = [["", "Choose a product…"], ...Store.data.products.slice().sort(byName).map((p) => [p.id, `${p.name} (${available(p.id)} in stock)`])];

    const hasTotal = s.total !== undefined && s.total !== null && s.total !== "";
    const quick = !!opts.quick;
    const priceRow = `
      ${row(field("Price per unit", moneyInput("unitPrice", s.unitPrice)),
            field("OR total for the lot", moneyInput("lotTotal", hasTotal ? s.total : "")))}
      <p class="field-hint"><span data-tier-hint></span> <button type="button" class="link" data-use-tier>Use tier price</button></p>`;
    const dateField = field("Date", dateInput("date", s.date, "required"));
    const buyerField = `<label class="field"><span class="field-label" data-buyer-label>Buyer / location (optional)</span>${textInput("buyer", s.buyer)}</label>`;
    const accountWrap = `<div data-account-wrap>${accountField("Paid into", s.accountId)}</div>`;
    const paidSoFar = s.paidLater ? Calc.salePaid(s) : 0;
    // "Paid later": the sale counts now, the money arrives when you mark it paid
    const laterBlock = `
      <label class="check"><input type="checkbox" name="paidLater"${s.paidLater ? " checked" : ""}> Paid later (the buyer owes me)</label>
      <div data-later-fields hidden>
        ${field("Due date (optional)", dateInput("dueDate", s.dueDate), paidSoFar ? `Paid so far: ${money(paidSoFar)}. Unticking “Paid later” removes these payments and puts the full amount into the account you pick.` : "")}
      </div>`;
    const form = openForm(id ? "Edit sale" : quick ? "Quick sale" : "Record sale", quick ? `
      ${field("Product", select("productId", options, s.productId, "required"))}
      ${field("Quantity", stepper("qty", s.qty))}
      ${priceRow}
      ${accountWrap}
      ${laterBlock}
      <details class="more"><summary>More: date, buyer</summary><div class="form">${dateField}${buyerField}</div></details>
      <div class="preview big" data-preview></div>` : `
      ${field("Product", select("productId", options, s.productId, "required"))}
      ${field("Quantity sold", stepper("qty", s.qty))}
      ${priceRow}
      ${row(dateField, accountWrap)}
      ${laterBlock}
      ${buyerField}
      <div class="preview" data-preview></div>`,
    (v) => {
      if (!v.productId) return "Choose a product.";
      const q = num(v.qty);
      if (!Number.isInteger(q) || q < 1) return "Quantity must be a whole number, 1 or more.";
      if (q > available(v.productId)) return `Only ${available(v.productId)} in stock for that product.`;
      const price = priceFrom(v);
      if (price.error) return price.error;
      const item = { ...s, id: s.id || Store.uid(), productId: v.productId, qty: q, ...price.fields, date: v.date, accountId: v.accountId, buyer: v.buyer };
      if (price.fields.total === undefined) delete item.total;
      if (v.paidLater) {
        if (!v.buyer) return "Enter the buyer's name, so you know who owes you.";
        item.paidLater = true;
        item.dueDate = v.dueDate;
        item.payments = s.payments || [];
        if (Calc.salePaid(item) > Calc.saleRevenue(item) + 0.005) {
          return `This sale's total is less than the ${money(Calc.salePaid(item))} already paid. Remove payments first (Sales → Mark paid).`;
        }
      } else {
        delete item.paidLater; delete item.dueDate; delete item.payments;
      }
      return Store.commit((d) => upsertIn(d.sales, item));
    }, {
      submitLabel: quick ? "Save sale" : "Save",
      onDelete: id ? () => Store.commit((d) => removeFrom(d.sales, id)) : null, deleteWhat: "sale",
      extra: id && s.paidLater ? [[Calc.saleOwed(s) > 0 ? "Mark paid…" : "Payments…", () => paymentForm(id)]] : [],
    });

    const laterBox = form.querySelector("[name=paidLater]");
    const laterFields = form.querySelector("[data-later-fields]");
    const accountBox = form.querySelector("[data-account-wrap]");
    const buyerLabel = form.querySelector("[data-buyer-label]");
    const syncLater = () => {
      const later = laterBox.checked;
      laterFields.hidden = !later;
      accountBox.hidden = later;
      form.buyer.required = later;
      buyerLabel.textContent = later ? "Buyer (who owes you)" : "Buyer / location (optional)";
      if (later && quick) form.querySelector("details.more").open = true;
    };
    laterBox.addEventListener("change", () => { syncLater(); update(); });
    syncLater();

    // Price per unit and lot total fill each other in. `mode` is whichever one
    // you typed last; that one is saved exactly (a lot total is stored as `total`).
    const unitInput = form.querySelector("[name=unitPrice]");
    const totalInput = form.querySelector("[name=lotTotal]");
    const hint = form.querySelector("[data-tier-hint]");
    const preview = form.querySelector("[data-preview]");
    let mode = hasTotal ? "total" : "unit";
    let priceTouched = !!id; // when editing, keep the saved price unless asked

    function priceFrom(v) {
      const q = num(v.qty);
      if (mode === "total") {
        if (v.lotTotal === "" || !(num(v.lotTotal) >= 0)) return { error: "Enter a price per unit or a total for the lot." };
        return { fields: { total: num(v.lotTotal), unitPrice: Calc.round2(Calc.saleUnitPrice({ qty: q, total: num(v.lotTotal) })) } };
      }
      if (v.unitPrice === "" || !(num(v.unitPrice) >= 0)) return { error: "Enter a price per unit or a total for the lot." };
      return { fields: { unitPrice: num(v.unitPrice) } };
    }

    const update = () => {
      const v = formValues(form);
      const q = num(v.qty);
      const product = Store.get("products", v.productId);
      const tier = Calc.tierFor(product, Math.max(1, q));
      if (!priceTouched && tier) { unitInput.value = tier.price; mode = "unit"; }
      // Fill in the other price box
      if (mode === "unit") totalInput.value = unitInput.value === "" || !q ? "" : Calc.round2(Calc.saleRevenue({ qty: q, unitPrice: num(unitInput.value) }));
      else unitInput.value = totalInput.value === "" || !q ? "" : Calc.round2(Calc.saleUnitPrice({ qty: q, total: num(totalInput.value) }));
      const tiers = Calc.productTiers(product);
      hint.textContent = !v.productId ? "" : !tier ? `No tier price for ${plural(q, "unit")}.`
        : `Tier used: ${Calc.tierRange(tiers, tier.min)} units at ${money(tier.price)} each.`;
      const price = priceFrom(formValues(form));
      if (!v.productId || price.error) { preview.innerHTML = ""; return; }
      const revenue = Calc.saleRevenue({ qty: q, ...price.fields });
      const cost = Calc.estimateSaleCost(snap, v.productId, q);
      const owed = v.paidLater ? Calc.saleOwed({ ...s, qty: q, ...price.fields, total: price.fields.total, paidLater: true }) : 0;
      preview.innerHTML = `<span>Revenue <b>${money(revenue)}</b></span><span>Cost <b>${money(cost)}</b></span>
        <span>Profit <b class="${tone(revenue - cost)}">${money(revenue - cost)}</b></span>
        ${v.paidLater ? `<span>Owed to you <b>${money(owed)}</b></span>` : ""}`;
    };
    form.addEventListener("input", (e) => {
      if (e.target === unitInput) { priceTouched = true; mode = "unit"; }
      if (e.target === totalInput) { priceTouched = true; mode = "total"; }
      update();
    });
    form.querySelector("[data-use-tier]").addEventListener("click", () => {
      priceTouched = false;
      update();
    });
    form.addEventListener("click", (e) => {
      const b = e.target.closest("[data-step]");
      if (!b) return;
      form.qty.value = Math.max(1, Math.floor(num(form.qty.value)) + Number(b.dataset.step));
      update();
    });
    update();
  }

  // ---------- Mark paid (payment for a "paid later" sale) ----------
  // Part payments are fine: each is saved in the sale's `payments` and adds to
  // the account you pick on its date. Earlier payments can be removed here.
  function paymentForm(saleId) {
    const s = Store.get("sales", saleId);
    const owed = Calc.saleOwed(s);
    const payments = (s.payments || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const form = openForm(`Mark paid: ${s.buyer || "buyer"}`, `
      <p class="muted">${esc(productName(s.productId))} × ${s.qty}, sold ${fmtDate(s.date)}${s.dueDate ? `, due ${fmtDate(s.dueDate)}` : ""}.</p>
      <div class="preview">
        <span>Sale total <b>${money(Calc.saleRevenue(s))}</b></span>
        <span>Paid so far <b>${money(Calc.salePaid(s))}</b></span>
        <span>Still owed <b class="${owed > 0 ? "neg" : ""}">${money(owed)}</b></span>
      </div>
      ${payments.length ? `<ul class="cat-list">${payments.map((p) => `
        <li><span>${fmtDate(p.date)} · ${esc(accountName(p.accountId))} · <b>${money(p.amount)}</b></span>
          <button type="button" class="btn btn-sm btn-ghost danger" data-remove-payment="${esc(p.id)}">Remove</button></li>`).join("")}</ul>` : ""}
      ${owed > 0 ? `
        ${row(field("Amount received", moneyInput("amount", owed, "required"), "Less than the full amount = a part payment."),
              field("Date", dateInput("date", Calc.today(), "required")))}
        ${field("Paid into", select("accountId", accountOptions(), CASH_ID))}` : `<p class="muted">Fully paid.</p>`}`,
    (v) => {
      if (!(owed > 0)) return "This sale is already fully paid.";
      const amount = Calc.round2(num(v.amount));
      if (!(amount > 0)) return "Enter an amount above 0.";
      if (amount > owed) return `Only ${money(owed)} is still owed on this sale.`;
      const payment = { id: Store.uid(), amount, date: v.date, accountId: v.accountId };
      return Store.commit((d) => {
        const x = d.sales.find((y) => y.id === saleId);
        x.payments = [...(x.payments || []), payment];
      });
    }, { submitLabel: "Mark paid" });

    form.addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove-payment]");
      if (!b || !confirm("Remove this payment? The money comes back off its account.")) return;
      Store.commit((d) => {
        const x = d.sales.find((y) => y.id === saleId);
        x.payments = (x.payments || []).filter((p) => p.id !== b.dataset.removePayment);
      });
      render();
      paymentForm(saleId);
    });
  }

  // ---------- Expense ----------
  function expenseForm(id) {
    const e = id ? Store.get("expenses", id) : {
      date: Calc.today(), amount: "", category: Store.data.categories[0] || "Other", description: "",
      accountId: CASH_ID, productId: "", recurring: "none",
    };
    const cats = Store.data.categories.includes(e.category) ? Store.data.categories : [...Store.data.categories, e.category];
    const canRepeat = !e.fromRecurringId; // auto-logged copies don't repeat themselves
    openForm(id ? "Edit expense" : "Add expense", `
      ${row(field("Date", dateInput("date", e.date, "required")),
            field("Amount", moneyInput("amount", e.amount, "required")))}
      ${row(field("Category", select("category", cats.map((c) => [c, c]), e.category)),
            accountField("Paid from", e.accountId))}
      ${field("Description", textInput("description", e.description))}
      ${field("For product (optional)", select("productId", productOptions("Not linked to a product"), e.productId || ""))}
      ${canRepeat ? field("Repeats", select("recurring", [["none", "Doesn't repeat"], ["weekly", "Every week"], ["monthly", "Every month"]], e.recurring || "none"),
        "Repeats are logged automatically.") : `<p class="muted small">Auto-logged from a repeating expense.</p>`}`,
    (v) => {
      if (!(num(v.amount) > 0)) return "Enter an amount above 0.";
      const item = {
        ...e, id: e.id || Store.uid(), date: v.date, amount: num(v.amount), category: v.category,
        description: v.description, accountId: v.accountId, productId: v.productId,
        recurring: canRepeat ? v.recurring : "none",
      };
      const repeats = item.recurring === "weekly" || item.recurring === "monthly";
      if (!repeats) delete item.recurCount;
      else if (!id) item.recurCount = 0; // new: log any repeats already due
      else if (e.date !== item.date || e.recurring !== item.recurring) {
        // Changed schedule: start repeating from now, don't back-fill the past
        item.recurCount = Calc.occurrencesUpTo(item.date, item.recurring, Calc.today());
      }
      const error = Store.commit((d) => upsertIn(d.expenses, item));
      if (!error) Store.runRecurring();
      return error;
    }, { onDelete: id ? () => deleteExpense(id) : null, skipConfirm: true });
  }

  // ---------- Expense categories ----------
  function categoriesForm() {
    const used = new Set(Store.data.expenses.map((e) => e.category));
    const form = openForm("Expense categories", `
      <ul class="cat-list">${Store.data.categories.map((c) => `
        <li><span>${esc(c)}</span>${used.has(c) ? `<span class="muted small">In use</span>`
          : `<button type="button" class="btn btn-sm btn-ghost danger" data-remove-cat="${esc(c)}">Remove</button>`}</li>`).join("")}
      </ul>
      ${field("New category", textInput("name", "", "required"))}`,
    (v) => {
      if (!v.name) return "Enter a category name.";
      if (Store.data.categories.some((c) => c.toLowerCase() === v.name.toLowerCase())) return "That category already exists.";
      return Store.commit((d) => d.categories.push(v.name));
    }, { submitLabel: "Add category", after: categoriesForm });

    form.addEventListener("click", (e) => {
      const b = e.target.closest("[data-remove-cat]");
      if (!b) return;
      Store.commit((d) => { d.categories = d.categories.filter((c) => c !== b.dataset.removeCat); });
      if (spentFilter.category === b.dataset.removeCat) spentFilter.category = "";
      render();
      categoriesForm();
    });
  }

  // ---------- Accounts ----------
  function accountForm(id) {
    const a = id ? Store.get("accounts", id) : { name: "", opening: "" };
    openForm(id ? "Edit account" : "Add account", `
      ${field("Account name", textInput("name", a.name, 'required placeholder="e.g. Bank, PayPal"'))}
      ${field("Starting balance", `<input name="opening" type="number" step="0.01" inputmode="decimal" value="${a.opening ?? ""}">`, "What was in this account when you started tracking.")}`,
    (v) => {
      if (!v.name) return "Enter an account name.";
      const clash = Store.data.accounts.find((x) => x.id !== a.id && x.name.toLowerCase() === v.name.toLowerCase());
      if (clash) return "You already have an account with that name.";
      const item = { ...a, id: a.id || Store.uid(), name: v.name, opening: num(v.opening) };
      return Store.commit((d) => upsertIn(d.accounts, item));
    });
  }

  // Edit form for a move between accounts other than the built-in ones (older data)
  function transferForm(id) {
    if (Store.data.accounts.length < 2) return alert("Add a second account first (e.g. Bank) to transfer between them.");
    const t = id ? Store.get("transfers", id) : { fromId: CASH_ID, toId: Store.data.accounts.find((a) => a.id !== CASH_ID).id, amount: "", date: Calc.today(), note: "" };
    openForm(id ? "Edit transfer" : "Transfer between accounts", `
      ${row(field("From", select("fromId", accountOptions(), t.fromId)), field("To", select("toId", accountOptions(), t.toId)))}
      ${row(field("Amount", moneyInput("amount", t.amount, "required")), field("Date", dateInput("date", t.date, "required")))}
      ${field("Note (optional)", textInput("note", t.note))}`,
    (v) => {
      if (v.fromId === v.toId) return "Choose two different accounts.";
      if (!(num(v.amount) > 0)) return "Enter an amount above 0.";
      const item = { id: t.id || Store.uid(), type: "transfer", fromId: v.fromId, toId: v.toId, amount: num(v.amount), date: v.date, note: v.note };
      return Store.commit((d) => upsertIn(d.transfers, item));
    }, { onDelete: id ? () => Store.commit((d) => removeFrom(d.transfers, id)) : null });
  }

  // Edit form for a "Set balance" correction (+/− amount)
  function adjustForm(id) {
    const t = id ? Store.get("transfers", id) : { accountId: CASH_ID, amount: "", date: Calc.today(), note: "" };
    openForm(id ? (t.cashCount ? "Edit balance correction" : "Edit adjustment") : "Manual adjustment", `
      <p class="field-hint">Negative (e.g. -20) removes money.</p>
      ${row(field("Account", select("accountId", accountOptions(), t.accountId)),
            field("Amount (+/−)", `<input name="amount" type="number" step="0.01" inputmode="decimal" required value="${t.amount ?? ""}">`))}
      ${row(field("Date", dateInput("date", t.date, "required")), field("Note (optional)", textInput("note", t.note)))}`,
    (v) => {
      if (!num(v.amount)) return "Enter an amount that isn't 0.";
      const item = { ...t, id: t.id || Store.uid(), type: "adjust", accountId: v.accountId, amount: num(v.amount), date: v.date, note: v.note };
      return Store.commit((d) => upsertIn(d.transfers, item));
    }, { onDelete: id ? () => Store.commit((d) => removeFrom(d.transfers, id)) : null, deleteWhat: t.cashCount ? "correction" : "entry" });
  }

  // Cash / Bank / Crypto picker as a row of pill buttons (radio inputs underneath)
  const accountPicker = (name, value, label) => `
    <div class="field"><span class="field-label">${label}</span>
      <div class="seg">${accountOptions().map(([v, t]) =>
        `<label><input type="radio" name="${name}" value="${esc(v)}"${v === value ? " checked" : ""}><span>${esc(t)}</span></label>`).join("")}</div>
    </div>`;

  // Bill values offered in the "Count by bills" helper (shown when Cash is involved)
  const BILLS = [100, 50, 20, 10, 5];

  // The three money actions on the Accounts page. All typed as a positive number.
  // Saved in the same format as before, so older entries open in these forms:
  //   add  : adjustment + on the account (Bank can note who sent it in `from`)
  //   take : adjustment − on the account (money taken for yourself, not an expense)
  //   move : transfer from one account to the other (Cash → Bank = a deposit)
  const MONEY_KINDS = {
    add:  { title: "Add money",  edit: "Edit money added",     submit: "Add",      sign: 1,  label: "Into", hint: "e.g. Starting cash, Payment for 5 units" },
    take: { title: "Take out",   edit: "Edit money taken out", submit: "Take out", sign: -1, label: "From", hint: "e.g. Personal use, Paid myself" },
    move: { title: "Move money", edit: "Edit move",            submit: "Move",                            hint: "e.g. Weekly deposit" },
  };
  const moneyKindOf = (t) => t.type === "transfer" ? "move" : t.amount < 0 ? "take" : "add";

  // "Count by bills": enter how many of each bill, and the Amount (and a note
  // like "2 × $50, 3 × $20" if the note is empty) is filled in for you.
  function moneyForm(kind, id) {
    const t = id ? Store.get("transfers", id)
      : { amount: "", date: Calc.today(), note: "", from: "", accountId: CASH_ID, fromId: CASH_ID, toId: BANK_ID };
    if (id) kind = moneyKindOf(t);
    const k = MONEY_KINDS[kind];
    const isMove = kind === "move";
    // Balances without this entry, so the preview is right when editing
    const balances = Calc.balances({ ...Store.data, transfers: Store.data.transfers.filter((x) => x.id !== t.id) });
    const form = openForm(id ? k.edit : k.title, `
      ${isMove ? `<div class="field"><span class="field-label">Move</span>
        <div class="move-pick">
          ${select("fromId", accountOptions(), t.fromId, 'aria-label="From"')}
          <button type="button" class="btn btn-icon" data-swap aria-label="Swap direction">⇄</button>
          ${select("toId", accountOptions(), t.toId, 'aria-label="To"')}
        </div>
      </div>` : accountPicker("accountId", t.accountId || CASH_ID, k.label)}
      ${kind === "take" ? `<p class="field-hint">For yourself. Business costs go in Spent.</p>` : ""}
      <div data-bills>
        <p class="field-label">Count by bills (optional)</p>
        <div class="bills">
          ${BILLS.map((b) => `<label class="bill"><span>$${b} ×</span>${qtyInput("bill" + b, "", 'placeholder="0" data-bill="' + b + '"', 0)}</label>`).join("")}
          <label class="bill"><span>Coins / other $</span>${moneyInput("billOther", "", 'placeholder="0" data-bill="1"')}</label>
        </div>
      </div>
      ${kind === "add" ? `<div data-from-field>${field("From (optional)", textInput("from", t.from || "", `placeholder="e.g. a customer's name"`))}</div>` : ""}
      ${row(field("Amount", moneyInput("amount", t.amount === "" ? "" : Math.abs(t.amount), "required")),
            field("Date", dateInput("date", t.date, "required")))}
      ${field("Note (optional)", textInput("note", t.note, `placeholder="${k.hint}"`))}
      <div class="preview" data-preview></div>`,
    (v) => {
      if (!(num(v.amount) > 0)) return "Enter an amount above 0.";
      const base = { id: t.id || Store.uid(), date: v.date, note: v.note };
      let item;
      if (isMove) {
        item = { ...base, type: "transfer", fromId: v.fromId, toId: v.toId, amount: num(v.amount) };
      } else {
        item = { ...base, type: "adjust", accountId: v.accountId, amount: k.sign * num(v.amount) };
        if (kind === "add" && v.accountId !== CASH_ID && v.from) item.from = v.from;
      }
      return Store.commit((d) => upsertIn(d.transfers, item));
    }, { submitLabel: id ? "Save" : k.submit, onDelete: id ? () => Store.commit((d) => removeFrom(d.transfers, id)) : null });

    const billsWrap = form.querySelector("[data-bills]");
    const fromWrap = form.querySelector("[data-from-field]");
    const preview = form.querySelector("[data-preview]");
    const update = () => {
      const v = formValues(form);
      const src = isMove ? v.fromId : v.accountId;
      billsWrap.hidden = src !== CASH_ID;
      if (fromWrap) fromWrap.hidden = v.accountId === CASH_ID;
      const now = balances[src] || 0;
      const after = now + (isMove ? -1 : k.sign) * num(v.amount);
      preview.innerHTML = `<span>${esc(accountName(src))} <b>${money(now)}</b>${num(v.amount) ? ` → <b class="${after < 0 ? "neg" : ""}">${money(after)}</b>` : ""}</span>`;
    };
    // Move: the two sides can never be the same account. Picking the account
    // that is already on the other side swaps them.
    let sides = isMove ? [form.fromId.value, form.toId.value] : null;
    form.addEventListener("click", (e) => {
      if (!e.target.closest("[data-swap]")) return;
      sides = [sides[1], sides[0]];
      form.fromId.value = sides[0];
      form.toId.value = sides[1];
      update();
    });
    form.addEventListener("change", (e) => {
      if (isMove && (e.target.name === "fromId" || e.target.name === "toId")) {
        if (form.fromId.value === form.toId.value) {
          if (e.target.name === "fromId") form.toId.value = sides[0];
          else form.fromId.value = sides[1];
        }
        sides = [form.fromId.value, form.toId.value];
      }
      update();
    });

    let autoNote = ""; // the note we filled in, so we only replace our own text
    form.addEventListener("input", (e) => {
      if (e.target.dataset.bill) {
        let total = 0;
        const parts = [];
        for (const b of BILLS) {
          const n = Math.max(0, Math.floor(num(form["bill" + b].value)));
          if (n) { total += n * b; parts.push(`${n} × $${b}`); }
        }
        const other = Math.max(0, num(form.billOther.value));
        if (other) { total += other; parts.push(`${money(other)} coins/other`); }
        form.amount.value = total ? Calc.round2(total) : "";
        if (form.note.value === autoNote) form.note.value = autoNote = parts.join(", ");
      }
      update();
    });
    update();
  }

  // "Set balance": pick the account (unless given), enter what you actually
  // have now; the difference is saved as one adjustment (flagged cashCount), so
  // history and profits stay intact and deleting that entry undoes it.
  function setBalanceForm(accountId) {
    const balances = Calc.balances(Store.data);
    const form = openForm("Set balance", `
      <p class="field-hint">Enter what you actually have; the difference is saved as one correction.</p>
      ${accountId ? `<input type="hidden" name="accountId" value="${esc(accountId)}">` : accountPicker("accountId", CASH_ID, "Account")}
      <div class="preview" data-now></div>
      ${row(field("You have now", moneyInput("counted", "", "required")), field("Date", dateInput("date", Calc.today(), "required")))}
      <div class="preview" data-preview></div>`,
    (v) => {
      const balance = balances[v.accountId] || 0;
      const diff = Calc.round2(num(v.counted) - balance);
      if (diff === 0) return "That matches the tracker already, so nothing needs adjusting.";
      const item = { id: Store.uid(), type: "adjust", cashCount: true, accountId: v.accountId, amount: diff, date: v.date, note: `Balance set to ${money(num(v.counted))}` };
      return Store.commit((d) => d.transfers.push(item));
    }, { submitLabel: "Set balance" });
    const nowBox = form.querySelector("[data-now]");
    const preview = form.querySelector("[data-preview]");
    const update = () => {
      const v = formValues(form);
      const balance = balances[v.accountId] || 0;
      nowBox.innerHTML = `<span>${esc(accountName(v.accountId))} balance in tracker <b>${money(balance)}</b></span>`;
      const diff = num(v.counted) - balance;
      preview.innerHTML = v.counted === "" ? "" : `<span>Correction <b class="${tone(diff)}">${signed(diff)}</b></span>`;
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    update();
  }

  // ---------- Set stock (count what you actually have) ----------
  // Logs a stock adjustment for the difference between your count and the
  // tracker. Added units need a cost per unit; removed units leave at the
  // average cost. No money moves between accounts.
  function setStockForm(presetProductId) {
    if (!Store.data.products.length) return needProducts();
    const snap = Calc.snapshot(Store.data);
    const stockOf = (pid) => (snap.inv.byProduct[pid] ? snap.inv.byProduct[pid].qty : 0);
    const costOf = (pid) => {
      const c = Calc.currentUnitCost(Store.data, snap, pid);
      return c === null ? "" : Calc.round2(c);
    };
    const options = [["", "Choose a product…"], ...Store.data.products.slice().sort(byName).map((p) => [p.id, `${p.name} (${stockOf(p.id)} in stock)`])];
    const form = openForm("Set stock", `
      <p class="field-hint">Enter what you actually have; the difference is logged.</p>
      ${field("Product", select("productId", options, presetProductId || "", "required"))}
      ${row(field("Units you have", qtyInput("count", "", "required", 0)), field("Date", dateInput("date", Calc.today(), "required")))}
      <div data-cost-row hidden>${field("Cost per unit (for the added units)", moneyInput("unitCost", costOf(presetProductId)))}</div>
      ${field("Note (optional)", textInput("note", "", 'placeholder="e.g. Opening stock, recount"'))}
      <div class="preview" data-preview></div>`,
    (v) => {
      if (!v.productId) return "Choose a product.";
      const count = num(v.count);
      if (v.count === "" || !Number.isInteger(count) || count < 0) return "Units must be a whole number, 0 or more.";
      const change = count - stockOf(v.productId);
      if (change === 0) return "That matches the tracker already, so nothing needs adjusting.";
      if (change > 0 && v.unitCost === "") return "Enter the cost per unit for the added units.";
      const item = { id: Store.uid(), productId: v.productId, date: v.date, qty: change, unitCost: change > 0 ? num(v.unitCost) : null, note: v.note };
      return Store.commit((d) => d.stockAdjustments.push(item));
    }, {
      submitLabel: "Save stock",
      extra: presetProductId && stockOf(presetProductId) > 0 ? [["Record a sale…", () => saleForm(null, presetProductId)]] : [],
    });

    const costRow = form.querySelector("[data-cost-row]");
    const costInput = form.querySelector("[name=unitCost]");
    const preview = form.querySelector("[data-preview]");
    form.addEventListener("change", (e) => {
      if (e.target.name === "productId") costInput.value = costOf(e.target.value); // suggest the current cost
    });
    const update = () => {
      const v = formValues(form);
      if (!v.productId || v.count === "") { preview.innerHTML = ""; costRow.hidden = true; return; }
      const change = num(v.count) - stockOf(v.productId);
      costRow.hidden = !(change > 0);
      costInput.required = change > 0;
      preview.innerHTML = `<span>In tracker <b>${stockOf(v.productId)}</b></span>
        <span>Change <b class="${tone(change)}">${change > 0 ? "+" : ""}${change} units</b></span>`;
    };
    form.addEventListener("input", update);
    update();
  }

  // Edit an existing stock adjustment directly (+/− units)
  function stockAdjForm(id) {
    const a = Store.get("stockAdjustments", id);
    const form = openForm("Edit stock adjustment", `
      ${field("Product", select("productId", productOptions(), a.productId))}
      ${row(field("Units (+ added / − removed)", `<input name="qty" type="number" step="1" inputmode="numeric" required value="${a.qty}">`),
            field("Date", dateInput("date", a.date, "required")))}
      <div data-cost-row>${field("Cost per unit (for added units)", moneyInput("unitCost", a.unitCost))}</div>
      ${field("Note (optional)", textInput("note", a.note))}`,
    (v) => {
      const q = num(v.qty);
      if (!Number.isInteger(q) || q === 0) return "Units must be a whole number that isn't 0.";
      if (q > 0 && v.unitCost === "") return "Enter the cost per unit for the added units.";
      const item = { ...a, productId: v.productId, date: v.date, qty: q, unitCost: q > 0 ? num(v.unitCost) : null, note: v.note };
      return Store.commit((d) => upsertIn(d.stockAdjustments, item));
    }, { onDelete: () => Store.commit((d) => removeFrom(d.stockAdjustments, id)), deleteWhat: "stock adjustment" });
    const costRow = form.querySelector("[data-cost-row]");
    const update = () => { costRow.hidden = !(num(formValues(form).qty) > 0); };
    form.addEventListener("input", update);
    update();
  }

  // ================= Actions (buttons with data-action) =================
  function confirmDelete(what, list, id) {
    if (!confirm(`Delete this ${what}? This can't be undone.`)) return;
    report(Store.commit((d) => removeFrom(d[list], id)));
  }

  // Used by edit sheets (Delete / Undo receive at the bottom). Each returns
  // false (you said no), an error message, or null (done).
  function deleteProduct(id) {
    const d = Store.data;
    const uses = d.orders.filter((x) => x.productId === id).length + d.sales.filter((x) => x.productId === id).length +
      (d.stockAdjustments || []).filter((x) => x.productId === id).length;
    if (uses) return `This product is used by ${plural(uses, "order, sale or stock adjustment")}. Delete those first.`;
    const linked = d.expenses.filter((x) => x.productId === id).length;
    if (!confirm(`Delete "${productName(id)}"?${linked ? ` ${plural(linked, "linked expense")} will be kept, but unlinked.` : ""} This can't be undone.`)) return false;
    return Store.commit((dd) => {
      removeFrom(dd.products, id);
      dd.expenses.forEach((x) => { if (x.productId === id) x.productId = ""; });
    });
  }
  function unreceiveOrder(id) {
    if (!confirm("Move this order back to On the way? Its units leave your stock.")) return false;
    return Store.commit((d) => {
      const o = d.orders.find((x) => x.id === id);
      delete o.receivedDate;
      delete o.receivedQty;
    });
  }
  function deleteExpense(id) {
    const e = Store.get("expenses", id);
    const repeats = e.recurring === "weekly" || e.recurring === "monthly";
    if (!confirm(`Delete this expense?${repeats ? " It will also stop repeating (expenses already logged are kept)." : ""} This can't be undone.`)) return false;
    return Store.commit((d) => removeFrom(d.expenses, id));
  }
  const reportUnlessCancelled = (r) => { if (r !== false) report(r); };

  const ACTIONS = {
    "add-product": () => productForm(),
    "edit-product": productForm,
    "delete-product": (id) => reportUnlessCancelled(deleteProduct(id)),
    "add-order": () => orderForm(),
    "edit-order": orderForm,
    "receive-order": receiveForm,
    "unreceive-order": (id) => reportUnlessCancelled(unreceiveOrder(id)),
    "delete-order": (id) => confirmDelete("order", "orders", id),
    "add-sale": () => saleForm(),
    "quick-sale": () => saleForm(null, null, { quick: true }),
    "mark-paid": paymentForm,
    "sell-product": (id) => saleForm(null, id),
    "edit-sale": saleForm,
    "delete-sale": (id) => confirmDelete("sale", "sales", id),
    "add-expense": () => expenseForm(),
    "edit-expense": expenseForm,
    "delete-expense": (id) => reportUnlessCancelled(deleteExpense(id)),
    "manage-categories": categoriesForm,
    "add-account": () => accountForm(),
    "edit-account": accountForm,
    "delete-account": (id) => {
      if (PNL_BUILT_IN.some(([x]) => x === id)) return alert("The built-in Cash, Bank and Crypto accounts can't be deleted.");
      if (isUsedAccount(id)) return alert("This account has entries linked to it. Move or delete those first.");
      confirmDelete("account", "accounts", id);
    },
    "set-balance": (id) => setBalanceForm(id),
    "set-stock": (id) => setStockForm(id),
    "edit-stock-adj": stockAdjForm,
    "delete-stock-adj": (id) => confirmDelete("stock adjustment", "stockAdjustments", id),
    "add-transfer": () => transferForm(),
    "add-adjust": () => adjustForm(),
    "acct-add": () => moneyForm("add"),
    "acct-take": () => moneyForm("take"),
    "acct-move": () => moneyForm("move"),
    // Tile / chip: show only that account's entries (tap the active tile again for All)
    "acct-filter": (id = "") => {
      acctUi.filter = acctUi.filter === id && id ? "" : id;
      acctUi.shown = HISTORY_STEP;
      render();
    },
    "acct-more": () => { acctUi.shown += HISTORY_STEP; render(); },
    "edit-transfer": (id) => {
      const t = Store.get("transfers", id);
      if (!t) return;
      if (t.cashCount) return adjustForm(id);
      const builtIn = (x) => PNL_BUILT_IN.some(([b]) => b === x);
      if (t.type === "transfer" && !(builtIn(t.fromId) && builtIn(t.toId))) return transferForm(id);
      return moneyForm(null, id);
    },
    "delete-transfer": (id) => confirmDelete("entry", "transfers", id),
    // One backup file holds both PnL and Life (Backup in life-store.js)
    export: () => Backup.download(),
    import: () => Backup.chooseAndImport(),
  };
  document.addEventListener("lifetracker:imported", () => render());

  function closeMenus() {
    root.querySelectorAll(".menu:not([hidden])").forEach((m) => {
      m.hidden = true;
      const b = m.parentElement.querySelector("[data-action=menu]");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (b && b.dataset.action === "menu") {
      // ⋯ button: open its menu (closing any other)
      const menu = b.parentElement.querySelector(".menu");
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      b.setAttribute("aria-expanded", String(open));
      if (open) { const first = menu.querySelector(".menu-item"); if (first) first.focus(); }
      return;
    }
    closeMenus();
    if (b && ACTIONS[b.dataset.action]) ACTIONS[b.dataset.action](b.dataset.id);
  });
  document.addEventListener("click", (e) => { if (!root.contains(e.target)) closeMenus(); });
  // Tappable rows: Enter / Space open them like a button; Escape closes a menu
  root.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-action]")) { e.preventDefault(); e.target.click(); }
    if (e.key === "Escape") closeMenus();
  });
  // Chart: hover with a mouse, tap on a phone
  root.addEventListener("mouseover", (e) => {
    const g = e.target.closest && e.target.closest(".chart-col");
    if (g) pickChartMonth(g.dataset.month);
  });
  root.addEventListener("click", (e) => {
    const g = e.target.closest(".chart-col");
    if (g) pickChartMonth(g.dataset.month);
  });
  // Redraw the chart at the new width when the window is resized
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (view !== "dashboard") return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });
  root.addEventListener("change", (e) => {
    if (e.target.dataset.filter) {
      spentFilter[e.target.dataset.filter] = e.target.value;
      render();
    }
  });

  // ================= Drawing =================
  // The sub-tab bar is drawn once and kept, so its bubble can slide between
  // tabs; only the page below it is replaced. animate = slide the new page in
  // (when switching sub-tab); other redraws (after an edit, resize) are instant.
  const viewIndex = (key) => VIEWS.findIndex(([k]) => k === key);
  function render(animate = false) {
    const snap = Calc.snapshot(Store.data);
    let nav = root.querySelector(".subnav");
    if (!nav) {
      root.innerHTML = `<nav class="subnav" aria-label="PnL pages">${VIEWS.map(([key, label]) =>
        `<a href="#pnl/${key}" class="subnav-link" data-view="${key}">${label}</a>`).join("")}</nav><div class="pnl-pages"></div>`;
      nav = root.querySelector(".subnav");
    }
    nav.querySelectorAll(".subnav-link").forEach((a) => a.classList.toggle("active", a.dataset.view === view));

    const holder = root.querySelector(".pnl-pages");
    const old = holder.querySelector(".pnl-page:not(.leaving)");
    const page = document.createElement("div");
    page.className = "pnl-page";
    page.dataset.view = view;
    page.innerHTML = PAGES[view](Store.data, snap);
    holder.insertBefore(page, old); // new page first, so lookups find it rather than the fading one
    const dir = animate && old ? Math.sign(viewIndex(view) - viewIndex(old.dataset.view)) : 0;
    if (old) slidePage(old, page, dir, () => old.remove());

    moveBubble(nav);
    scrollActiveIntoView(nav);
  }

  let onPnl = false; // was the PnL tab showing before this hash change?
  function readHash() {
    const [tab, sub] = location.hash.replace("#", "").split("/");
    onPnl = !tab || tab === "pnl";
    if (!onPnl) return false;
    view = VIEWS.some(([k]) => k === sub) ? sub : "dashboard";
    return true;
  }

  window.addEventListener("hashchange", () => { const was = onPnl; if (readHash()) render(was); });

  // Day counts ("ordered 3 days ago", "overdue by 2 days") and repeating
  // expenses stay current if the page is left open past midnight.
  let lastDay = Calc.today();
  setInterval(() => {
    if (Calc.today() === lastDay) return;
    lastDay = Calc.today();
    Store.runRecurring();
    render();
  }, 60000);

  Store.load();
  readHash();
  render();
})();
