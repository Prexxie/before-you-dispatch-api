-- CreateEnum
CREATE TYPE "VendorCategory" AS ENUM ('food', 'groceries', 'fashion', 'electronics', 'other');

-- AlterTable: add nullable first so existing vendor rows (all test/demo
-- accounts) can be backfilled, then tighten to NOT NULL. ownerName falls
-- back to the business name; category falls back to "other" — both are
-- asked for on every sign up from here on.
ALTER TABLE "Vendor" ADD COLUMN     "ownerName" TEXT;
ALTER TABLE "Vendor" ADD COLUMN     "category" "VendorCategory";

UPDATE "Vendor" SET "ownerName" = "businessName" WHERE "ownerName" IS NULL;
UPDATE "Vendor" SET "category" = 'other' WHERE "category" IS NULL;

ALTER TABLE "Vendor" ALTER COLUMN "ownerName" SET NOT NULL;
ALTER TABLE "Vendor" ALTER COLUMN "category" SET NOT NULL;
