-- AlterTable: accounts made with Google may have no password.
ALTER TABLE "Vendor" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "Vendor" ADD COLUMN "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_googleId_key" ON "Vendor"("googleId");
