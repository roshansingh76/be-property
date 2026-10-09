import type { FastifyInstance } from "fastify";
import { PropertyCategory, PropertyStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { serializeProperty, slugify } from "../lib/property.js";

const adminRoles: string[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];
const propertyOwnerRoles: string[] = [UserRole.SELLER, UserRole.BROKER, UserRole.AGENT, UserRole.ADMIN, UserRole.SUPER_ADMIN];
const propertyInput = z.object({
  title: z.string().min(5).max(255),
  category: z.nativeEnum(PropertyCategory),
  description: z.string().max(5000).nullable().optional(),
  village: z.string().min(2).max(100),
  tehsil: z.string().max(100).default("Palia"),
  district: z.string().max(100).default("Lakhimpur Kheri"),
  price: z.number().int().positive(),
  area: z.number().positive(),
  areaUnit: z.enum(["BIGHA", "ACRE", "HECTARE", "SQFT"]).default("BIGHA"),
  status: z.nativeEnum(PropertyStatus).default(PropertyStatus.PENDING),
  ownerId: z.string().uuid(),
  featured: z.boolean().default(false),
});

function canAdmin(role: string): boolean {
  return adminRoles.includes(role);
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/users", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    return prisma.user.findMany({ select: { id: true, phone: true, name: true, role: true, isVerified: true, isBlocked: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  });

  app.patch<{ Params: { id: string } }>("/admin/users/:id/block", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    if (request.params.id === request.authUser.userId) return reply.code(400).send({ error: "You cannot block yourself" });
    const parsed = z.object({ blocked: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "blocked must be boolean" });
    const user = await prisma.user.update({ where: { id: request.params.id }, data: { isBlocked: parsed.data.blocked } });
    return { id: user.id, isBlocked: user.isBlocked };
  });

  app.patch<{ Params: { id: string } }>("/admin/users/:id/verify", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const parsed = z.object({ verified: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "verified must be boolean" });
    const user = await prisma.user.update({ where: { id: request.params.id }, data: { isVerified: parsed.data.verified } });
    return { id: user.id, isVerified: user.isVerified };
  });

  app.patch<{ Params: { id: string } }>("/admin/users/:id", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    if (request.params.id === request.authUser.userId && request.body && typeof request.body === "object" && "isBlocked" in request.body && (request.body as { isBlocked?: unknown }).isBlocked === true) {
      return reply.code(400).send({ error: "You cannot block yourself" });
    }
    const parsed = z.object({
      name: z.string().min(2).max(120).nullable().optional(),
      role: z.nativeEnum(UserRole).optional(),
      isVerified: z.boolean().optional(),
      isBlocked: z.boolean().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid user update", details: parsed.error.flatten() });
    if (parsed.data.role && request.authUser.role !== UserRole.SUPER_ADMIN) return reply.code(403).send({ error: "Only super admin can change roles" });
    if (request.params.id === request.authUser.userId && parsed.data.role && parsed.data.role !== UserRole.SUPER_ADMIN) return reply.code(400).send({ error: "You cannot remove your own super admin role" });
    const user = await prisma.user.update({ where: { id: request.params.id }, data: parsed.data });
    return { id: user.id, phone: user.phone, name: user.name, role: user.role, isVerified: user.isVerified, isBlocked: user.isBlocked };
  });

  app.get("/admin/properties", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const properties = await prisma.property.findMany({ include: { owner: { select: { id: true, name: true, phone: true, role: true, isVerified: true } } }, orderBy: { createdAt: "desc" } });
    return properties.map(serializeProperty);
  });

  app.post("/admin/properties", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const parsed = propertyInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid property data", details: parsed.error.flatten() });
    const owner = await prisma.user.findUnique({ where: { id: parsed.data.ownerId } });
    if (!owner || !propertyOwnerRoles.includes(owner.role)) return reply.code(400).send({ error: "Property owner must be a seller, broker, agent, or admin" });
    const { ownerId, ...data } = parsed.data;
    const property = await prisma.property.create({ data: { ...data, ownerId, slug: `${slugify(data.title)}-${Date.now().toString(36)}`, images: [], irrigation: [] }, include: { owner: { select: { id: true, name: true, phone: true, role: true, isVerified: true } } } });
    return reply.code(201).send(serializeProperty(property));
  });

  app.patch<{ Params: { id: string } }>("/admin/properties/:id", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const parsed = propertyInput.partial().omit({ ownerId: true }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid property update", details: parsed.error.flatten() });
    const property = await prisma.property.update({ where: { id: request.params.id }, data: parsed.data, include: { owner: { select: { id: true, name: true, phone: true, role: true, isVerified: true } } } });
    return serializeProperty(property);
  });

  app.delete<{ Params: { id: string } }>("/admin/properties/:id", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const property = await prisma.property.update({ where: { id: request.params.id }, data: { status: PropertyStatus.ARCHIVED } });
    return { id: property.id, status: property.status };
  });

  app.get("/locations", async () => prisma.location.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }] }));

  app.get("/admin/locations", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    return prisma.location.findMany({ orderBy: [{ isActive: "desc" }, { type: "asc" }, { name: "asc" }] });
  });

  app.post("/admin/locations", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const parsed = z.object({ name: z.string().min(2).max(120), type: z.enum(["CITY", "VILLAGE", "BLOCK", "DISTRICT"]), district: z.string().max(120).default("Lakhimpur Kheri"), state: z.string().max(120).default("Uttar Pradesh") }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid location", details: parsed.error.flatten() });
    const location = await prisma.location.create({ data: { ...parsed.data, slug: `${parsed.data.type.toLowerCase()}-${parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` } });
    return reply.code(201).send(location);
  });

  app.patch<{ Params: { id: string } }>("/admin/locations/:id", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const parsed = z.object({ name: z.string().min(2).max(120).optional(), isActive: z.boolean().optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid location update" });
    return prisma.location.update({ where: { id: request.params.id }, data: parsed.data });
  });

  // ── Admin: Seller / Broker detail ────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/admin/sellers/:id", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
      select: {
        id: true, phone: true, name: true, role: true,
        isVerified: true, isBlocked: true, createdAt: true,
        properties: {
          include: { leads: { select: { id: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return {
      ...user,
      properties: user.properties.map(p => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        category: p.category,
        status: p.status,
        village: p.village,
        price: Number(p.price),
        area: p.area,
        areaUnit: p.areaUnit,
        featured: p.featured,
        viewCount: p.viewCount,
        createdAt: p.createdAt,
        leadCount: p.leads.length,
      })),
    };
  });

  // ── Admin: Buyer detail (saved properties, leads, site visits) ───────────────

  app.get<{ Params: { id: string } }>("/admin/buyers/:id", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
      select: {
        id: true, phone: true, name: true, role: true,
        isVerified: true, isBlocked: true, createdAt: true,
        savedProperties: {
          include: { property: { select: { id: true, title: true, slug: true, village: true, price: true, status: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        leads: {
          include: { property: { select: { id: true, title: true, slug: true, village: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        siteVisits: {
          include: { property: { select: { id: true, title: true, slug: true, village: true } } },
          orderBy: { scheduledFor: "desc" },
          take: 20,
        },
      },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return {
      ...user,
      savedProperties: user.savedProperties.map(s => ({
        ...s,
        property: { ...s.property, price: Number(s.property.price) },
      })),
      leads: user.leads,
      siteVisits: user.siteVisits,
    };
  });

  // ── Admin: Leads ─────────────────────────────────────────────────────────────

  app.get("/admin/leads", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const leads = await prisma.lead.findMany({
      include: {
        property: { select: { id: true, title: true, slug: true, village: true, owner: { select: { id: true, name: true, phone: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return leads;
  });

  app.patch<{ Params: { id: string } }>("/admin/leads/:id/status", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const parsed = z.object({ status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "SITE_VISIT", "OFFER_MADE", "CLOSED"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid lead status" });
    const lead = await prisma.lead.findUnique({ where: { id: request.params.id } });
    if (!lead) return reply.code(404).send({ error: "Lead not found" });
    return prisma.lead.update({ where: { id: lead.id }, data: { status: parsed.data.status } });
  });

  // ── Admin: Site Visits ────────────────────────────────────────────────────────

  app.get("/admin/site-visits", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const visits = await prisma.siteVisit.findMany({
      include: {
        property: { select: { id: true, title: true, slug: true, village: true } },
        buyer: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { scheduledFor: "asc" },
    });
    return visits;
  });

  app.patch<{ Params: { id: string } }>("/admin/site-visits/:id/status", { preHandler: app.authenticate }, async (request, reply) => {
    if (!canAdmin(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const parsed = z.object({ status: z.enum(["REQUESTED", "CONFIRMED", "COMPLETED", "CANCELLED"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid site visit status" });
    const visit = await prisma.siteVisit.findUnique({ where: { id: request.params.id } });
    if (!visit) return reply.code(404).send({ error: "Site visit not found" });
    return prisma.siteVisit.update({ where: { id: visit.id }, data: { status: parsed.data.status } });
  });
}