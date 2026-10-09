import type { FastifyInstance } from "fastify";
import { PropertyStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/buyer/dashboard", { preHandler: app.authenticate }, async request => {
    const [activeProperties, savedCount, alertCount, latestProperties] = await prisma.$transaction([
      prisma.property.count({ where: { status: PropertyStatus.ACTIVE } }),
      prisma.savedProperty.count({ where: { userId: request.authUser.userId } }),
      prisma.propertyAlert.count({ where: { userId: request.authUser.userId, isActive: true } }),
      prisma.property.findMany({ where: { status: PropertyStatus.ACTIVE }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, title: true, slug: true, price: true, village: true, images: true, area: true, areaUnit: true } }),
    ]);
    return {
      activeProperties,
      savedProperties: savedCount,
      alerts: alertCount,
      latestProperties: latestProperties.map(p => ({ ...p, price: Number(p.price) })),
    };
  });

  app.get("/broker/dashboard", { preHandler: app.authenticate }, async request => {
    const ownerId = request.authUser.userId;
    const [listings, active, pending, sold, views, leads] = await prisma.$transaction([
      prisma.property.count({ where: { ownerId } }),
      prisma.property.count({ where: { ownerId, status: PropertyStatus.ACTIVE } }),
      prisma.property.count({ where: { ownerId, status: PropertyStatus.PENDING } }),
      prisma.property.count({ where: { ownerId, status: PropertyStatus.SOLD } }),
      prisma.property.aggregate({ where: { ownerId }, _sum: { viewCount: true } }),
      prisma.lead.count({ where: { property: { ownerId } } }),
    ]);
    return { role: UserRole.BROKER, listings, active, pending, sold, views: views._sum.viewCount ?? 0, leads };
  });

  app.get("/admin/dashboard", { preHandler: app.authenticate }, async (request, reply) => {
    const adminRoles: string[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];
    if (!adminRoles.includes(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const [users, properties, pendingProperties, activeProperties, leads] = await prisma.$transaction([
      prisma.user.count(),
      prisma.property.count(),
      prisma.property.count({ where: { status: PropertyStatus.PENDING } }),
      prisma.property.count({ where: { status: PropertyStatus.ACTIVE } }),
      prisma.lead.count(),
    ]);
    return { role: request.authUser.role, users, properties, pendingProperties, activeProperties, leads };
  });

  app.patch<{ Params: { id: string } }>("/admin/users/:id/role", { preHandler: app.authenticate }, async (request, reply) => {
    if (request.authUser.role !== UserRole.SUPER_ADMIN) return reply.code(403).send({ error: "Super admin access required" });
    const parsed = z.object({ role: z.enum(["BUYER", "SELLER", "BROKER", "AGENT", "ADMIN"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid role" });
    const user = await prisma.user.update({ where: { id: request.params.id }, data: { role: parsed.data.role } });
    return { id: user.id, phone: user.phone, role: user.role };
  });
}