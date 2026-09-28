-- CreateEnum
CREATE TYPE "FailureReason" AS ENUM ('customer_not_ready', 'address_not_found', 'customer_unreachable', 'other');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" "FailureReason",
ADD COLUMN     "riderToken" UUID NOT NULL DEFAULT gen_random_uuid();

-- CreateIndex
CREATE UNIQUE INDEX "Order_riderToken_key" ON "Order"("riderToken");

