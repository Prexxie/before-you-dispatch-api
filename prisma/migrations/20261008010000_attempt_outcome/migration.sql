-- The attempt history also keeps a customer's "Not now" when the vendor
-- retriggers the order. Existing rows were all failed deliveries.

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('failed', 'declined');

-- AlterTable
ALTER TABLE "OrderAttempt" ADD COLUMN "outcome" "AttemptOutcome" NOT NULL DEFAULT 'failed';
