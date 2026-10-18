import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { InvoiceStore, ValidationError, type InvoiceStatus } from "./invoices.ts";

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError("body must be valid JSON");
  }
}

export function createApp(store = new InvoiceStore()): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true });
      }
      if (parts[0] === "invoices" && parts.length === 1) {
        if (req.method === "GET") return send(res, 200, store.list());
        if (req.method === "POST") return send(res, 201, store.create((await readJson(req)) as never));
      }
      if (parts[0] === "invoices" && parts.length === 2 && req.method === "GET") {
        const invoice = store.get(parts[1]);
        return invoice ? send(res, 200, invoice) : send(res, 404, { error: "not found" });
      }
      if (parts[0] === "invoices" && parts.length === 3 && parts[2] === "status" && req.method === "POST") {
        const { status } = (await readJson(req)) as { status: InvoiceStatus };
        return send(res, 200, store.setStatus(parts[1], status));
      }
      send(res, 404, { error: "not found" });
    } catch (err) {
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
      send(res, 500, { error: "internal error" });
    }
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => console.log(`invoice api on http://localhost:${port}`));
}
