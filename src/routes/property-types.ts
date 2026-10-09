import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";

const adminRoles: string[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];

const typeInput = z.object({
  key: z
    .string()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "Key must be lowercase letters, digits, and underscores only"),
  label: z.string().min(2).max(120),
  description: z.string().max(300).nullable().optional(),
  icon: z.string().max(80).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export async function propertyTypeRoutes(app: FastifyInstance) {
  // ── Public: list active property types ───────────────────────────────────
  app.get("/property-types", async () =>
    prisma.propertyType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, key: true, label: true, description: true, icon: true, sortOrder: true },
    }),
  );

  // ── Admin: list all property types ────────────────────────────────────────
  app.get("/admin/property-types", { preHandler: app.authenticate }, async (request, reply) => {
    if (!adminRoles.includes(request.authUser.role))
      return reply.code(403).send({ error: "Admin access required" });
    return prisma.propertyType.findMany({
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
  });

  // ── Admin: create property type ───────────────────────────────────────────
  app.post("/admin/property-types", { preHandler: app.authenticate }, async (request, reply) => {
    if (!adminRoles.includes(request.authUser.role))
      return reply.code(403).send({ error: "Admin access required" });

    const parsed = typeInput.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid property type", details: parsed.error.flatten() });

    const existing = await prisma.propertyType.findUnique({ where: { key: parsed.data.key } });
    if (existing)
      return reply.code(409).send({ error: `A property type with key "${parsed.data.key}" already exists` });

    const created = await prisma.propertyType.create({ data: parsed.data });
    return reply.code(201).send(created);
  });

  // ── Admin: update property type ───────────────────────────────────────────
  app.patch<{ Params: { id: string } }>(
    "/admin/property-types/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!adminRoles.includes(request.authUser.role))
        return reply.code(403).send({ error: "Admin access required" });

      const parsed = typeInput
        .omit({ key: true }) // key is immutable after creation
        .partial()
        .safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid update", details: parsed.error.flatten() });

      const existing = await prisma.propertyType.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: "Property type not found" });

      return prisma.propertyType.update({ where: { id: request.params.id }, data: parsed.data });
    },
  );

  // ── Admin: delete property type ───────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    "/admin/property-types/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!adminRoles.includes(request.authUser.role))
        return reply.code(403).send({ error: "Admin access required" });

      const existing = await prisma.propertyType.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: "Property type not found" });

      await prisma.propertyType.delete({ where: { id: request.params.id } });
      return reply.code(204).send();
    },
  );
}
