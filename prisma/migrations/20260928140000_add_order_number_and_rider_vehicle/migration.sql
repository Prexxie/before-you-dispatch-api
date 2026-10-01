-- CreateEnum
CREATE TYPE "Vehicle" AS ENUM ('bike', 'car', 'van');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "orderNumber" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Rider" ADD COLUMN     "vehicle" "Vehicle";

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

