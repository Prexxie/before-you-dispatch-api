-- CreateEnum
CREATE TYPE "DeliveryConfirmer" AS ENUM ('customer', 'vendor');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryConfirmedBy" "DeliveryConfirmer",
ADD COLUMN     "receivedAt" TIMESTAMP(3);

