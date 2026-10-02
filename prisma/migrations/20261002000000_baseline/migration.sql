-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending_confirmation', 'confirmed', 'not_ready', 'dispatched', 'delivered', 'failed');

-- CreateEnum
CREATE TYPE "FailureReason" AS ENUM ('customer_not_ready', 'address_not_found', 'customer_unreachable', 'other');

-- CreateEnum
CREATE TYPE "DeliveryConfirmer" AS ENUM ('customer', 'vendor');

-- CreateEnum
CREATE TYPE "Vehicle" AS ENUM ('bike', 'car', 'van');

-- CreateEnum
CREATE TYPE "VendorCategory" AS ENUM ('retail_ecommerce', 'food_restaurant', 'pharmacy', 'delivery_logistics', 'other');

-- CreateEnum
CREATE TYPE "ThemeColor" AS ENUM ('green', 'crimson', 'navy', 'amber', 'purple');

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "businessAddress" TEXT NOT NULL,
    "businessPhone" TEXT,
    "logoUrl" TEXT,
    "ownerName" TEXT NOT NULL,
    "category" "VendorCategory" NOT NULL,
    "themeColor" "ThemeColor" NOT NULL DEFAULT 'green',
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicle" "Vehicle",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "vendorId" TEXT NOT NULL,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" SERIAL NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_confirmation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerToken" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "landmarkNote" TEXT,
    "locationAddress" TEXT,
    "locationSavedAt" TIMESTAMP(3),
    "riderToken" UUID NOT NULL DEFAULT gen_random_uuid(),
    "confirmedAt" TIMESTAMP(3),
    "notReadyAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" "FailureReason",
    "failureNote" TEXT,
    "deliveryConfirmedBy" "DeliveryConfirmer",
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "retriggeredAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "riderId" TEXT NOT NULL,
    "failureReason" "FailureReason",
    "failureNote" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "landmarkNote" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedLocation" (
    "vendorId" TEXT NOT NULL,
    "phoneKey" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "landmarkNote" TEXT NOT NULL,
    "address" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedLocation_pkey" PRIMARY KEY ("vendorId","phoneKey")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_googleId_key" ON "Vendor"("googleId");

-- CreateIndex
CREATE INDEX "Rider_vendorId_idx" ON "Rider"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_customerToken_key" ON "Order"("customerToken");

-- CreateIndex
CREATE UNIQUE INDEX "Order_riderToken_key" ON "Order"("riderToken");

-- CreateIndex
CREATE INDEX "Order_riderId_idx" ON "Order"("riderId");

-- CreateIndex
CREATE INDEX "Order_vendorId_idx" ON "Order"("vendorId");

-- CreateIndex
CREATE INDEX "OrderAttempt_orderId_idx" ON "OrderAttempt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_vendorId_idx" ON "PasswordReset"("vendorId");

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttempt" ADD CONSTRAINT "OrderAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttempt" ADD CONSTRAINT "OrderAttempt_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedLocation" ADD CONSTRAINT "SavedLocation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

