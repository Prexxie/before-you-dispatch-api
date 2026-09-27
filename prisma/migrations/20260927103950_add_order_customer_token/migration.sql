-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerToken" UUID NOT NULL DEFAULT gen_random_uuid();

-- CreateIndex
CREATE UNIQUE INDEX "Order_customerToken_key" ON "Order"("customerToken");

