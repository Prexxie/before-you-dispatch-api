-- AlterTable
-- Nullable first so existing rows don't fail the NOT NULL constraint;
-- backfilled from createdAt (a reasonable "last touched" for rows that
-- predate this column), then locked to NOT NULL. New rows and every write
-- from here on get a real value from Prisma's @updatedAt.
ALTER TABLE "Order" ADD COLUMN     "updatedAt" TIMESTAMP(3);
UPDATE "Order" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "Order" ALTER COLUMN "updatedAt" SET NOT NULL;

