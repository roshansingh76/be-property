import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, allowedOrigins } from "./config.js";
import { prisma } from "./db.js";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { leadRoutes } from "./routes/leads.js";
import { propertyRoutes } from "./routes/properties.js";
import { dashboardRoutes } from "./routes/dashboards.js";
import { workflowRoutes } from "./routes/workflows.js";
import { adminRoutes } from "./routes/admin.js";
import { propertyTypeRoutes } from "./routes/property-types.js";
import { inquiryRoutes } from "./routes/inquiries.js";
import { errorBody } from "./lib/http.js";
import { registerWhatsAppWebhook } from "./whatsapp/webhook.js";
import { createWhatsAppWorker } from "./whatsapp/queue.js";

const app = Fastify({
  logger: {
    level: config.NODE_ENV === "production" ? "info" : "debug",
  },
  requestTimeout: 30_000,
  trustProxy: true,
  genReqId: () => crypto.randomUUID(),
});

await app.register(helmet, {
  global: true,
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
});
await app.register(compress);
await app.register(rateLimit, {
  max: 200,
  timeWindow: "1 minute",
  allowList: (request) => request.url.startsWith("/health"),
});
await app.register(cors, {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});
await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 10 } });
await app.register(fastifyStatic, {
  root: path.join(path.dirname(fileURLToPath(import.meta.url)), "../uploads"),
  prefix: "/uploads/",
});
await app.register(authPlugin);
await app.register(healthRoutes);
await app.register(authRoutes, { prefix: "/api/v1" });
await app.register(propertyRoutes, { prefix: "/api/v1" });
await app.register(leadRoutes, { prefix: "/api/v1" });
await app.register(dashboardRoutes, { prefix: "/api/v1" });
await app.register(workflowRoutes, { prefix: "/api/v1" });
await app.register(adminRoutes, { prefix: "/api/v1" });
await app.register(propertyTypeRoutes, { prefix: "/api/v1" });
await app.register(inquiryRoutes, { prefix: "/api/v1" });
await registerWhatsAppWebhook(app);

app.addHook("onSend", async (request, reply, payload) => {
  void reply.header("x-request-id", request.id);
  return payload;
});

app.setNotFoundHandler((request, reply) => {
  return reply.code(404).send(errorBody(request, "Route not found", "NOT_FOUND"));
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error, requestId: request.id }, "request failed");
  const known = error as { statusCode?: number; message?: string; code?: string };
  if (known.statusCode === 429) {
    return reply.code(429).send(errorBody(request, "Too many requests. Please try again shortly.", "RATE_LIMITED"));
  }
  if (known.statusCode && known.statusCode < 500) {
    return reply.code(known.statusCode).send(errorBody(request, known.message ?? "Request failed", known.code ?? "REQUEST_FAILED"));
  }
  return reply.code(500).send(errorBody(
    request,
    config.NODE_ENV === "production" ? "Internal server error" : known.message ?? "Request failed",
    "INTERNAL_ERROR",
  ));
});

let whatsAppWorker: Awaited<ReturnType<typeof createWhatsAppWorker>> | null = null;
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  if (whatsAppWorker) await whatsAppWorker.close();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  whatsAppWorker = createWhatsAppWorker();
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  if (whatsAppWorker) await whatsAppWorker.close();
  await prisma.$disconnect();
  process.exit(1);
}
