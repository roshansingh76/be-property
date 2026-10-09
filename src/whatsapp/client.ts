import crypto from "node:crypto";

const META_API_BASE = process.env.WHATSAPP_API_BASE ?? "https://graph.facebook.com/v19.0";

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  return `+${digits}`;
}

export function maskPhone(raw: string): string {
  const digits = normalizePhone(raw).replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  const visible = digits.slice(-4);
  return `***${visible}`;
}

export async function sendTemplateMessage({
  to,
  templateName,
  languageCode = "en_US",
  parameters = [],
}: {
  to: string;
  templateName: string;
  languageCode?: string;
  parameters?: Array<{ type: "text"; text: string }>;
}): Promise<{ providerMessageId?: string; status: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp Meta credentials are not configured.");
  }

  const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(to),
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: parameters.length > 0
          ? [{ type: "body", parameters }]
          : [],
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Meta WhatsApp request failed");
  }

  return {
    providerMessageId: payload.messages?.[0]?.id,
    status: payload?.messages?.[0]?.status ?? "queued",
  };
}

export async function sendTextMessage({
  to,
  message,
}: {
  to: string;
  message: string;
}): Promise<{ providerMessageId?: string; status: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp Meta credentials are not configured.");
  }

  const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(to),
      type: "text",
      text: { body: message },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Meta WhatsApp text send failed");
  }

  return {
    providerMessageId: payload.messages?.[0]?.id,
    status: payload?.messages?.[0]?.status ?? "queued",
  };
}

export function verifyWebhookSignature(payload: string, providedSignature: string | string[] | undefined, appSecret: string): boolean {
  if (!providedSignature || !appSecret) return false;
  const signature = Array.isArray(providedSignature) ? providedSignature[0] : providedSignature;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(payload).digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function isAllowedToSendWhatsApp(phoneNumber: string): boolean {
  const digits = phoneNumber.replace(/\D/g, "");
  return digits.length >= 10;
}
