-- Vendor accounts replace the single shared DEMO_VENDOR_* env config and the
-- implicit "one vendor for everyone" data model.

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "businessAddress" TEXT,
    "businessPhone" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_email_key" ON "Vendor"("email");

-- Seed a demo vendor so existing Rider/Order/SavedLocation rows (all local
-- test data) have somewhere to backfill onto, and so there's an account to
-- log in with right after this migration. Password: ChangeMe123! — meant to
-- be changed once a real settings/change-password page exists; fine for now
-- since this is a demo account, not a real vendor's.
INSERT INTO "Vendor" ("id", "businessName", "businessAddress", "businessPhone", "email", "passwordHash")
VALUES (
    'demo-vendor-1',
    'Precious Food Business',
    '12 Allen Avenue, Ikeja',
    '0803 214 7765',
    'demo@beforeyoudispatch.test',
    '$2b$10$EpigFCGv9ct9VJ1cWf8LeO2CGoFqWg23oRvdXALjQcZRNCWKflYxe'
);

-- AlterTable: add nullable first so existing rows can be backfilled, then
-- tighten to NOT NULL once every row has a value.
ALTER TABLE "Rider" ADD COLUMN     "vendorId" TEXT;
UPDATE "Rider" SET "vendorId" = 'demo-vendor-1' WHERE "vendorId" IS NULL;
ALTER TABLE "Rider" ALTER COLUMN "vendorId" SET NOT NULL;

ALTER TABLE "Order" ADD COLUMN     "vendorId" TEXT;
UPDATE "Order" SET "vendorId" = 'demo-vendor-1' WHERE "vendorId" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "vendorId" SET NOT NULL;

ALTER TABLE "SavedLocation" ADD COLUMN     "vendorId" TEXT;
UPDATE "SavedLocation" SET "vendorId" = 'demo-vendor-1' WHERE "vendorId" IS NULL;
ALTER TABLE "SavedLocation" ALTER COLUMN "vendorId" SET NOT NULL;

-- AlterTable: SavedLocation's key becomes (vendorId, phoneKey) — the same
-- phone number can be a different person to a different vendor.
ALTER TABLE "SavedLocation" DROP CONSTRAINT "SavedLocation_pkey",
ADD CONSTRAINT "SavedLocation_pkey" PRIMARY KEY ("vendorId", "phoneKey");

-- CreateIndex
CREATE INDEX "Order_vendorId_idx" ON "Order"("vendorId");

-- CreateIndex
CREATE INDEX "Rider_vendorId_idx" ON "Rider"("vendorId");

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedLocation" ADD CONSTRAINT "SavedLocation_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
