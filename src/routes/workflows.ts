import type { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { DocumentType, PropertyCategory, PropertyStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { enqueueWhatsApp } from "../whatsapp/service.js";

const adminRoles: string[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];
const ownerRoles: string[] = [UserRole.SELLER, UserRole.BROKER, UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN];
// Roles that may act on a property document regardless of ownership (admins only)
const documentAdminRoles: string[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

export async function workflowRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>("/properties/:id/save", { preHandler: app.authenticate }, async (request, reply) => {
    const property = await prisma.property.findFirst({ where: { id: request.params.id, status: PropertyStatus.ACTIVE } });
    if (!property) return reply.code(404).send({ error: "Property not found" });
    const existing = await prisma.savedProperty.findUnique({ where: { userId_propertyId: { userId: request.authUser.userId, propertyId: property.id } } });
    if (existing) {
      await prisma.savedProperty.delete({ where: { id: existing.id } });
      return { saved: false };
    }
    await prisma.savedProperty.create({ data: { userId: request.authUser.userId, propertyId: property.id } });
    return { saved: true };
  });

  app.get("/saved-properties", { preHandler: app.authenticate }, async request => {
    return prisma.savedProperty.findMany({ where: { userId: request.authUser.userId }, include: { property: true }, orderBy: { createdAt: "desc" } });
  });

  app.post("/alerts", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = z.object({ village: z.string().optional(), category: z.nativeEnum(PropertyCategory).optional(), minPrice: z.number().int().nonnegative().optional(), maxPrice: z.number().int().positive().optional(), minArea: z.number().positive().optional(), maxArea: z.number().positive().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid alert", details: parsed.error.flatten() });
    const alert = await prisma.propertyAlert.create({ data: { ...parsed.data, userId: request.authUser.userId, minPrice: parsed.data.minPrice === undefined ? undefined : BigInt(parsed.data.minPrice), maxPrice: parsed.data.maxPrice === undefined ? undefined : BigInt(parsed.data.maxPrice) } });
    return reply.code(201).send({ ...alert, minPrice: alert.minPrice === null ? null : Number(alert.minPrice), maxPrice: alert.maxPrice === null ? null : Number(alert.maxPrice) });
  });

  app.get("/alerts", { preHandler: app.authenticate }, async request => prisma.propertyAlert.findMany({ where: { userId: request.authUser.userId, isActive: true }, orderBy: { createdAt: "desc" } }));

  app.post("/site-visits", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = z.object({ propertyId: z.string().uuid(), scheduledFor: z.coerce.date(), note: z.string().max(500).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid site visit", details: parsed.error.flatten() });
    const property = await prisma.property.findFirst({ where: { id: parsed.data.propertyId, status: PropertyStatus.ACTIVE } });
    if (!property) return reply.code(404).send({ error: "Property not found" });
    return reply.code(201).send(await prisma.siteVisit.create({ data: { ...parsed.data, buyerId: request.authUser.userId } }));
  });

  app.get("/site-visits", { preHandler: app.authenticate }, async request => prisma.siteVisit.findMany({ where: { buyerId: request.authUser.userId }, include: { property: { select: { title: true, slug: true, village: true } } }, orderBy: { scheduledFor: "asc" } }));

  app.post<{ Params: { id: string } }>("/properties/:id/documents", { preHandler: app.authenticate }, async (request, reply) => {
    const property = await prisma.property.findUnique({ where: { id: request.params.id } });
    if (!property) return reply.code(404).send({ error: "Property not found" });
    // Fixed: admins bypass ownership check; all other roles (including BROKER/SELLER) must own the property
    if (!documentAdminRoles.includes(request.authUser.role) && property.ownerId !== request.authUser.userId) return reply.code(403).send({ error: "Property owner access required" });
    const uploadDir = path.join(process.cwd(), "uploads", "properties", property.id, "documents");
    await mkdir(uploadDir, { recursive: true });
    const created: { id: string; url: string; type: string }[] = [];
    const allowedMimes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
    let documentTypeValue = "OTHER";
    for await (const part of request.parts()) {
      if (part.type === "field") { if (part.fieldname === "documentType") documentTypeValue = String(part.value); continue; }
      if (!allowedMimes.has(part.mimetype)) {
        return reply.code(400).send({ error: "Only PDF, JPEG, PNG, or WebP files are supported", code: "INVALID_FILE_TYPE" });
      }
      const typeValue = documentTypeValue;
      const type = Object.values(DocumentType).includes(typeValue as DocumentType) ? typeValue as DocumentType : DocumentType.OTHER;
      const filename = `${Date.now()}-${part.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)}`;
      await pipeline(part.file, createWriteStream(path.join(uploadDir, filename)));
      const document = await prisma.propertyDocument.create({ data: { propertyId: property.id, type, url: `/uploads/properties/${property.id}/documents/${filename}`, filename, mimeType: part.mimetype } });
      created.push({ id: document.id, url: document.url, type: document.type });
    }

    // Step 6: WhatsApp notification to property owner when broker/agent uploads a document
    if (created.length > 0) {
      const propWithOwner = await prisma.property.findUnique({
        where: { id: property.id },
        include: { owner: { select: { id: true, name: true, phone: true, whatsappNumber: true } } },
      });
      const owner = propWithOwner?.owner;
      if (owner && request.authUser.userId !== owner.id) {
        const uploaderUser = await prisma.user.findUnique({ where: { id: request.authUser.userId }, select: { name: true } });
        const brokerName = uploaderUser?.name ?? "Broker";
        const ownerPhone = owner.whatsappNumber ?? owner.phone;
        if (ownerPhone) {
          for (const doc of created) {
            enqueueWhatsApp({
              phone: ownerPhone,
              eventName: "broker_document_uploaded",
              variables: {
                document_type: doc.type,
                property_title: property.title,
                village: property.village,
                broker_name: brokerName,
              },
              dedupeKey: `broker-doc:${doc.id}`,
            }).catch(() => undefined);
          }
        }
        // Also notify admin if ADMIN_PHONE is set
        const adminPhone = process.env["ADMIN_PHONE"];
        if (adminPhone) {
          for (const doc of created) {
            enqueueWhatsApp({
              phone: adminPhone,
              eventName: "broker_document_uploaded",
              variables: {
                document_type: doc.type,
                property_title: property.title,
                village: property.village,
                broker_name: brokerName,
              },
              dedupeKey: `broker-doc-admin:${doc.id}`,
            }).catch(() => undefined);
          }
        }
      }
    }

    return { documents: created };
  });

  // Step 2: GET /properties/:id/documents
  app.get<{ Params: { id: string } }>("/properties/:id/documents", { preHandler: app.authenticate }, async (request, reply) => {
    const property = await prisma.property.findUnique({ where: { id: request.params.id } });
    if (!property) return reply.code(404).send({ error: "Property not found" });
    if (!documentAdminRoles.includes(request.authUser.role) && property.ownerId !== request.authUser.userId) return reply.code(403).send({ error: "Property owner access required" });
    const documents = await prisma.propertyDocument.findMany({
      where: { propertyId: property.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, url: true, filename: true, mimeType: true, status: true, createdAt: true },
    });
    return { documents };
  });

  app.get<{ Params: { id: string } }>("/properties/:id/verification", async (request, reply) => {
    const property = await prisma.property.findFirst({ where: { id: request.params.id, status: PropertyStatus.ACTIVE } });
    if (!property) return reply.code(404).send({ error: "Property not found" });
    return prisma.propertyVerification.findMany({ where: { propertyId: property.id }, orderBy: { level: "asc" } });
  });

  app.patch<{ Params: { id: string } }>("/admin/properties/:id/review", { preHandler: app.authenticate }, async (request, reply) => {
    if (!adminRoles.includes(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const parsed = z.object({ status: z.enum(["ACTIVE", "REJECTED", "PENDING"]), note: z.string().max(500).optional(), levels: z.array(z.object({ level: z.number().int().min(1).max(6), name: z.string().min(2), status: z.enum(["PENDING", "VERIFIED", "REJECTED"]) })).default([]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid review", details: parsed.error.flatten() });
    const property = await prisma.property.findUnique({ where: { id: request.params.id } });
    if (!property) return reply.code(404).send({ error: "Property not found" });
    const updated = await prisma.$transaction(async transaction => {
      for (const level of parsed.data.levels) await transaction.propertyVerification.upsert({ where: { propertyId_level: { propertyId: property.id, level: level.level } }, update: { name: level.name, status: level.status, note: parsed.data.note, reviewedById: request.authUser.userId, reviewedAt: new Date() }, create: { propertyId: property.id, level: level.level, name: level.name, status: level.status, note: parsed.data.note, reviewedById: request.authUser.userId, reviewedAt: new Date() } });
      return transaction.property.update({ where: { id: property.id }, data: { status: parsed.data.status, khatauniVerified: parsed.data.levels.some(level => level.level >= 5 && level.status === "VERIFIED"), registryReady: parsed.data.levels.some(level => level.level >= 5 && level.status === "VERIFIED") } });
    });
    return { id: updated.id, status: updated.status };
  });

  app.get("/admin/properties/pending", { preHandler: app.authenticate }, async (request, reply) => {
    if (!adminRoles.includes(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const properties = await prisma.property.findMany({ where: { status: PropertyStatus.PENDING }, include: { owner: { select: { name: true, phone: true, role: true } }, documents: true, verifications: true }, orderBy: { createdAt: "asc" } });
    return properties.map(property => ({ ...property, price: Number(property.price), pricePerBigha: property.pricePerBigha === null ? null : Number(property.pricePerBigha), pricePerAcre: property.pricePerAcre === null ? null : Number(property.pricePerAcre) }));
  });
}
