-- CreateIndex
CREATE INDEX "Lead_buyerPhone_propertyId_createdAt_idx" ON "Lead"("buyerPhone", "propertyId", "createdAt");

-- CreateTable
CREATE TABLE "BuyerInquiry" (
    "id" UUID NOT NULL,
    "buyerName" VARCHAR(120) NOT NULL,
    "buyerPhone" VARCHAR(15) NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "preferredVillages" TEXT[],
    "minArea" DOUBLE PRECISION,
    "maxArea" DOUBLE PRECISION,
    "areaUnit" TEXT,
    "minBudget" BIGINT,
    "maxBudget" BIGINT,
    "waterSourceRequired" TEXT,
    "highwayTouchRequired" BOOLEAN NOT NULL DEFAULT false,
    "immediateRegistryRequired" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(300),
    "status" VARCHAR(20) NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuyerInquiry_buyerPhone_createdAt_idx" ON "BuyerInquiry"("buyerPhone", "createdAt");
