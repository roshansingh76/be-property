import { Redis } from "ioredis";
import { Queue, Worker } from "bullmq";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
export const redisConnection = new Redis(redisUrl);
const queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });

export const whatsappQueue = new Queue("whatsapp-events", {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

export function createWhatsAppWorker() {
  return new Worker(
    "whatsapp-events",
    async job => {
      const { eventName, phone, message, templateName, locale, variables } = job.data;
      if (!phone) throw new Error("Missing phone number for WhatsApp dispatch");
      if (message) {
        await import("./client.js").then(({ sendTextMessage }) => sendTextMessage({ to: phone, message }));
        return { ok: true, mode: "text" };
      }
      if (templateName) {
        await import("./client.js").then(({ sendTemplateMessage }) => sendTemplateMessage({
          to: phone,
          templateName,
          languageCode: locale === "hi" ? "hi" : "en_US",
          parameters: Object.entries(variables ?? {}).map(([_, value]) => ({ type: "text", text: String(value) })),
        }));
      }
      return { ok: true, mode: templateName ? "template" : "text" };
    },
    { connection: queueConnection },
  );
}
