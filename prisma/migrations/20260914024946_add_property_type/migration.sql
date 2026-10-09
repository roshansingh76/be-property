-- CreateTable
CREATE TABLE "PropertyType" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300),
    "icon" VARCHAR(80),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PropertyType_key_key" ON "PropertyType"("key");

-- CreateIndex
CREATE INDEX "PropertyType_isActive_sortOrder_idx" ON "PropertyType"("isActive", "sortOrder");
