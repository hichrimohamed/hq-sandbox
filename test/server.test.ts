import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";

const app = createApp();
let base = "";

before(async () => {
  await new Promise<void>((resolve) => app.listen(0, resolve));
  base = `http://localhost:${(app.address() as AddressInfo).port}`;
});
after(() => app.close());

test("health check", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("create, list, get and pay an invoice", async () => {
  const created = await fetch(`${base}/invoices`, {
    method: "POST",
    body: JSON.stringify({ customer: "Acme", amountCents: 4200 }),
  });
  assert.equal(created.status, 201);
  const inv = await created.json();

  const list = await (await fetch(`${base}/invoices`)).json();
  assert.equal(list.length, 1);

  const got = await fetch(`${base}/invoices/${inv.id}`);
  assert.equal((await got.json()).customer, "Acme");

  const paid = await fetch(`${base}/invoices/${inv.id}/status`, { method: "POST", body: JSON.stringify({ status: "paid" }) });
  assert.equal((await paid.json()).status, "paid");
});

test("returns 400 for invalid input and 404 for unknown routes", async () => {
  const bad = await fetch(`${base}/invoices`, { method: "POST", body: JSON.stringify({ customer: "" }) });
  assert.equal(bad.status, 400);
  const missing = await fetch(`${base}/invoices/inv_999`);
  assert.equal(missing.status, 404);
});
