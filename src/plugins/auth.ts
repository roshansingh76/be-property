import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { prisma } from "../db.js";

export default fp(async (app: FastifyInstance) => {
  await app.register(jwt, { secret: config.JWT_SECRET });
  app.decorateRequest("authUser");
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const payload = request.user as { sub?: string; phone?: string; role?: string };
      if (!payload.sub || !payload.phone || !payload.role) {
        return reply.code(401).send({ error: "Invalid access token", code: "INVALID_TOKEN", requestId: request.id });
      }
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return reply.code(401).send({ error: "User not found", code: "USER_NOT_FOUND", requestId: request.id });
      if (user.isBlocked) {
        return reply.code(403).send({ error: "Account blocked. Contact an administrator.", code: "ACCOUNT_BLOCKED", requestId: request.id });
      }
      request.authUser = { userId: user.id, phone: user.phone, role: user.role };
    } catch {
      return reply.code(401).send({ error: "Authentication required", code: "UNAUTHENTICATED", requestId: request.id });
    }
  });
});
