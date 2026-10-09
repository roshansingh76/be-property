import { prisma } from "../db.js";
import { normalizePhone } from "./client.js";
import { buildTemplateVariables, resolveTemplateBody } from "./templates.js";
import { whatsappQueue } from "./queue.js";

export async function enqueueWhatsApp({
  phone,
  eventName,
  message,
  templateName,
  locale = "en",
  variables = {},
  dedupeKey,
  metadata,
}: {
  phone: string;
  eventName: string;
  message?: string;
  templateName?: string;
  locale?: "en" | "hi";
  variables?: Record<string, string>;
  dedupeKey?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}) {
  const normalized = normalizePhone(phone);
  if (!normalized) return;

  const finalDedupe = dedupeKey ?? `${eventName}:${normalized}:${Date.now()}`;

  await whatsappQueue.add(
    eventName,
    {
      phone: normalized,
      eventName,
      message,
      templateName,
      locale,
      variables,
      dedupeKey: finalDedupe,
      metadata,
    },
    {
      jobId: finalDedupe,
      attempts: 5,
    },
  );

  await prisma.whatsAppMessage.create({
    data: {
      direction: "OUTBOUND",
      status: "QUEUED",
      template: templateName ?? null,
      providerMessageId: null,
      error: null,
      phone: normalized,
      content: message ?? resolveTemplateBody(templateName ?? "buyer_inquiry_ack", locale, variables),
      eventName,
    },
  }).catch(() => undefined);
}

export function buildWhatsAppTemplateMessage(templateName: string, locale: "en" | "hi" = "en", variables: Record<string, string> = {}) {
  return {
    templateName,
    locale,
    parameters: buildTemplateVariables(variables),
    body: resolveTemplateBody(templateName, locale, variables),
  };
}
