// ---------- PnL data storage ----------
// All PnL data lives in one object saved in the browser's localStorage
// (a small storage area each browser gives a website). It survives closing the
// page, but it belongs to this browser only: PC and phone don't share it yet.
// Use Accounts → Export backup to keep a copy as a file.
//
// Only raw entries are stored (products, orders, sales, ...). Balances, stock
// and profits are always recalculated by pnl-calc.js.

const PNL_STORAGE_KEY = "lifeTracker.pnl.v1";
const PNL_DEFAULT_CATEGORIES = ["Packaging", "Ads/Marketing", "Travel/Fuel", "Other"];
const CASH_ID = "cash"; // the built-in Cash account, the default everywhere
const BANK_ID = "bank"; // the built-in Bank account (cash deposits, transfers received, spending)
const CRYPTO_ID = "crypto"; // the built-in Crypto account, kept in dollars (Set balance updates it to today's value)
const PNL_BUILT_IN = [[CASH_ID, "Cash"], [BANK_ID, "Bank"], [CRYPTO_ID, "Crypto"]]; // always present, in this order, never deleted

function pnlEmptyData() {
  return {
    version: 1,
    products: [],   // { id, name, notes, tiers: [{ min (from qty), price (per unit) }] sorted by min }
    accounts: PNL_BUILT_IN.map(([id, name]) => ({ id, name, opening: 0 })), // { id, name, opening }
    orders: [],     // { id, productId, supplier, qty, total (whole order), orderDate, expectedDate, accountId, notes, receivedDate?, receivedQty? }
    // sale: { id, productId, qty, unitPrice, total? (when entered as a lot total), date, accountId, buyer,
    //   paidLater? true, dueDate?, payments?: [{ id, amount, date, accountId }] }
    // A paid-later sale's money only reaches accounts through its payments (accountId is unused).
    sales: [],
    stockAdjustments: [], // "Set stock": { id, productId, date, qty (+/− units), unitCost (for added units), note }
    expenses: [],   // { id, date, amount, category, description, accountId, productId, recurring: none|weekly|monthly, recurCount?, fromRecurringId? }
    // transfer: { id, type:"transfer", fromId, toId, amount, date, note }  (Cash → Bank = a cash deposit)
    // adjustment: { id, type:"adjust", accountId, amount (+/-), date, note, from? (who sent a bank transfer), cashCount? }
    transfers: [],
    categories: PNL_DEFAULT_CATEGORIES.slice(),
  };
}

const Store = {
  data: null,

  load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PNL_STORAGE_KEY)); } catch (e) { saved = null; }
    this.data = this.normalise(saved);
    this.runRecurring();
  },

  // Fill in anything missing (e.g. from an older version or a partial backup)
  normalise(d) {
    const base = pnlEmptyData();
    if (!d || typeof d !== "object") return base;
    for (const key of Object.keys(base)) {
      if (Array.isArray(base[key]) && !Array.isArray(d[key])) d[key] = base[key];
    }
    // Older products had fixed prices { t1, t5, t10 }: turn them into tiers from 1, 5 and 10
    for (const p of d.products) {
      if (!Array.isArray(p.tiers)) p.tiers = Calc.productTiers(p);
      delete p.prices;
    }
    // The built-in accounts are added to older data (Bank, then Crypto, came later), each after the one before it
    PNL_BUILT_IN.forEach(([id, name], i) => {
      if (!d.accounts.some((a) => a.id === id)) d.accounts.splice(i, 0, { id, name, opening: 0 });
    });
    d.version = 1;
    return d;
  },

  save() {
    try {
      localStorage.setItem(PNL_STORAGE_KEY, JSON.stringify(this.data));
      if (typeof Sync !== "undefined") Sync.changed("pnl"); // cloud: save to the account in the background
    } catch (e) {
      alert("Couldn't save your data in this browser. Export a backup from Accounts to be safe.");
    }
  },

  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
  get(list, id) { return this.data[list].find((x) => x.id === id); },

  // Every change goes through here. The change is tried on a copy first; if it
  // would make any product's stock go below zero, it's refused with a message.
  // Returns an error message, or null when saved.
  commit(change) {
    const draft = structuredClone(this.data);
    change(draft);
    const before = Calc.inventory(this.data).shortages;
    const after = Calc.inventory(draft).shortages;
    for (const id in after) {
      if (before[id]) continue;
      const p = draft.products.find((x) => x.id === id);
      const s = after[id];
      return `Not enough stock of "${p ? p.name : "this product"}": on ${s.date} you'd be ${s.short} unit${s.short === 1 ? "" : "s"} short. Check the sale dates and received orders.`;
    }
    this.data = draft;
    this.save();
    return null;
  },

  // Log any weekly/monthly repeats that have come due. The original entry is
  // the first payment; each repeat becomes its own normal expense entry.
  runRecurring() {
    const today = Calc.today();
    let added = 0;
    for (const tpl of this.data.expenses.slice()) {
      if (tpl.recurring !== "weekly" && tpl.recurring !== "monthly") continue;
      let k = (tpl.recurCount || 0) + 1;
      let next;
      while ((next = Calc.nthOccurrence(tpl.date, tpl.recurring, k)) <= today && added < 2000) {
        this.data.expenses.push({
          id: this.uid(), date: next, amount: tpl.amount, category: tpl.category,
          description: tpl.description, accountId: tpl.accountId, productId: tpl.productId || "",
          recurring: "none", fromRecurringId: tpl.id,
        });
        tpl.recurCount = k;
        k++;
        added++;
      }
    }
    if (added) this.save();
    return added;
  },

  // ---- Backup ----
  exportText() { return JSON.stringify(this.data, null, 2); },

  importText(text) {
    const d = JSON.parse(text); // throws if the file isn't valid JSON
    if (!d || typeof d !== "object" || !Array.isArray(d.products) || !Array.isArray(d.accounts)) {
      throw new Error("This file doesn't look like a Life Tracker PnL backup.");
    }
    this.data = this.normalise(d);
    this.save();
    this.runRecurring();
  },
};
