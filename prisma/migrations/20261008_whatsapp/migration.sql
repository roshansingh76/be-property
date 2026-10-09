CREATE TYPE "WhatsAppDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'REJECTED', 'OPTED_OUT');

CREATE TABLE "WhatsAppContact" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "phone" VARCHAR(20) NOT NULL UNIQUE,
    "firstName" VARCHAR(80),
    "lastName" VARCHAR(80),
    "source" VARCHAR(60),
    "isOptedOut" BOOLEAN NOT NULL DEFAULT false,
    "optOutReason" VARCHAR(200),
    "consentedAt" TIMESTAMPTZ,
    "optOutAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "WhatsAppOptIn" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "phone" VARCHAR(20) NOT NULL,
    "source" VARCHAR(60) NOT NULL,
    "consentText" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "consentedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactId" UUID,
    CONSTRAINT "WhatsAppOptIn_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE SET NULL
);

CREATE TABLE "WhatsAppMessage" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "contactId" UUID,
    "phone" VARCHAR(20) NOT NULL,
    "direction" "WhatsAppDirection" NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "template" VARCHAR(120),
    "eventName" VARCHAR(120),
    "providerMessageId" VARCHAR(120),
    "content" VARCHAR(5000),
    "error" VARCHAR(1000),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE SET NULL
);

CREATE TABLE "ConversationState" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "contactId" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "stateKey" VARCHAR(80) NOT NULL,
    "currentStep" VARCHAR(80),
    "state" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationState_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "WhatsAppContact"("id") ON DELETE CASCADE,
    CONSTRAINT "ConversationState_contactId_stateKey_key" UNIQUE ("contactId", "stateKey")
);

CREATE INDEX "WhatsAppContact_isOptedOut_updatedAt_idx"
    ON "WhatsAppContact" ("isOptedOut", "updatedAt");

CREATE INDEX "WhatsAppOptIn_phone_isActive_idx"
    ON "WhatsAppOptIn" ("phone", "isActive");

CREATE INDEX "WhatsAppMessage_phone_createdAt_idx"
    ON "WhatsAppMessage" ("phone", "createdAt");

CREATE INDEX "WhatsAppMessage_status_createdAt_idx"
    ON "WhatsAppMessage" ("status", "createdAt");

CREATE INDEX "ConversationState_phone_stateKey_idx"
    ON "ConversationState" ("phone", "stateKey");
