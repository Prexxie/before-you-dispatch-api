-- businessAddress becomes required: it's the rider's pickup point, not
-- optional context. Existing rows without one (all test/demo accounts,
-- never a real vendor's) get a placeholder rather than losing the row.
UPDATE "Vendor" SET "businessAddress" = 'Address not set' WHERE "businessAddress" IS NULL;
ALTER TABLE "Vendor" ALTER COLUMN "businessAddress" SET NOT NULL;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "logoUrl" TEXT;
