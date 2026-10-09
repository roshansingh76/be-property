import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    service: "palia-property-api",
    environment: config.NODE_ENV,
  }));

  app.get("/health/live", async () => ({ status: "ok" }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", database: "up" };
    } catch {
      return reply.code(503).send({ status: "degraded", database: "down" });
    }
  });
}
