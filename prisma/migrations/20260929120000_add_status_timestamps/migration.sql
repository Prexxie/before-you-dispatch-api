-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "notReadyAt" TIMESTAMP(3),
ADD COLUMN     "pickedUpAt" TIMESTAMP(3);

