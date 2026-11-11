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

  const productName = (id) => { const p = Store.get("products", id); return p ? p.name : "(deleted product)"; };
  const accountName = (id) => { const a = Store.get("accounts", id); return a ? a.name : "(deleted account)"; };
  const isDeposit = (t) => t.type === "transfer" && t.fromId === CASH_ID && t.toId === BANK_ID;
  const isUsedAccount = (id) => {
    const d = Store.data;
    return d.orders.some((x) => x.accountId === id) || d.sales.some((x) => x.accountId === id) ||
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
  const rowActions = (items) => `<div class="row-actions">${items.map(([label, action, id, cls]) => btn(label, action, id, "btn-sm " + (cls || "btn-ghost"))).join("")}</div>`;
  const sectionHead = (title, actions = "") => `<div class="section-head"><h2>${title}</h2><div class="section-actions">${actions}</div></div>`;
  const stat = (label, value, sub = "", cls = "") =>
    `<div class="card stat"><div class="stat-label">${label}</div><div class="stat-value ${cls}">${value}</div>${sub ? `<div class="stat-sub">${sub}</div>` : ""}</div>`;
  const muted = (text) => (text ? `<div class="muted">${text}</div>` : "");
  const badge = (text, cls = "") => `<span class="badge ${cls}">${text}</span>`;
  const empty = (text) => `<div class="card empty">${text}</div>`;

  // cols: [{ label, num? }], rows: [{ cells: [html...], cls? }]
  function table(cols, rows, emptyText) {
    if (!rows.length) return empty(emptyText);
    const head = cols.map((c) => `<th class="${c.num ? "num" : ""}">${c.label}</th>`).join("");
    const body = rows.map((r) => `<tr class="${r.cls || ""}">${r.cells.map((cell, i) =>
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
  // "Paid from / into" picker (Cash or Bank, default Cash). Hidden if only
  // one account exists, then everything goes to Cash.
  const accountField = (label, value) => Store.data.accounts.length > 1
    ? field(label, select("accountId", accountOptions(), value))
    : `<input type="hidden" name="accountId" value="${esc(value || CASH_ID)}">`;

  // Opens a form in the shared modal. onSubmit(values, form) returns an error
  // message to show, or nothing on success (then the modal closes and the page redraws).
  function openForm(title, fieldsHtml, onSubmit, opts = {}) {
    const body = openModal(title, `
      <form class="form">
        ${fieldsHtml}
        <div class="form-error" hidden></div>
        <div class="form-actions">
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
      ${!data.products.length ? `<div class="card notice">Start by adding your products in <a href="#pnl/products">Products</a>, and your starting cash in <a href="#pnl/accounts">Accounts</a> (Add money).</div>` : ""}
      ${overdue ? `<a class="card notice warn" href="#pnl/orders">${plural(overdue, "order")} overdue: check On the way</a>` : ""}
      <div class="card capital">
        <div class="stat-label">Total capital</div>
        <div class="capital-value">${money(snap.capital)}</div>
        <div class="capital-parts">
          <div><span class="muted">Cash</span><b>${money(snap.balances[CASH_ID] || 0)}</b></div>
          <div><span class="muted">Bank</span><b>${money(snap.balances[BANK_ID] || 0)}</b></div>
          <div><span class="muted">Stock in hand</span><b>${money(snap.stockValue)}</b></div>
        </div>
      </div>
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
          ${profitable.length ? `<p class="muted small">Net profit: sales − cost of goods − expenses linked to the product.</p>` : ""}</div>
      </div>`;
  };

  // ---------- Products ----------
  PAGES.products = (data, snap) => {
    const rows = data.products.slice().sort(byName).map((p) => {
      const cost = Calc.currentUnitCost(data, snap, p.id);
      const st = snap.inv.byProduct[p.id];
      return {
        cells: [
          `<b>${esc(p.name)}</b>${muted(esc(p.notes))}`,
          tierList(p, cost),
          cost === null ? `<span class="muted">Not known yet</span>` : money(cost),
          st && st.qty ? String(st.qty) : "0",
          rowActions([["Set stock", "set-stock", p.id], ["Edit", "edit-product", p.id], ["Delete", "delete-product", p.id, "btn-ghost danger"]]),
        ],
      };
    });
    return sectionHead("Products", btn("Add product", "add-product", "", "btn-primary")) +
      table([{ label: "Product" }, { label: "Price tiers (per unit · margin)" }, { label: "Landed cost/unit", num: true }, { label: "In stock", num: true }, { label: "" }],
        rows, "No products yet. Add the things you sell, with their prices per unit at each quantity tier.") +
      `<p class="muted small">Margin = tier price − current landed cost per unit (average of stock in hand, or the latest incoming order). Margin % = margin ÷ tier price.</p>`;
  };

  // A product's tiers, one per line: "10–49  $40.00  +$12.00 (30%)"
  function tierList(p, cost) {
    const tiers = Calc.productTiers(p);
    if (!tiers.length) return `<span class="muted">No prices set</span>`;
    return `<div class="tier-list">${tiers.map((t) => {
      const m = Calc.margin(t.price, cost);
      const marginHtml = m.perUnit === null ? "" :
        `<span class="${tone(m.perUnit)}">${signed(m.perUnit)}${m.pct === null ? "" : ` (${Math.round(m.pct)}%)`}</span>`;
      return `<div class="tier-line"><span class="muted">${Calc.tierRange(tiers, t.min)}</span><b>${money(t.price)}</b>${marginHtml}</div>`;
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
        cls: overdue ? "overdue" : "",
        cells: [
          `<b>${esc(productName(o.productId))}</b>${muted(esc(o.supplier))}`,
          String(o.qty),
          money(Calc.orderTotal(o)) + muted(`${money(Calc.landedUnitCost(o))}/unit`),
          fmtDate(o.orderDate) + muted(`${plural(since, "day")} ago`),
          fmtDate(o.expectedDate),
          status,
          rowActions([["Received", "receive-order", o.id, "btn-primary"], ["Edit", "edit-order", o.id], ["Delete", "delete-order", o.id, "btn-ghost danger"]]),
        ],
      };
    });

    const receivedRows = received.map((o) => ({
      cells: [
        `<b>${esc(productName(o.productId))}</b>${muted(esc(o.supplier))}`,
        `${o.receivedQty}${Number(o.receivedQty) !== Number(o.qty) ? muted(`of ${o.qty} ordered`) : ""}`,
        money(Calc.orderTotal(o)) + muted(`${money(Calc.landedUnitCost(o))}/unit`),
        fmtDate(o.orderDate),
        fmtDate(o.receivedDate),
        rowActions([["Edit", "edit-order", o.id], ["Undo receive", "unreceive-order", o.id], ["Delete", "delete-order", o.id, "btn-ghost danger"]]),
      ],
    }));

    return sectionHead("On the way", btn("Add order", "add-order", "", "btn-primary")) +
      `<div class="stats">
        ${stat("Orders on the way", String(incoming.length))}
        ${stat("Units on the way", String(snap.onTheWayUnits))}
        ${stat("Value on the way", money(snap.onTheWayValue))}
      </div>` +
      table([{ label: "Product" }, { label: "Qty", num: true }, { label: "Total cost", num: true }, { label: "Ordered" }, { label: "Expected" }, { label: "Arrival" }, { label: "" }],
        rows, "Nothing on the way. Add an order when you buy stock.") +
      (received.length ? `<details class="history"><summary>Received orders (${received.length})</summary>${table(
        [{ label: "Product" }, { label: "Qty received", num: true }, { label: "Total cost", num: true }, { label: "Ordered" }, { label: "Received" }, { label: "" }],
        receivedRows, "")}</details>` : "");
  };

  // ---------- In hand ----------
  PAGES.stock = (data, snap) => {
    const items = data.products
      .map((p) => ({ p, st: snap.inv.byProduct[p.id] }))
      .filter((x) => x.st && x.st.qty !== 0)
      .sort((a, b) => byName(a.p, b.p));
    const rows = items.map(({ p, st }) => ({
      cells: [
        `<b>${esc(p.name)}</b>${muted(st.batches ? `From ${plural(st.batches, "order")}` : "Set manually")}`,
        st.qty < 0 ? `<span class="neg">${st.qty}</span>` : String(st.qty),
        money(st.avgCost),
        money(st.value),
        rowActions([
          ...(st.qty > 0 ? [["Record sale", "sell-product", p.id, "btn-primary"]] : []),
          ["Set stock", "set-stock", p.id],
        ]),
      ],
    }));

    const adjustments = (data.stockAdjustments || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const adjRows = adjustments.map((a) => ({
      cells: [
        fmtDate(a.date),
        `<b>${esc(productName(a.productId))}</b>${muted(esc(a.note))}`,
        `<span class="${tone(a.qty)}">${a.qty > 0 ? "+" : ""}${a.qty}</span>`,
        a.qty > 0 ? money(a.unitCost) : `<span class="muted">Avg cost</span>`,
        rowActions([["Edit", "edit-stock-adj", a.id], ["Delete", "delete-stock-adj", a.id, "btn-ghost danger"]]),
      ],
    }));

    return sectionHead("In hand", btn("Set stock", "set-stock") + btn("Record sale", "add-sale", "", "btn-primary")) +
      `<div class="stats">
        ${stat("Units in stock", String(snap.stockUnits))}
        ${stat("Inventory value", money(snap.stockValue))}
      </div>` +
      table([{ label: "Product" }, { label: "Qty on hand", num: true }, { label: "Avg landed cost/unit", num: true }, { label: "Stock value", num: true }, { label: "" }],
        rows, "No stock in hand. Received orders appear here, or use “Set stock” to enter stock you already have.") +
      `<p class="muted small">Stock of the same product from several orders is combined at a weighted average cost.</p>` +
      (adjustments.length ? `<details class="history"><summary>Stock adjustments (${adjustments.length})</summary>${table(
        [{ label: "Date" }, { label: "Product" }, { label: "Units", num: true }, { label: "Cost/unit", num: true }, { label: "" }],
        adjRows, "")}</details>` : "");
  };

  // ---------- Sales ----------
  PAGES.sales = (data, snap) => {
    const month = Calc.monthOf(Calc.today());
    const m = Calc.periodStats(data, snap, month);
    const all = Calc.periodStats(data, snap, null);
    const rows = data.sales.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((s) => {
      const profit = Calc.saleProfit(s, snap);
      return {
        cells: [
          fmtDate(s.date),
          `<b>${esc(productName(s.productId))}</b>${muted(esc(s.buyer))}`,
          String(s.qty),
          money(Calc.saleUnitPrice(s)),
          money(Calc.saleRevenue(s)),
          money(Calc.saleCost(s, snap)),
          `<span class="${tone(profit)}">${money(profit)}</span>`,
          esc(accountName(s.accountId)),
          rowActions([["Edit", "edit-sale", s.id], ["Delete", "delete-sale", s.id, "btn-ghost danger"]]),
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
        { label: "Cost", num: true }, { label: "Profit", num: true }, { label: "Paid into" }, { label: "" }],
        rows, "No sales yet.") +
      `<p class="muted small">Profit per sale = revenue − landed cost of the units sold (weighted average).</p>`;
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
        cells: [
          fmtDate(e.date),
          esc(e.category),
          `${esc(e.description) || '<span class="muted">—</span>'} ${tag}`,
          e.productId ? esc(productName(e.productId)) : `<span class="muted">—</span>`,
          esc(accountName(e.accountId)),
          money(e.amount),
          rowActions([["Edit", "edit-expense", e.id], ["Delete", "delete-expense", e.id, "btn-ghost danger"]]),
        ],
      };
    });

    return sectionHead("Spent", btn("Categories", "manage-categories") + btn("Add expense", "add-expense", "", "btn-primary")) +
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
      table([{ label: "Date" }, { label: "Category" }, { label: "Description" }, { label: "Product" }, { label: "Paid from" }, { label: "Amount", num: true }, { label: "" }],
        rows, "No expenses in this period.");
  };

  // ---------- Accounts ----------
  PAGES.accounts = (data, snap) => {
    // Money added, spent, deposited or received by hand (adjustments and
    // transfers), newest first
    const rows = data.transfers.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => {
      const isAdjust = t.type === "adjust";
      const kind = !isAdjust ? (isDeposit(t) ? "Deposit" : "Transfer")
        : t.cashCount ? "Cash count"
        : t.amount < 0 ? "Spent"
        : t.accountId === BANK_ID ? "Received" : "Added";
      const note = [t.from ? "From " + esc(t.from) : "", esc(t.note)].filter(Boolean).join(" · ");
      return {
        cells: [
          fmtDate(t.date),
          isAdjust ? esc(accountName(t.accountId)) : `${esc(accountName(t.fromId))} → ${esc(accountName(t.toId))}`,
          kind,
          note || muted("No note"),
          isAdjust ? `<span class="${tone(t.amount)}">${signed(t.amount)}</span>` : money(t.amount),
          rowActions([["Edit", "edit-transfer", t.id], ["Delete", "delete-transfer", t.id, "btn-ghost danger"]]),
        ],
      };
    });
    const cash = snap.balances[CASH_ID] || 0;
    const bank = snap.balances[BANK_ID] || 0;
    const balanceCard = (label, value, hint, actions) => `
      <div class="card">
        <div class="stat-label">${label}</div>
        <div class="capital-value ${value < 0 ? "neg" : ""}">${money(value)}</div>
        <p class="muted">${hint}</p>
        <div class="section-actions">${actions}</div>
      </div>`;

    return sectionHead("Accounts") +
      `<div class="card capital">
        <div class="stat-label">Overall balance</div>
        <div class="capital-value ${snap.cashTotal < 0 ? "neg" : ""}">${money(snap.cashTotal)}</div>
        <div class="capital-parts">
          <div><span class="muted">Cash</span><b>${money(cash)}</b></div>
          <div><span class="muted">Bank</span><b>${money(bank)}</b></div>
        </div>
      </div>
      <div class="panels">
        ${balanceCard("Cash", cash, "Sales, orders and expenses use Cash unless you pick Bank.",
          btn("Spend", "spend-money") + btn("Add money", "add-money", "", "btn-primary"))}
        ${balanceCard("Bank", bank, "Deposit cash, log transfers people send you, and money spent from the bank.",
          btn("Spend", "bank-spend") + btn("Received transfer", "bank-receive") + btn("Deposit cash", "bank-deposit", "", "btn-primary"))}
      </div>
      <h3 class="group-title">Money in and out</h3>` +
      table([{ label: "Date" }, { label: "Account" }, { label: "Type" }, { label: "Note" }, { label: "Amount", num: true }, { label: "" }],
        rows, "Nothing added, spent or deposited by hand yet.") +
      `<h3 class="group-title">Backup</h3>
      <div class="card backup">
        <p class="muted">Your data is saved in this browser only. Export a backup file now and then, and import it to restore your data or move it to another device.</p>
        <div class="section-actions">
          ${btn("Export backup", "export")}
          <label class="btn">Import backup<input type="file" accept=".json,application/json" id="pnl-import" hidden></label>
        </div>
      </div>`;
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
        <span class="field-hint">A sale uses the tier with the highest “from” qty it reaches (e.g. 120 units uses the 100+ price).</span>
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
      <p class="muted">Ordered ${o.qty} on ${fmtDate(o.orderDate)}. If some units arrived damaged or missing, lower the quantity: the full order cost is then spread over the units you received.</p>
      ${row(field("Received date", dateInput("receivedDate", Calc.today(), "required")),
            field("Quantity received", qtyInput("receivedQty", o.qty, "required", 0)))}
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
  function saleForm(id, presetProductId) {
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
    const form = openForm(id ? "Edit sale" : "Record sale", `
      ${field("Product", select("productId", options, s.productId, "required"))}
      ${field("Quantity sold", qtyInput("qty", s.qty, "required"))}
      ${row(field("Price per unit", moneyInput("unitPrice", s.unitPrice)),
            field("OR total for the lot", moneyInput("lotTotal", hasTotal ? s.total : "")))}
      <p class="field-hint"><span data-tier-hint></span> <button type="button" class="link" data-use-tier>Use tier price</button></p>
      ${row(field("Date", dateInput("date", s.date, "required")),
            accountField("Paid into", s.accountId))}
      ${field("Buyer / location (optional)", textInput("buyer", s.buyer))}
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
      return Store.commit((d) => upsertIn(d.sales, item));
    });

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
      preview.innerHTML = `<span>Revenue <b>${money(revenue)}</b></span><span>Cost <b>${money(cost)}</b></span>
        <span>Profit <b class="${tone(revenue - cost)}">${money(revenue - cost)}</b></span>`;
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
    update();
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
      ${field("For product (optional)", select("productId", productOptions("Not linked to a product"), e.productId || ""), "Linked expenses count against that product's profit.")}
      ${canRepeat ? field("Repeats", select("recurring", [["none", "Doesn't repeat"], ["weekly", "Every week"], ["monthly", "Every month"]], e.recurring || "none"),
        "Repeats are logged automatically from this date. Set to “Doesn't repeat” to stop.") : `<p class="muted small">Auto-logged from a repeating expense.</p>`}`,
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
    });
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
    });
  }

  function adjustForm(id) {
    const t = id ? Store.get("transfers", id) : { accountId: CASH_ID, amount: "", date: Calc.today(), note: "" };
    openForm(id ? "Edit adjustment" : "Manual adjustment", `
      <p class="muted">Use a positive amount to add money and a negative amount (e.g. -20) to remove it.</p>
      ${row(field("Account", select("accountId", accountOptions(), t.accountId)),
            field("Amount (+/−)", `<input name="amount" type="number" step="0.01" inputmode="decimal" required value="${t.amount ?? ""}">`))}
      ${row(field("Date", dateInput("date", t.date, "required")), field("Note (optional)", textInput("note", t.note)))}`,
    (v) => {
      if (!num(v.amount)) return "Enter an amount that isn't 0.";
      const item = { ...t, id: t.id || Store.uid(), type: "adjust", accountId: v.accountId, amount: num(v.amount), date: v.date, note: v.note };
      return Store.commit((d) => upsertIn(d.transfers, item));
    });
  }

  // Bill values offered in the "Count by bills" helper on the Add / Spend money form
  const BILLS = [100, 50, 20, 10, 5];

  // The kinds of money entry on the Accounts page. All typed as a positive number.
  //   add / spend          : Cash adjustment, + or −
  //   deposit              : transfer Cash → Bank (cash taken to the bank)
  //   receive / bank-spend : Bank adjustment, + (someone sent you money) or −
  const MONEY_KINDS = {
    add:          { title: "Add money",            edit: "Edit money added",    submit: "Add",     account: CASH_ID, sign: 1,  bills: true,  hint: "e.g. Starting cash, Put in from savings" },
    spend:        { title: "Spend money",          edit: "Edit money spent",    submit: "Spend",   account: CASH_ID, sign: -1, bills: true,  hint: "e.g. Took out for personal use" },
    deposit:      { title: "Deposit cash to bank", edit: "Edit deposit",        submit: "Deposit", bills: true,  hint: "e.g. Weekly deposit" },
    receive:      { title: "Received transfer",    edit: "Edit transfer received", submit: "Add",  account: BANK_ID, sign: 1,  from: true,   hint: "e.g. Payment for 5 units" },
    "bank-spend": { title: "Spend from bank",      edit: "Edit bank spending",  submit: "Spend",   account: BANK_ID, sign: -1, hint: "e.g. Card payment, Rent" },
  };
  const moneyKindOf = (t) => isDeposit(t) ? "deposit"
    : t.accountId === BANK_ID ? (t.amount < 0 ? "bank-spend" : "receive")
    : (t.amount < 0 ? "spend" : "add");

  // Add / spend / deposit / receive form. Cash entries are saved as adjustments
  // (positive = in, negative = out); a deposit is a transfer Cash → Bank, so it
  // lowers Cash and raises Bank by the same amount (overall balance unchanged).
  // "Count by bills": enter how many of each bill, and the Amount (and a note
  // like "2 × $50, 3 × $20" if the note is empty) is filled in for you.
  function moneyForm(kind, id) {
    const t = id ? Store.get("transfers", id) : { amount: "", date: Calc.today(), note: "", from: "" };
    if (id) kind = moneyKindOf(t);
    const k = MONEY_KINDS[kind];
    const cashNow = (Calc.balances(Store.data)[CASH_ID] || 0) + (id && kind === "deposit" ? Number(t.amount) || 0 : 0);
    const form = openForm(id ? k.edit : k.title, `
      ${kind === "deposit" ? `<p class="muted">Moves money from Cash to Bank. Cash on hand in the tracker: <b>${money(cashNow)}</b></p>` : ""}
      ${k.bills ? `<p class="field-label">Count by bills (optional)</p>
      <div class="bills">
        ${BILLS.map((b) => `<label class="bill"><span>$${b} ×</span>${qtyInput("bill" + b, "", 'placeholder="0" data-bill="' + b + '"', 0)}</label>`).join("")}
        <label class="bill"><span>Coins / other $</span>${moneyInput("billOther", "", 'placeholder="0" data-bill="1"')}</label>
      </div>` : ""}
      ${k.from ? field("From (who sent it)", textInput("from", t.from || "", 'placeholder="e.g. a customer\'s name"')) : ""}
      ${row(field("Amount", moneyInput("amount", t.amount === "" ? "" : Math.abs(t.amount), "required")),
            field("Date", dateInput("date", t.date, "required")))}
      ${field("Note (optional)", textInput("note", t.note, `placeholder="${k.hint}"`))}`,
    (v) => {
      if (!(num(v.amount) > 0)) return "Enter an amount above 0.";
      const base = { id: t.id || Store.uid(), date: v.date, note: v.note };
      const item = kind === "deposit"
        ? { ...base, type: "transfer", fromId: CASH_ID, toId: BANK_ID, amount: num(v.amount) }
        : { ...base, type: "adjust", accountId: k.account, amount: k.sign * num(v.amount), ...(k.from ? { from: v.from } : {}) };
      return Store.commit((d) => upsertIn(d.transfers, item));
    }, { submitLabel: k.submit });

    if (!k.bills) return;

    let autoNote = ""; // the note we filled in, so we only replace our own text
    form.addEventListener("input", (e) => {
      if (!e.target.dataset.bill) return;
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
    });
  }

  function cashCountForm() {
    const balance = Calc.balances(Store.data)[CASH_ID] || 0;
    const form = openForm("Cash count", `
      <p class="muted">Count the cash you actually have. The difference from the tracker's Cash balance is logged as an adjustment, so the two match.</p>
      <div class="preview"><span>Cash balance in tracker <b>${money(balance)}</b></span></div>
      ${row(field("Cash counted", moneyInput("counted", "", "required")), field("Date", dateInput("date", Calc.today(), "required")))}
      <div class="preview" data-preview></div>`,
    (v) => {
      const diff = Calc.round2(num(v.counted) - balance);
      if (diff === 0) return "That matches the tracker already, so nothing needs adjusting.";
      const item = { id: Store.uid(), type: "adjust", cashCount: true, accountId: CASH_ID, amount: diff, date: v.date, note: `Counted ${money(num(v.counted))}` };
      return Store.commit((d) => d.transfers.push(item));
    }, { submitLabel: "Log adjustment" });
    const preview = form.querySelector("[data-preview]");
    form.addEventListener("input", () => {
      const v = formValues(form);
      const diff = num(v.counted) - balance;
      preview.innerHTML = v.counted === "" ? "" : `<span>Adjustment <b class="${tone(diff)}">${signed(diff)}</b></span>`;
    });
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
      <p class="muted">Enter how many units you actually have. The difference from the tracker is logged as a stock adjustment, e.g. for stock you had before you started tracking, or after a recount.</p>
      ${field("Product", select("productId", options, presetProductId || "", "required"))}
      ${row(field("Units you have", qtyInput("count", "", "required", 0)), field("Date", dateInput("date", Calc.today(), "required")))}
      <div data-cost-row hidden>${field("Cost per unit (for the added units)", moneyInput("unitCost", costOf(presetProductId)), "What each unit cost you. Used for stock value and profit.")}</div>
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
    }, { submitLabel: "Save stock" });

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
    });
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

  const ACTIONS = {
    "add-product": () => productForm(),
    "edit-product": productForm,
    "delete-product": (id) => {
      const d = Store.data;
      const uses = d.orders.filter((x) => x.productId === id).length + d.sales.filter((x) => x.productId === id).length +
        (d.stockAdjustments || []).filter((x) => x.productId === id).length;
      if (uses) return alert(`This product is used by ${plural(uses, "order, sale or stock adjustment")}. Delete those first.`);
      const linked = d.expenses.filter((x) => x.productId === id).length;
      if (!confirm(`Delete "${productName(id)}"?${linked ? ` ${plural(linked, "linked expense")} will be kept, but unlinked.` : ""} This can't be undone.`)) return;
      report(Store.commit((dd) => {
        removeFrom(dd.products, id);
        dd.expenses.forEach((x) => { if (x.productId === id) x.productId = ""; });
      }));
    },
    "add-order": () => orderForm(),
    "edit-order": orderForm,
    "receive-order": receiveForm,
    "unreceive-order": (id) => {
      if (!confirm("Move this order back to On the way? Its units leave your stock.")) return;
      report(Store.commit((d) => {
        const o = d.orders.find((x) => x.id === id);
        delete o.receivedDate;
        delete o.receivedQty;
      }));
    },
    "delete-order": (id) => confirmDelete("order", "orders", id),
    "add-sale": () => saleForm(),
    "sell-product": (id) => saleForm(null, id),
    "edit-sale": saleForm,
    "delete-sale": (id) => confirmDelete("sale", "sales", id),
    "add-expense": () => expenseForm(),
    "edit-expense": expenseForm,
    "delete-expense": (id) => {
      const e = Store.get("expenses", id);
      const repeats = e.recurring === "weekly" || e.recurring === "monthly";
      if (!confirm(`Delete this expense?${repeats ? " It will also stop repeating (expenses already logged are kept)." : ""} This can't be undone.`)) return;
      report(Store.commit((d) => removeFrom(d.expenses, id)));
    },
    "manage-categories": categoriesForm,
    "add-account": () => accountForm(),
    "edit-account": accountForm,
    "delete-account": (id) => {
      if (id === CASH_ID || id === BANK_ID) return alert("The built-in Cash and Bank accounts can't be deleted.");
      if (isUsedAccount(id)) return alert("This account has entries linked to it. Move or delete those first.");
      confirmDelete("account", "accounts", id);
    },
    "cash-count": cashCountForm,
    "set-stock": (id) => setStockForm(id),
    "edit-stock-adj": stockAdjForm,
    "delete-stock-adj": (id) => confirmDelete("stock adjustment", "stockAdjustments", id),
    "add-transfer": () => transferForm(),
    "add-adjust": () => adjustForm(),
    "add-money": () => moneyForm("add"),
    "spend-money": () => moneyForm("spend"),
    "bank-deposit": () => moneyForm("deposit"),
    "bank-receive": () => moneyForm("receive"),
    "bank-spend": () => moneyForm("bank-spend"),
    "edit-transfer": (id) => {
      const t = Store.get("transfers", id);
      if (t.type !== "adjust") return isDeposit(t) ? moneyForm(null, id) : transferForm(id);
      return t.cashCount ? adjustForm(id) : moneyForm(null, id);
    },
    "delete-transfer": (id) => confirmDelete("entry", "transfers", id),
    export: () => {
      const blob = new Blob([Store.exportText()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `life-tracker-pnl-backup-${Calc.today()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  };

  function importFile(input) {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    if (!confirm("Replace ALL current PnL data with this backup? Export a backup of the current data first if you might need it.")) return;
    file.text().then((text) => {
      try {
        Store.importText(text);
        render();
        alert("Backup imported.");
      } catch (err) {
        alert("Couldn't import that file: " + err.message);
      }
    });
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (b && ACTIONS[b.dataset.action]) ACTIONS[b.dataset.action](b.dataset.id);
  });
  root.addEventListener("change", (e) => {
    if (e.target.dataset.filter) {
      spentFilter[e.target.dataset.filter] = e.target.value;
      render();
    } else if (e.target.id === "pnl-import") {
      importFile(e.target);
    }
  });

  // ================= Drawing =================
  function render() {
    const snap = Calc.snapshot(Store.data);
    const nav = `<nav class="subnav" aria-label="PnL pages">${VIEWS.map(([key, label]) =>
      `<a href="#pnl/${key}" class="subnav-link${key === view ? " active" : ""}">${label}</a>`).join("")}</nav>`;
    root.innerHTML = nav + `<div class="pnl-page">${PAGES[view](Store.data, snap)}</div>`;
  }

  function readHash() {
    const [tab, sub] = location.hash.replace("#", "").split("/");
    if (tab && tab !== "pnl") return false;
    view = VIEWS.some(([k]) => k === sub) ? sub : "dashboard";
    return true;
  }

  window.addEventListener("hashchange", () => { if (readHash()) render(); });

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
