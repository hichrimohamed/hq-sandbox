export type InvoiceStatus = "draft" | "sent" | "paid";

export interface Invoice {
  id: string;
  customer: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string; // ISO date, YYYY-MM-DD
}

export interface NewInvoice {
  customer: string;
  amountCents: number;
  currency?: string;
  issuedAt?: string;
}

export class ValidationError extends Error {}

const STATUSES: InvoiceStatus[] = ["draft", "sent", "paid"];

export class InvoiceStore {
  #invoices = new Map<string, Invoice>();
  #nextId = 1;

  list(): Invoice[] {
    return [...this.#invoices.values()];
  }

  get(id: string): Invoice | undefined {
    return this.#invoices.get(id);
  }

  create(input: NewInvoice): Invoice {
    if (typeof input.customer !== "string" || input.customer.trim() === "") {
      throw new ValidationError("customer is required");
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new ValidationError("amountCents must be a positive integer");
    }
    const currency = input.currency ?? "EUR";
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ValidationError("currency must be a 3-letter ISO code");
    }
    const issuedAt = input.issuedAt ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt)) {
      throw new ValidationError("issuedAt must be YYYY-MM-DD");
    }
    const invoice: Invoice = {
      id: `inv_${this.#nextId++}`,
      customer: input.customer.trim(),
      amountCents: input.amountCents,
      currency,
      status: "draft",
      issuedAt,
    };
    this.#invoices.set(invoice.id, invoice);
    return invoice;
  }

  setStatus(id: string, status: InvoiceStatus): Invoice {
    const invoice = this.#invoices.get(id);
    if (!invoice) throw new ValidationError(`invoice ${id} not found`);
    if (!STATUSES.includes(status)) throw new ValidationError(`unknown status ${status}`);
    invoice.status = status;
    return invoice;
  }
}
