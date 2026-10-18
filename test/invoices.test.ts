import { test } from "node:test";
import assert from "node:assert/strict";
import { InvoiceStore, ValidationError } from "../src/invoices.ts";

test("creates a draft invoice with defaults", () => {
  const store = new InvoiceStore();
  const inv = store.create({ customer: " Acme ", amountCents: 12000, issuedAt: "2026-10-01" });
  assert.equal(inv.id, "inv_1");
  assert.equal(inv.customer, "Acme");
  assert.equal(inv.currency, "EUR");
  assert.equal(inv.status, "draft");
});

test("rejects invalid input", () => {
  const store = new InvoiceStore();
  assert.throws(() => store.create({ customer: "", amountCents: 100 }), ValidationError);
  assert.throws(() => store.create({ customer: "A", amountCents: 0 }), ValidationError);
  assert.throws(() => store.create({ customer: "A", amountCents: 1.5 }), ValidationError);
  assert.throws(() => store.create({ customer: "A", amountCents: 100, currency: "eur" }), ValidationError);
  assert.throws(() => store.create({ customer: "A", amountCents: 100, issuedAt: "01/10/2026" }), ValidationError);
});

test("updates status", () => {
  const store = new InvoiceStore();
  const inv = store.create({ customer: "Acme", amountCents: 100 });
  assert.equal(store.setStatus(inv.id, "paid").status, "paid");
  assert.throws(() => store.setStatus("inv_404", "paid"), ValidationError);
});
