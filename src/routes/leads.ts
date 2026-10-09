import type { FastifyInstance } from "fastify";
import { PropertyStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";

const leadInput = z.object({ propertyId: z.string().uuid(), buyerName: z.string().min(2).max(120), buyerPhone: z.string().regex(/^[6-9]\d{9}$/), buyerWhatsapp: z.string().regex(/^[6-9]\d{9}$/).optional(), message: z.string().max(500).optional(), source: z.string().max(40).default("website") });

export async function leadRoutes(app: FastifyInstance) {
  app.post("/leads", {
    config: { rateLimit: { max: 8, timeWindow: "10 minutes" } },
  }, async (request, reply) => {
    const parsed = leadInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid lead data", code: "VALIDATION_ERROR", details: parsed.error.flatten(), requestId: request.id });
    const property = await prisma.property.findFirst({ where: { id: parsed.data.propertyId, status: PropertyStatus.ACTIVE } });
    if (!property) return reply.code(404).send({ error: "Property not found", code: "NOT_FOUND", requestId: request.id });

    const duplicate = await prisma.lead.findFirst({
      where: {
        propertyId: parsed.data.propertyId,
        buyerPhone: parsed.data.buyerPhone,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (duplicate) {
      return reply.code(409).send({
        error: "You already enquired about this property today. Our team will contact you shortly.",
        code: "DUPLICATE_LEAD",
        requestId: request.id,
      });
    }

    return reply.code(201).send(await prisma.lead.create({ data: parsed.data }));
  });

  app.patch<{ Params: { id: string } }>("/leads/:id/status", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = z.object({ status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT", "OFFER_MADE", "CLOSED"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid lead status" });
    const lead = await prisma.lead.findUnique({ where: { id: request.params.id }, include: { property: true } });
    if (!lead || lead.property.ownerId !== request.authUser.userId) return reply.code(404).send({ error: "Lead not found" });
    return prisma.lead.update({ where: { id: lead.id }, data: { status: parsed.data.status } });
  });

  // Seller / broker: get all leads for their properties
  app.get("/seller/leads", { preHandler: app.authenticate }, async request => {
    return prisma.lead.findMany({
      where: { property: { ownerId: request.authUser.userId } },
      include: { property: { select: { id: true, title: true, slug: true, village: true } } },
      orderBy: { createdAt: "desc" },
    });
  });
}
