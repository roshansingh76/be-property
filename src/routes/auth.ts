import type { FastifyInstance } from "fastify";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { sendError, sendValidationError } from "../lib/http.js";
import { sendOtp as sendMsg91Otp, verifyOtp as verifyMsg91Otp } from "../lib/msg91.js";
import { redisConnection } from "../whatsapp/queue.js";

const phone = z.string().regex(/^[6-9]\d{9}$/, "Enter a valid Indian mobile number");

type OtpRecord = { value: string; expiresAt: number; attempts: number; sentAt: number; sendCount: number };
const codes = new Map<string, OtpRecord>();

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_WINDOW_MS = 60 * 1000;
const OTP_MAX_SENDS_PER_HOUR = 6;
const OTP_SEND_WINDOW_SECONDS = 60 * 60;
const OTP_REDIS_PREFIX = "palia:otp:";

const reserveOtpSendScript = `
local sentAt = tonumber(redis.call("HGET", KEYS[1], "sentAt"))
local sendCount = tonumber(redis.call("HGET", KEYS[1], "sendCount")) or 0
local now = tonumber(ARGV[1])
if sentAt and now - sentAt < tonumber(ARGV[2]) then return -1 end
if sentAt and sendCount >= tonumber(ARGV[3]) and now - sentAt < tonumber(ARGV[4]) then return -2 end
redis.call("HSET", KEYS[1], "sentAt", now, "sendCount", sendCount + 1, "attempts", 0)
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[4]))
return 1
`;

const recordOtpAttemptScript = `
if redis.call("EXISTS", KEYS[1]) == 0 then return -1 end
local attempts = redis.call("HINCRBY", KEYS[1], "attempts", 1)
if attempts > tonumber(ARGV[1]) then return -2 end
return 1
`;

function otpRedisKey(phoneNumber: string): string {
  const digest = createHash("sha256").update(phoneNumber).digest("hex");
  return `${OTP_REDIS_PREFIX}${digest}`;
}

const profileFields = {
  id: true,
  phone: true,
  name: true,
  email: true,
  whatsappNumber: true,
  avatarUrl: true,
  brokerageName: true,
  brokerRegistrationNumber: true,
  yearsExperience: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  district: true,
  state: true,
  postalCode: true,
  identityDocumentFilename: true,
  identityVerificationStatus: true,
  identityVerificationNote: true,
  role: true,
  isVerified: true,
} as const;

function profileResponse(user: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>) {
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    whatsappNumber: user.whatsappNumber,
    avatarUrl: user.avatarUrl,
    brokerageName: user.brokerageName,
    brokerRegistrationNumber: user.brokerRegistrationNumber,
    yearsExperience: user.yearsExperience,
    addressLine1: user.addressLine1,
    addressLine2: user.addressLine2,
    city: user.city,
    district: user.district,
    state: user.state,
    postalCode: user.postalCode,
    identityDocumentFilename: user.identityDocumentFilename,
    identityVerificationStatus: user.identityVerificationStatus,
    identityVerificationNote: user.identityVerificationNote,
    role: user.role,
    isVerified: user.isVerified,
  };
}

const adminRoles = ["ADMIN", "SUPER_ADMIN"];

function pruneExpired() {
  const now = Date.now();
  for (const [key, record] of codes) {
    if (record.expiresAt < now && now - record.sentAt > 60 * 60 * 1000) codes.delete(key);
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/send-otp", {
    config: { rateLimit: { max: 8, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    pruneExpired();
    const parsed = z.object({ phone }).safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, "Invalid phone number", parsed.error);

    const existing = codes.get(parsed.data.phone);
    const now = Date.now();
    if (config.NODE_ENV === "production") {
      const sendResult = Number(await redisConnection.eval(
        reserveOtpSendScript,
        1,
        otpRedisKey(parsed.data.phone),
        String(Math.floor(now / 1000)),
        String(OTP_RESEND_WINDOW_MS / 1000),
        String(OTP_MAX_SENDS_PER_HOUR),
        String(OTP_SEND_WINDOW_SECONDS),
      ));
      if (sendResult === -1) {
        return sendError(request, reply, 429, "Please wait before requesting another OTP", "OTP_RATE_LIMITED");
      }
      if (sendResult === -2) {
        return sendError(request, reply, 429, "Too many OTP requests. Try again later.", "OTP_RATE_LIMITED");
      }
      try {
        await sendMsg91Otp(parsed.data.phone);
      } catch {
        request.log.error("MSG91 OTP delivery failed");
        return sendError(request, reply, 502, "OTP delivery is temporarily unavailable. Try again later.", "OTP_DELIVERY_FAILED");
      }
      return { sent: true, expiresIn: OTP_TTL_MS / 1000 };
    }

    if (existing && now - existing.sentAt < OTP_RESEND_WINDOW_MS) {
      return sendError(request, reply, 429, "Please wait before requesting another OTP", "OTP_RATE_LIMITED");
    }
    if (existing && existing.sendCount >= OTP_MAX_SENDS_PER_HOUR && now - existing.sentAt < 60 * 60 * 1000) {
      return sendError(request, reply, 429, "Too many OTP requests. Try again later.", "OTP_RATE_LIMITED");
    }

    const value = config.NODE_ENV === "production" ? String(Math.floor(100000 + Math.random() * 900000)) : "123456";
    codes.set(parsed.data.phone, {
      value,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      sentAt: now,
      sendCount: (existing?.sendCount ?? 0) + 1,
    });
    return {
      sent: true,
      expiresIn: OTP_TTL_MS / 1000,
      ...(config.NODE_ENV === "production" ? {} : { developmentCode: value }),
    };
  });

  app.post("/auth/verify-otp", {
    config: { rateLimit: { max: 15, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const parsed = z.object({
      phone,
      code: z.string().regex(/^\d{6}$/),
      role: z.enum(["BUYER", "SELLER", "BROKER"]).default("BUYER"),
      name: z.string().trim().min(2).max(120).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, "Invalid OTP request", parsed.error);

    if (config.NODE_ENV === "production") {
      const attemptResult = Number(await redisConnection.eval(
        recordOtpAttemptScript,
        1,
        otpRedisKey(parsed.data.phone),
        String(OTP_MAX_ATTEMPTS),
      ));
      if (attemptResult === -1) {
        return sendError(request, reply, 401, "Invalid or expired OTP", "OTP_INVALID");
      }
      if (attemptResult === -2) {
        return sendError(request, reply, 429, "Too many incorrect OTP attempts. Request a new code.", "OTP_LOCKED");
      }
      let isVerified: boolean;
      try {
        isVerified = await verifyMsg91Otp(parsed.data.phone, parsed.data.code);
      } catch {
        request.log.error("MSG91 OTP verification failed");
        return sendError(request, reply, 502, "OTP verification is temporarily unavailable. Try again later.", "OTP_VERIFICATION_FAILED");
      }
      if (!isVerified) {
        return sendError(request, reply, 401, "Invalid or expired OTP", "OTP_INVALID");
      }
    } else {
      const stored = codes.get(parsed.data.phone);
      if (!stored || stored.expiresAt < Date.now()) {
        return sendError(request, reply, 401, "Invalid or expired OTP", "OTP_INVALID");
      }
      stored.attempts += 1;
      if (stored.attempts > OTP_MAX_ATTEMPTS) {
        codes.delete(parsed.data.phone);
        return sendError(request, reply, 429, "Too many incorrect OTP attempts. Request a new code.", "OTP_LOCKED");
      }
      if (stored.value !== parsed.data.code) {
        return sendError(request, reply, 401, "Invalid or expired OTP", "OTP_INVALID");
      }
      codes.delete(parsed.data.phone);
    }

    const requestedRole = parsed.data.role;
    const existingUser = await prisma.user.findUnique({ where: { phone: parsed.data.phone } });
    if (existingUser?.isBlocked) {
      return sendError(request, reply, 403, "Account blocked. Contact an administrator.", "ACCOUNT_BLOCKED");
    }
    if (!existingUser && parsed.data.role === "BROKER" && !parsed.data.name) {
      return sendError(request, reply, 400, "Broker registration requires a full name.", "BROKER_NAME_REQUIRED");
    }
    const privilegedRoles = ["ADMIN", "SUPER_ADMIN"];
    if (existingUser && !privilegedRoles.includes(existingUser.role) && existingUser.role !== requestedRole) {
      return sendError(request, reply, 409, `This number is already registered as a ${existingUser.role.toLowerCase()} account. Select that account type to sign in.`, "ACCOUNT_ROLE_MISMATCH");
    }

    const user = existingUser
      ? existingUser.name || !parsed.data.name
        ? existingUser
        : await prisma.user.update({ where: { id: existingUser.id }, data: { name: parsed.data.name } })
      : await prisma.user.create({ data: { phone: parsed.data.phone, role: requestedRole, name: parsed.data.name } });

    const accessToken = app.jwt.sign(
      { sub: user.id, phone: user.phone, role: user.role },
      { expiresIn: config.JWT_EXPIRES_IN },
    );
    return {
      accessToken,
      tokenType: "bearer",
      expiresIn: config.JWT_EXPIRES_IN,
      user: { id: user.id, phone: user.phone, role: user.role, name: user.name },
    };
  });

  app.get("/auth/me", { preHandler: app.authenticate }, async request => {
    const user = await prisma.user.findUnique({ where: { id: request.authUser.userId }, select: profileFields });
    return user;
  });

  app.patch("/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = z.object({
      name: z.string().trim().min(2).max(120).optional(),
      email: z.string().trim().email().max(254).nullable().optional(),
      whatsappNumber: z.string().trim().max(15).nullable().optional(),
      brokerageName: z.string().trim().max(160).nullable().optional(),
      brokerRegistrationNumber: z.string().trim().max(80).nullable().optional(),
      yearsExperience: z.number().int().min(0).max(60).nullable().optional(),
      addressLine1: z.string().trim().max(200).nullable().optional(),
      addressLine2: z.string().trim().max(200).nullable().optional(),
      city: z.string().trim().max(100).nullable().optional(),
      district: z.string().trim().max(100).nullable().optional(),
      state: z.string().trim().max(100).nullable().optional(),
      postalCode: z.string().trim().max(10).nullable().optional(),
    }).safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, "Invalid profile data", parsed.error);
    const normalized = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, value === "" ? null : value]));
    const user = await prisma.user.update({
      where: { id: request.authUser.userId },
      data: normalized,
      select: profileFields,
    });
    return user;
  });

  app.post("/auth/me/avatar", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.authUser.userId;
    const uploadDir = path.join(process.cwd(), "uploads", "avatars", userId);
    await mkdir(uploadDir, { recursive: true });
    const extensionByMime: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    let avatarUrl: string | null = null;
    for await (const part of request.parts()) {
      if (part.type !== "file" || part.fieldname !== "avatar") continue;
      const extension = extensionByMime[part.mimetype];
      if (!extension) {
        part.file.resume();
        return reply.code(400).send({ error: "Profile photo must be JPEG, PNG, or WebP" });
      }
      const filename = `${randomUUID()}${extension}`;
      await pipeline(part.file, createWriteStream(path.join(uploadDir, filename)));
      avatarUrl = `/uploads/avatars/${userId}/${filename}`;
    }
    if (!avatarUrl) return reply.code(400).send({ error: "Choose a profile photo to upload" });
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
    const user = await prisma.user.update({ where: { id: userId }, data: { avatarUrl }, select: profileFields });
    if (current?.avatarUrl?.startsWith(`/uploads/avatars/${userId}/`)) {
      await unlink(path.join(process.cwd(), current.avatarUrl)).catch(() => undefined);
    }
    return user;
  });

  app.post("/auth/me/identity-document", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.authUser.userId;
    let consent = false;
    let filename: string | null = null;
    let storedPath: string | null = null;
    let invalidType = false;
    let documentSeen = false;
    const extensionByMime: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "application/pdf": ".pdf",
    };
    const uploadDir = path.join(process.cwd(), "private_uploads", "identity-documents", userId);
    await mkdir(uploadDir, { recursive: true, mode: 0o700 });

    for await (const part of request.parts()) {
      if (part.type === "field" && part.fieldname === "consent") {
        consent = part.value === "true";
        continue;
      }
      if (part.type !== "file" || part.fieldname !== "document") continue;
      if (documentSeen) {
        invalidType = true;
        part.file.resume();
        continue;
      }
      documentSeen = true;
      const extension = extensionByMime[part.mimetype];
      if (!extension) {
        invalidType = true;
        part.file.resume();
        continue;
      }
      const storedName = `${randomUUID()}${extension}`;
      filename = part.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || `identity${extension}`;
      storedPath = path.join(uploadDir, storedName);
      await pipeline(part.file, createWriteStream(storedPath, { flags: "wx", mode: 0o600 }));
    }

    if (invalidType || !storedPath || !filename) {
      if (storedPath) await unlink(storedPath).catch(() => undefined);
      return reply.code(400).send({ error: "Upload one JPEG, PNG, WebP, or PDF identity document" });
    }
    if (!consent) {
      await unlink(storedPath).catch(() => undefined);
      return reply.code(400).send({ error: "Consent is required before submitting identity documents" });
    }

    const current = await prisma.user.findUnique({ where: { id: userId }, select: { identityDocumentPath: true } });
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        identityDocumentPath: storedPath,
        identityDocumentFilename: filename,
        identityVerificationStatus: "PENDING",
        identityVerificationNote: null,
        kycConsentAt: new Date(),
      },
      select: profileFields,
    });
    if (current?.identityDocumentPath) await unlink(current.identityDocumentPath).catch(() => undefined);
    return user;
  });

  app.get("/auth/me/identity-document", { preHandler: app.authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.authUser.userId }, select: { identityDocumentPath: true, identityDocumentFilename: true } });
    if (!user?.identityDocumentPath) return reply.code(404).send({ error: "No identity document submitted" });
    try {
      await access(user.identityDocumentPath);
    } catch {
      return reply.code(404).send({ error: "Identity document is unavailable" });
    }
    const extension = path.extname(user.identityDocumentPath).toLowerCase();
    const mimeType = extension === ".pdf" ? "application/pdf" : extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return reply.type(mimeType).header("Content-Disposition", `attachment; filename="${(user.identityDocumentFilename ?? "identity-document").replace(/"/g, "")}"`).send(createReadStream(user.identityDocumentPath));
  });

  app.get<{ Params: { id: string } }>("/admin/users/:id/identity-document", { preHandler: app.authenticate }, async (request, reply) => {
    if (!adminRoles.includes(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const user = await prisma.user.findUnique({ where: { id: request.params.id }, select: { identityDocumentPath: true, identityDocumentFilename: true } });
    if (!user?.identityDocumentPath) return reply.code(404).send({ error: "No identity document submitted" });
    try {
      await access(user.identityDocumentPath);
    } catch {
      return reply.code(404).send({ error: "Identity document is unavailable" });
    }
    const extension = path.extname(user.identityDocumentPath).toLowerCase();
    const mimeType = extension === ".pdf" ? "application/pdf" : extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return reply.type(mimeType).header("Content-Disposition", `attachment; filename="${(user.identityDocumentFilename ?? "identity-document").replace(/"/g, "")}"`).send(createReadStream(user.identityDocumentPath));
  });

  app.patch<{ Params: { id: string } }>("/admin/users/:id/identity-review", { preHandler: app.authenticate }, async (request, reply) => {
    if (!adminRoles.includes(request.authUser.role)) return reply.code(403).send({ error: "Admin access required" });
    const parsed = z.object({ status: z.enum(["PENDING", "VERIFIED", "REJECTED"]), note: z.string().max(500).nullable().optional() }).safeParse(request.body);
    if (!parsed.success) return sendValidationError(request, reply, "Invalid identity review", parsed.error);
    const user = await prisma.user.update({
      where: { id: request.params.id },
      data: { identityVerificationStatus: parsed.data.status, identityVerificationNote: parsed.data.note ?? null },
      select: { id: true, identityVerificationStatus: true, identityVerificationNote: true },
    }).catch(() => null);
    if (!user) return reply.code(404).send({ error: "User not found" });
    return user;
  });
}
