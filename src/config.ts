import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("7d"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  EXTRA_WEB_ORIGINS: z.string().optional(),
  MSG91_AUTH_KEY: z.string().min(1).optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().min(1).optional(),
  MSG91_API_BASE: z.string().url().default("https://control.msg91.com"),
  WHATSAPP_TOKEN: z.string().min(1).optional(),
  PHONE_NUMBER_ID: z.string().min(1).optional(),
  WABA_ID: z.string().min(1).optional(),
  VERIFY_TOKEN: z.string().min(1).optional(),
  APP_SECRET: z.string().min(1).optional(),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  WHATSAPP_API_BASE: z.string().url().default("https://graph.facebook.com/v19.0"),
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production") {
    if (!value.MSG91_AUTH_KEY) {
      context.addIssue({ code: "custom", path: ["MSG91_AUTH_KEY"], message: "Required in production to deliver OTPs" });
    }
    if (!value.MSG91_OTP_TEMPLATE_ID) {
      context.addIssue({ code: "custom", path: ["MSG91_OTP_TEMPLATE_ID"], message: "Required in production to deliver OTPs" });
    }
    if (!process.env.REDIS_URL) {
      context.addIssue({ code: "custom", path: ["REDIS_URL"], message: "Required in production for shared rate limits and queues" });
    }
    if (new URL(value.MSG91_API_BASE).protocol !== "https:") {
      context.addIssue({ code: "custom", path: ["MSG91_API_BASE"], message: "Must use HTTPS in production" });
    }
  }
});

export const config = schema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  EXTRA_WEB_ORIGINS: process.env.EXTRA_WEB_ORIGINS,
  MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY,
  MSG91_OTP_TEMPLATE_ID: process.env.MSG91_OTP_TEMPLATE_ID,
  MSG91_API_BASE: process.env.MSG91_API_BASE,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  WABA_ID: process.env.WABA_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  APP_SECRET: process.env.APP_SECRET,
  REDIS_URL: process.env.REDIS_URL,
  WHATSAPP_API_BASE: process.env.WHATSAPP_API_BASE,
});

export const allowedOrigins = [
  config.WEB_ORIGIN,
  "https://veda-fe-property.onrender.com",
  ...(config.EXTRA_WEB_ORIGINS?.split(",").map(origin => origin.trim()).filter(Boolean) ?? []),
];
