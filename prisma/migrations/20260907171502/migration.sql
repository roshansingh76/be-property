-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BUYER', 'SELLER', 'BROKER', 'AGENT', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'REJECTED', 'SOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PropertyCategory" AS ENUM ('AGRICULTURAL_LAND', 'PADDY_WHEAT', 'SUGARCANE_FARM', 'MANGO_ORCHARD', 'POPLAR_PLANTATION', 'FARMHOUSE', 'DAIRY_POULTRY', 'RESIDENTIAL_PLOT', 'HOUSE', 'COMMERCIAL_PROPERTY', 'HIGHWAY_INVESTMENT', 'INDUSTRIAL_LAND', 'WAREHOUSE', 'RESORT_HOTEL_LAND');

-- CreateEnum
CREATE TYPE "LandUnit" AS ENUM ('BIGHA', 'ACRE', 'HECTARE', 'SQFT');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'SITE_VISIT', 'OFFER_MADE', 'CLOSED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('KHATAUNI', 'KHASRA', 'IDENTITY', 'REGISTRY', 'OTHER');

-- CreateEnum
CREATE TYPE "SiteVisitStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "name" VARCHAR(120),
    "role" "UserRole" NOT NULL DEFAULT 'BUYER',
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(300) NOT NULL,
    "category" "PropertyCategory" NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "village" VARCHAR(100) NOT NULL,
    "tehsil" TEXT NOT NULL DEFAULT 'Palia',
    "district" TEXT NOT NULL DEFAULT 'Lakhimpur Kheri',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "price" BIGINT NOT NULL,
    "pricePerBigha" BIGINT,
    "pricePerAcre" BIGINT,
    "area" DOUBLE PRECISION NOT NULL,
    "areaUnit" "LandUnit" NOT NULL DEFAULT 'BIGHA',
    "irrigation" TEXT[],
    "roadFrontage" INTEGER,
    "electricity" BOOLEAN NOT NULL DEFAULT false,
    "highwayTouch" BOOLEAN NOT NULL DEFAULT false,
    "canalTouch" BOOLEAN NOT NULL DEFAULT false,
    "distanceFromPalia" DOUBLE PRECISION,
    "khasraNumber" TEXT,
    "khatauniVerified" BOOLEAN NOT NULL DEFAULT false,
    "registryReady" BOOLEAN NOT NULL DEFAULT false,
    "images" TEXT[],
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyDocument" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyVerification" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedProperty" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyAlert" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "village" TEXT,
    "category" "PropertyCategory",
    "minPrice" BIGINT,
    "maxPrice" BIGINT,
    "minArea" DOUBLE PRECISION,
    "maxArea" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "status" "SiteVisitStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "buyerId" UUID,
    "buyerName" VARCHAR(120) NOT NULL,
    "buyerPhone" VARCHAR(15) NOT NULL,
    "buyerWhatsapp" VARCHAR(15),
    "message" VARCHAR(500),
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL DEFAULT 'website',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Property_slug_key" ON "Property"("slug");

-- CreateIndex
CREATE INDEX "Property_status_village_category_idx" ON "Property"("status", "village", "category");

-- CreateIndex
CREATE INDEX "Property_status_price_idx" ON "Property"("status", "price");

-- CreateIndex
CREATE INDEX "PropertyDocument_propertyId_type_idx" ON "PropertyDocument"("propertyId", "type");

-- CreateIndex
CREATE INDEX "PropertyVerification_status_idx" ON "PropertyVerification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyVerification_propertyId_level_key" ON "PropertyVerification"("propertyId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "SavedProperty_userId_propertyId_key" ON "SavedProperty"("userId", "propertyId");

-- CreateIndex
CREATE INDEX "SiteVisit_propertyId_status_idx" ON "SiteVisit"("propertyId", "status");

-- CreateIndex
CREATE INDEX "SiteVisit_buyerId_status_idx" ON "SiteVisit"("buyerId", "status");

-- CreateIndex
CREATE INDEX "Lead_propertyId_status_idx" ON "Lead"("propertyId", "status");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyDocument" ADD CONSTRAINT "PropertyDocument_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyVerification" ADD CONSTRAINT "PropertyVerification_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedProperty" ADD CONSTRAINT "SavedProperty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedProperty" ADD CONSTRAINT "SavedProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyAlert" ADD CONSTRAINT "PropertyAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
