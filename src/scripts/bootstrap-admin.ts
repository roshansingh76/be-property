import "dotenv/config";
import { z } from "zod";
import { prisma } from "../db.js";

if (!process.env.ADMIN_PHONE) {
  console.info("ADMIN_PHONE is not configured; skipping super-admin bootstrap.");
  await prisma.$disconnect();
  process.exit(0);
}

const phone = z.string().regex(/^[6-9]\d{9}$/).parse(process.env.ADMIN_PHONE);

const user = await prisma.user.upsert({
  where: { phone },
  update: { role: "SUPER_ADMIN", isVerified: true, isBlocked: false },
  create: { phone, role: "SUPER_ADMIN", isVerified: true },
});

console.log(`Super admin ready: ${user.phone} (${user.id})`);
await prisma.$disconnect();