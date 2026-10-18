# hq-sandbox

A small invoice API that the Spec to Ship HQ agents (`/spec → /plan → /build → /test → /review → /ship`) work on end to end. It exists to prove the workflow, the approvals and the guardrails before pointing the agents at a real product.

## Run

```sh
npm install
npm start          # http://localhost:3000
npm run check      # type-check + tests
```

## API

| Method | Path | Body |
|---|---|---|
| GET | `/health` | |
| GET | `/invoices` | |
| POST | `/invoices` | `{ customer, amountCents, currency?, issuedAt? }` |
| GET | `/invoices/:id` | |
| POST | `/invoices/:id/status` | `{ status: "draft" \| "sent" \| "paid" }` |

Data is in memory and resets on restart.
