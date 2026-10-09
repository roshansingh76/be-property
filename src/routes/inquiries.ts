import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { sendValidationError } from "../lib/http.js";
import { enqueueWhatsApp } from "../whatsapp/service.js";

const inquiryInput = z.object({
  buyerName: z.string().min(2).max(120),
  buyerPhone: z.string().regex(/^[6-9]\d{9}$/),
  purpose: z.enum(["farming", "resort_farmhouse", "commercial_warehouse", "investment", "residential"]),
  preferredVillages: z.array(z.string().min(2).max(100)).min(1).max(12),
  minArea: z.number().positive().optional(),
  maxArea: z.number().positive().optional(),
  areaUnit: z.enum(["bigha", "acre", "hectare", "sqft"]).optional(),
  minBudget: z.number().int().nonnegative().optional(),
  maxBudget: z.number().int().positive().optional(),
  waterSourceRequired: z.enum(["tubewell", "canal", "any", "not_required"]).optional(),
  highwayTouchRequired: z.boolean().optional(),
  immediateRegistryRequired: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});

export async function inquiryRoutes(app: FastifyInstance) {
  app.post("/inquiries", {
    config: { rateLimit: { max: 6, timeWindow: "10 minutes" } },
  }, async (request, reply) => {
    const parsed = inquiryInput.safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, "Invalid inquiry", parsed.error);

    const inquiry = await prisma.buyerInquiry.create({
      data: {
        ...parsed.data,
        minBudget: parsed.data.minBudget === undefined ? undefined : BigInt(parsed.data.minBudget),
        maxBudget: parsed.data.maxBudget === undefined ? undefined : BigInt(parsed.data.maxBudget),
      },
    });

    const summary = [parsed.data.purpose, parsed.data.preferredVillages.join(", "), parsed.data.minBudget ? `₹${parsed.data.minBudget}` : "", parsed.data.maxBudget ? `to ₹${parsed.data.maxBudget}` : ""].filter(Boolean).join(" · ");
    await enqueueWhatsApp({
      phone: parsed.data.buyerPhone,
      eventName: "buyer_inquiry_ack",
      templateName: "buyer_inquiry_ack",
      locale: "en",
      variables: {
        buyer_name: parsed.data.buyerName,
        requirement_summary: summary || "agricultural land search",
      },
      dedupeKey: `buyer-inquiry:${inquiry.id}`,
      metadata: { inquiryId: inquiry.id },
    });

    return reply.code(201).send({
      id: inquiry.id,
      status: inquiry.status,
      createdAt: inquiry.createdAt,
    });
  });
}
