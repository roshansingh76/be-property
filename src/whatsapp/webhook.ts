import type { FastifyInstance } from "fastify";
import { verifyWebhookSignature } from "./client.js";

export async function registerWhatsAppWebhook(app: FastifyInstance) {
  app.get<{ Querystring: { mode?: string; token?: string; challenge?: string } }>("/webhooks/whatsapp", async (request, reply) => {
    const mode = request.query.mode;
    const token = request.query.token;
    const verifyToken = process.env.VERIFY_TOKEN;

    if (mode === "subscribe" && token === verifyToken) {
      return reply.code(200).send(request.query.challenge);
    }

    return reply.code(403).send({ error: "Verification failed" });
  });

  app.post("/webhooks/whatsapp", async (request, reply) => {
    const rawBody = JSON.stringify(request.body ?? {});
    const signature = request.headers["x-hub-signature-256"];
    const appSecret = process.env.APP_SECRET;

    if (!appSecret || !verifyWebhookSignature(rawBody, signature as string | string[] | undefined, appSecret)) {
      return reply.code(401).send({ error: "Signature validation failed" });
    }

    const payload = request.body as Record<string, unknown>;
    const entry = Array.isArray(payload.entry) ? payload.entry[0] : undefined;
    const changes = Array.isArray(entry?.changes) ? entry.changes[0] : undefined;
    const value = changes?.value as Record<string, unknown> | undefined;

    if (value?.metadata && value?.statuses) {
      return reply.code(200).send({ ok: true, status: "delivery_report_received" });
    }

    const messages = Array.isArray(value?.messages) ? value.messages : [];
    for (const msg of messages) {
      const from = (msg as Record<string, unknown>).from as string | undefined;
      const text = (msg as Record<string, unknown>).text as { body?: string } | undefined;
      if (!from) continue;
      const inbound = text?.body ?? "";
      app.log.info({ from, inbound }, "inbound whatsapp message");
    }

    return reply.code(200).send({ ok: true });
  });
}
