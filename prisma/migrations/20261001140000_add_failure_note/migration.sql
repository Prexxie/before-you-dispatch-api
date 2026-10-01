-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "failureNote" TEXT;

-- AlterTable
ALTER TABLE "OrderAttempt" ADD COLUMN     "failureNote" TEXT;
