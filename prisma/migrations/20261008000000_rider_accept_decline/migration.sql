-- The rider accepts a delivery, or says they can't take it, before pickup.

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "acceptedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "riderDeclinedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "declinedRiderName" TEXT;

-- Orders already sent out before this step existed count as accepted, so a
-- rider mid-delivery isn't asked to accept again.
UPDATE "Order" SET "acceptedAt" = "dispatchedAt" WHERE "dispatchedAt" IS NOT NULL;
