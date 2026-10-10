import type { FastifyInstance, FastifyRequest } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { PropertyCategory, PropertyStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { serializeProperty, slugify } from "../lib/property.js";
import { enqueueWhatsApp } from "../whatsapp/service.js";

const input = z.object({
  title: z.string().min(5).max(255),
  category: z.nativeEnum(PropertyCategory),
  description: z.string().max(5000).optional(),
  village: z.string().min(2).max(100),
  tehsil: z.string().max(100).default("Palia"),
  district: z.string().max(100).default("Lakhimpur Kheri"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  price: z.number().int().positive(),
  area: z.number().positive(),
  areaUnit: z.enum(["BIGHA", "ACRE", "HECTARE", "SQFT"]).default("BIGHA"),
  irrigation: z.array(z.string()).default([]),
  roadFrontage: z.number().int().nonnegative().optional(),
  electricity: z.boolean().default(false),
  highwayTouch: z.boolean().default(false),
  canalTouch: z.boolean().default(false),
  distanceFromPalia: z.number().nonnegative().optional(),
  khasraNumber: z.string().max(60).optional(),
  images: z.array(z.string().url()).max(20).default([]),
});

const sellerRoles: string[] = [UserRole.SELLER, UserRole.BROKER, UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN];
const adminRoles: string[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

type ListQuery = {
  Querystring: {
    q?: string; village?: string; category?: string;
    minPrice?: string; maxPrice?: string; minArea?: string; maxArea?: string;
    featured?: string; sort?: string;
    page?: string; pageSize?: string;
  };
};

function pricePerBigha(price: number, area: number, unit: string): number {
  const bigha =
    unit === "BIGHA" ? area :
    unit === "ACRE" ? area * 1.6134 :
    unit === "HECTARE" ? area * 3.9847 :
    area / 27000;
  return Math.round(price / bigha);
}

export async function propertyRoutes(app: FastifyInstance) {

  // ── /properties/mine MUST come before /properties/:slug ──────────────────
  app.get("/properties/mine", { preHandler: app.authenticate }, async request => {
    const properties = await prisma.property.findMany({
      where: { ownerId: request.authUser.userId },
      include: { owner: { select: { id: true, name: true, phone: true, role: true, isVerified: true } } },
      orderBy: { createdAt: "desc" },
    });
    return properties.map(serializeProperty);
  });

  // ── Public list ───────────────────────────────────────────────────────────
  app.get("/properties", async (request: FastifyRequest<ListQuery>) => {
    const q = request.query;
    const page = Math.max(Number(q.page ?? 1), 1);
    const pageSize = Math.min(Math.max(Number(q.pageSize ?? 20), 1), 100);

    const priceFilter: { gte?: bigint; lte?: bigint } = {};
    if (q.minPrice) priceFilter.gte = BigInt(q.minPrice);
    if (q.maxPrice) priceFilter.lte = BigInt(q.maxPrice);
    const areaFilter: { gte?: number; lte?: number } = {};
    if (q.minArea) areaFilter.gte = Number(q.minArea);
    if (q.maxArea) areaFilter.lte = Number(q.maxArea);

    const sortMap = {
      newest: { createdAt: "desc" as const },
      price_asc: { price: "asc" as const },
      price_desc: { price: "desc" as const },
      area_desc: { area: "desc" as const },
      featured: { featured: "desc" as const },
    };
    const orderBy = sortMap[q.sort as keyof typeof sortMap] ?? sortMap.newest;

    const where = {
      status: PropertyStatus.ACTIVE,
      ...(q.village ? { village: q.village } : {}),
      ...(q.category && Object.values(PropertyCategory).includes(q.category as PropertyCategory)
        ? { category: q.category as PropertyCategory } : {}),
      ...(q.q ? { OR: [
        { title:   { contains: q.q, mode: "insensitive" as const } },
        { village: { contains: q.q, mode: "insensitive" as const } },
        { tehsil:  { contains: q.q, mode: "insensitive" as const } },
      ] } : {}),
      ...(Object.keys(priceFilter).length ? { price: priceFilter } : {}),
      ...(Object.keys(areaFilter).length ? { area: areaFilter } : {}),
      ...(q.featured === "true" ? { featured: true } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.property.findMany({
        where,
        include: { owner: { select: { id: true, name: true, phone: true, role: true, isVerified: true } } },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.property.count({ where }),
    ]);
    return { items: items.map(serializeProperty), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  });

  // ── Public single property ────────────────────────────────────────────────
  app.get<{ Params: { slug: string } }>("/properties/:slug", async (request, reply) => {
    const property = await prisma.property.findUnique({
      where: { slug: request.params.slug },
      include: { owner: { select: { id: true, name: true, phone: true, role: true, isVerified: true } } },
    });
    if (!property || property.status !== PropertyStatus.ACTIVE)
      return reply.code(404).send({ error: "Property not found" });
    await prisma.property.update({ where: { id: property.id }, data: { viewCount: { increment: 1 } } });
    return serializeProperty(property);
  });

  // ── Create property ───────────────────────────────────────────────────────
  app.post("/properties", { preHandler: app.authenticate }, async (request, reply) => {
    if (!sellerRoles.includes(request.authUser.role))
      return reply.code(403).send({ error: "Seller access required" });
    const parsed = input.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid property data", details: parsed.error.flatten() });
    const data = parsed.data;
    const property = await prisma.property.create({
      data: {
        ...data,
        slug: `${slugify(data.title)}-${Date.now().toString(36)}`,
        ownerId: request.authUser.userId,
        pricePerBigha: BigInt(pricePerBigha(data.price, data.area, data.areaUnit)),
        pricePerAcre: BigInt(Math.round(data.price / (
          data.areaUnit === "ACRE" ? data.area :
          data.areaUnit === "BIGHA" ? data.area / 1.6134 :
          data.areaUnit === "HECTARE" ? data.area * 2.471 :
          data.area / 43560
        ))),
        status: PropertyStatus.PENDING,
      },
      include: { owner: { select: { id: true, name: true, phone: true, role: true, isVerified: true } } },
    });
    return reply.code(201).send(serializeProperty(property));
  });

  // ── Bulk create ───────────────────────────────────────────────────────────
  app.post("/properties/bulk", { preHandler: app.authenticate }, async (request, reply) => {
    if (!sellerRoles.includes(request.authUser.role))
      return reply.code(403).send({ error: "Seller or broker access required" });
    const parsed = z.array(input).min(1).max(50).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid property batch", details: parsed.error.flatten() });
    const properties = await prisma.$transaction(async tx =>
      Promise.all(parsed.data.map(data => tx.property.create({
        data: {
          ...data,
          slug: `${slugify(data.title)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          ownerId: request.authUser.userId,
          pricePerBigha: BigInt(pricePerBigha(data.price, data.area, data.areaUnit)),
          status: PropertyStatus.PENDING,
        },
      })))
    );
    return reply.code(201).send({ created: properties.length, propertyIds: properties.map(p => p.id), status: PropertyStatus.PENDING });
  });

  // ── Upload images (owner OR admin) ────────────────────────────────────────
  app.post<{ Params: { id: string } }>("/properties/:id/images", { preHandler: app.authenticate }, async (request, reply) => {
    const property = await prisma.property.findUnique({ where: { id: request.params.id } });
    if (!property) return reply.code(404).send({ error: "Property not found" });

    const isAdmin = adminRoles.includes(request.authUser.role);
    const isOwner = property.ownerId === request.authUser.userId;
    if (!isAdmin && !isOwner) return reply.code(403).send({ error: "Not authorised to upload images for this property" });

    const uploadDir = path.join(process.cwd(), "uploads", "properties", property.id);
    await mkdir(uploadDir, { recursive: true });

    const urls: string[] = [];
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    for await (const part of request.parts()) {
      if (part.type !== "file") continue;
      if (!allowed.has(part.mimetype)) {
        return reply.code(400).send({ error: "Only JPEG, PNG, WebP, or GIF images are supported", code: "INVALID_FILE_TYPE" });
      }
      const safeName = part.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
      const filename = `${Date.now()}-${safeName}`;
      await pipeline(part.file, createWriteStream(path.join(uploadDir, filename)));
      urls.push(`/uploads/properties/${property.id}/${filename}`);
    }

    if (urls.length === 0) return reply.code(400).send({ error: "No valid image files received" });

    const updated = await prisma.property.update({
      where: { id: property.id },
      data: { images: { push: urls } },
    });

    // Step 5: Notify property owner when a broker/agent uploads images on their behalf
    const propWithOwner = await prisma.property.findUnique({
      where: { id: property.id },
      include: { owner: { select: { id: true, name: true, phone: true, whatsappNumber: true } } },
    });
    const owner = propWithOwner?.owner;
    if (owner && request.authUser.userId !== owner.id) {
      const uploaderUser = await prisma.user.findUnique({ where: { id: request.authUser.userId }, select: { name: true } });
      const ownerPhone = owner.whatsappNumber ?? owner.phone;
      if (ownerPhone) {
        enqueueWhatsApp({
          phone: ownerPhone,
          eventName: "broker_images_uploaded",
          variables: {
            owner_name: owner.name ?? "Property Owner",
            broker_name: uploaderUser?.name ?? "Broker",
            photo_count: String(urls.length),
            property_title: property.title,
            village: property.village,
          },
          dedupeKey: `broker-images:${property.id}:${Date.now()}`,
        }).catch(() => undefined);
      }
    }

    return { images: updated.images };
  });

  // ── Delete a single image (owner OR admin) ────────────────────────────────
  // Body: { imageUrl: string }  — the exact URL stored in the images array
  app.delete<{ Params: { id: string } }>("/properties/:id/images", { preHandler: app.authenticate }, async (request, reply) => {
    const property = await prisma.property.findUnique({ where: { id: request.params.id } });
    if (!property) return reply.code(404).send({ error: "Property not found" });

    const isAdmin = adminRoles.includes(request.authUser.role);
    const isOwner = property.ownerId === request.authUser.userId;
    if (!isAdmin && !isOwner) return reply.code(403).send({ error: "Not authorised" });

    const parsed = z.object({ imageUrl: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "imageUrl is required" });

    const { imageUrl } = parsed.data;
    const newImages = property.images.filter(img => img !== imageUrl);
    if (newImages.length === property.images.length)
      return reply.code(404).send({ error: "Image not found on this property" });

    // Attempt to delete the file from disk (best-effort)
    if (imageUrl.startsWith("/uploads/")) {
      const filePath = path.join(process.cwd(), imageUrl);
      await unlink(filePath).catch(() => { /* ignore if already gone */ });
    }

    const updated = await prisma.property.update({
      where: { id: property.id },
      data: { images: newImages },
    });
    return { images: updated.images };
  });

  // ── Seller dashboard stats ────────────────────────────────────────────────
  app.get("/seller/dashboard", { preHandler: app.authenticate }, async request => {
    const ownerId = request.authUser.userId;
    const [properties, leads] = await prisma.$transaction([
      prisma.property.findMany({ where: { ownerId }, select: { status: true, viewCount: true } }),
      prisma.lead.count({ where: { property: { ownerId } } }),
    ]);
    return {
      listings: properties.length,
      active:   properties.filter(p => p.status === PropertyStatus.ACTIVE).length,
      pending:  properties.filter(p => p.status === PropertyStatus.PENDING).length,
      sold:     properties.filter(p => p.status === PropertyStatus.SOLD).length,
      views:    properties.reduce((sum, p) => sum + p.viewCount, 0),
      leads,
    };
  });

  // ── Edit own property ─────────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>("/properties/:id", { preHandler: app.authenticate }, async (request, reply) => {
    if (!sellerRoles.includes(request.authUser.role))
      return reply.code(403).send({ error: "Seller access required" });
    const property = await prisma.property.findUnique({ where: { id: request.params.id } });
    if (!property) return reply.code(404).send({ error: "Property not found" });
    if (property.ownerId !== request.authUser.userId) return reply.code(403).send({ error: "Not your property" });
    const parsed = input.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid property data", details: parsed.error.flatten() });
    const updated = await prisma.property.update({
      where: { id: property.id },
      data: { ...parsed.data, status: PropertyStatus.PENDING },
      include: { owner: { select: { id: true, name: true, phone: true, role: true, isVerified: true } } },
    });
    return serializeProperty(updated);
  });

  // ── Archive own property ──────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/properties/:id", { preHandler: app.authenticate }, async (request, reply) => {
    if (!sellerRoles.includes(request.authUser.role))
      return reply.code(403).send({ error: "Seller access required" });
    const property = await prisma.property.findUnique({ where: { id: request.params.id } });
    if (!property) return reply.code(404).send({ error: "Property not found" });
    if (property.ownerId !== request.authUser.userId) return reply.code(403).send({ error: "Not your property" });
    await prisma.property.update({ where: { id: property.id }, data: { status: PropertyStatus.ARCHIVED } });
    return reply.code(204).send();
  });
}
