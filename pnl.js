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
      ${!data.products.length ? `<div class="card notice">Start by adding your products in <a href="#pnl/products">Products</a>, and your starting balances in <a href="#pnl/accounts">Accounts</a>.</div>` : ""}
      ${overdue ? `<a class="card notice warn" href="#pnl/orders">${plural(overdue, "order")} overdue: check On the way</a>` : ""}
      <div class="card capital">
        <div class="stat-label">Total capital</div>
        <div class="capital-value">${money(snap.capital)}</div>
        <div class="capital-parts">
          <div><span class="muted">Cash in accounts</span><b>${money(snap.cashTotal)}</b></div>
          <div><span class="muted">Stock in hand</span><b>${money(snap.stockValue)}</b></div>
          <div><span class="muted">Stock on the way</span><b>${money(snap.onTheWayValue)}</b></div>
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
      const priceCell = (key) => {
        const v = p.prices && p.prices[key];
        if (v === null || v === undefined || v === "") return `<span class="muted">—</span>`;
        const margin = cost === null ? "" : `<div class="small ${tone(v - cost)}">${signed(v - cost)} margin</div>`;
        return money(v) + margin;
      };
      const st = snap.inv.byProduct[p.id];
      return {
        cells: [
          `<b>${esc(p.name)}</b>${muted(esc(p.notes))}`,
          ...Calc.TIERS.map((t) => priceCell(t.key)),
          cost === null ? `<span class="muted">Not known yet</span>` : money(cost),
          st && st.qty ? String(st.qty) : "0",
          rowActions([["Edit", "edit-product", p.id], ["Delete", "delete-product", p.id, "btn-ghost danger"]]),
        ],
      };
    });
    return sectionHead("Products", btn("Add product", "add-product", "", "btn-primary")) +
      table([{ label: "Product" }, ...Calc.TIERS.map((t) => ({ label: `${t.label} units`, num: true })), { label: "Landed cost/unit", num: true }, { label: "In stock", num: true }, { label: "" }],
        rows, "No products yet. Add the things you sell, with their prices per unit at each quantity tier.") +
      `<p class="muted small">Margin = tier price − current landed cost per unit (average of stock in hand, or the latest incoming order).</p>`;
  };

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
        `<b>${esc(p.name)}</b>${muted(`From ${plural(st.batches, "order")}`)}`,
        st.qty < 0 ? `<span class="neg">${st.qty}</span>` : String(st.qty),
        money(st.avgCost),
        money(st.value),
        st.qty > 0 ? rowActions([["Record sale", "sell-product", p.id, "btn-primary"]]) : "",
      ],
    }));
    return sectionHead("In hand", btn("Record sale", "add-sale", "", "btn-primary")) +
      `<div class="stats">
        ${stat("Units in stock", String(snap.stockUnits))}
        ${stat("Inventory value", money(snap.stockValue))}
      </div>` +
      table([{ label: "Product" }, { label: "Qty on hand", num: true }, { label: "Avg landed cost/unit", num: true }, { label: "Stock value", num: true }, { label: "" }],
        rows, "No stock in hand. Orders appear here once you mark them as received.") +
      `<p class="muted small">Stock of the same product from several orders is combined at a weighted average cost.</p>`;
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
          money(s.unitPrice),
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
    const cards = data.accounts.map((a) => `
      <div class="card stat">
        <div class="stat-label">${esc(a.name)}${a.id === CASH_ID ? " " + badge("Default") : ""}</div>
        <div class="stat-value ${snap.balances[a.id] < 0 ? "neg" : ""}">${money(snap.balances[a.id])}</div>
        <div class="stat-sub">Starting balance ${money(a.opening)}</div>
        ${rowActions([
          ...(a.id === CASH_ID ? [["Cash count", "cash-count", a.id]] : []),
          ["Edit", "edit-account", a.id],
          ...(a.id === CASH_ID ? [] : [["Delete", "delete-account", a.id, "btn-ghost danger"]]),
        ])}
      </div>`).join("");

    const rows = data.transfers.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => {
      const isAdjust = t.type === "adjust";
      return {
        cells: [
          fmtDate(t.date),
          isAdjust ? (t.cashCount ? "Cash count" : "Adjustment") : "Transfer",
          (isAdjust ? esc(accountName(t.accountId)) : `${esc(accountName(t.fromId))} → ${esc(accountName(t.toId))}`) + muted(esc(t.note)),
          isAdjust ? `<span class="${tone(t.amount)}">${signed(t.amount)}</span>` : money(t.amount),
          rowActions([["Edit", "edit-transfer", t.id], ["Delete", "delete-transfer", t.id, "btn-ghost danger"]]),
        ],
      };
    });

    return sectionHead("Accounts", btn("Transfer", "add-transfer") + btn("Adjustment", "add-adjust") + btn("Add account", "add-account", "", "btn-primary")) +
      `<div class="stats">${cards}</div>
      <div class="card total-line"><span>Total in accounts</span><b class="${tone(snap.cashTotal)}">${money(snap.cashTotal)}</b></div>
      <h3 class="group-title">Transfers and adjustments</h3>` +
      table([{ label: "Date" }, { label: "Type" }, { label: "Details" }, { label: "Amount", num: true }, { label: "" }],
        rows, "No transfers or adjustments yet.") +
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
    const p = id ? Store.get("products", id) : { name: "", notes: "", prices: {} };
    const prices = p.prices || {};
    openForm(id ? "Edit product" : "Add product", `
      ${field("Product name", textInput("name", p.name, "required"))}
      <p class="field-label">Selling price per unit</p>
      <div class="form-row three">
        ${Calc.TIERS.map((t) => field(`${t.label} units`, moneyInput(t.key, prices[t.key]))).join("")}
      </div>
      ${field("Notes (optional)", textArea("notes", p.notes))}`,
    (v) => {
      if (!v.name) return "Enter a product name.";
      const clash = Store.data.products.find((x) => x.id !== p.id && x.name.toLowerCase() === v.name.toLowerCase());
      if (clash) return "You already have a product with that name.";
      const item = { ...p, id: p.id || Store.uid(), name: v.name, notes: v.notes, prices: {} };
      for (const t of Calc.TIERS) item.prices[t.key] = optNum(v[t.key]);
      return Store.commit((d) => upsertIn(d.products, item));
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
      ${field("Paid from", select("accountId", accountOptions(), o.accountId))}
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

    const form = openForm(id ? "Edit sale" : "Record sale", `
      ${field("Product", select("productId", options, s.productId, "required"))}
      ${row(field("Quantity sold", qtyInput("qty", s.qty, "required")),
            field("Price per unit", moneyInput("unitPrice", s.unitPrice, "required"), `<span data-tier-hint></span> <button type="button" class="link" data-use-tier>Use tier price</button>`))}
      ${row(field("Date", dateInput("date", s.date, "required")),
            field("Paid into", select("accountId", accountOptions(), s.accountId)))}
      ${field("Buyer / location (optional)", textInput("buyer", s.buyer))}
      <div class="preview" data-preview></div>`,
    (v) => {
      if (!v.productId) return "Choose a product.";
      const q = num(v.qty);
      if (!Number.isInteger(q) || q < 1) return "Quantity must be a whole number, 1 or more.";
      if (q > available(v.productId)) return `Only ${available(v.productId)} in stock for that product.`;
      const item = { ...s, id: s.id || Store.uid(), productId: v.productId, qty: q, unitPrice: num(v.unitPrice), date: v.date, accountId: v.accountId, buyer: v.buyer };
      return Store.commit((d) => upsertIn(d.sales, item));
    });

    const priceInput = form.querySelector("[name=unitPrice]");
    const hint = form.querySelector("[data-tier-hint]");
    const preview = form.querySelector("[data-preview]");
    let priceTouched = !!id; // when editing, keep the saved price unless asked
    const tierPriceNow = () => {
      const v = formValues(form);
      return Calc.tierPrice(Store.get("products", v.productId), Math.max(1, num(v.qty)));
    };
    const update = () => {
      const v = formValues(form);
      const q = Math.max(1, num(v.qty));
      const tp = tierPriceNow();
      if (!priceTouched && tp !== null) priceInput.value = tp;
      hint.textContent = v.productId ? `${Calc.tierFor(q).label} units tier: ${tp === null ? "no price set" : money(tp)}.` : "";
      const st = snap.inv.byProduct[v.productId];
      const revenue = Calc.saleRevenue({ qty: num(v.qty), unitPrice: num(priceInput.value) });
      const cost = st ? st.avgCost * num(v.qty) : 0;
      preview.innerHTML = v.productId ? `<span>Revenue <b>${money(revenue)}</b></span><span>Cost <b>${money(cost)}</b></span>
        <span>Profit <b class="${tone(revenue - cost)}">${money(revenue - cost)}</b></span>` : "";
    };
    form.addEventListener("input", (e) => {
      if (e.target === priceInput) priceTouched = true;
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
            field("Paid from", select("accountId", accountOptions(), e.accountId)))}
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
      const uses = d.orders.filter((x) => x.productId === id).length + d.sales.filter((x) => x.productId === id).length;
      if (uses) return alert(`This product is used by ${plural(uses, "order/sale")}. Delete those first.`);
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
      if (isUsedAccount(id)) return alert("This account has entries linked to it. Move or delete those first.");
      confirmDelete("account", "accounts", id);
    },
    "cash-count": cashCountForm,
    "add-transfer": () => transferForm(),
    "add-adjust": () => adjustForm(),
    "edit-transfer": (id) => (Store.get("transfers", id).type === "adjust" ? adjustForm(id) : transferForm(id)),
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
