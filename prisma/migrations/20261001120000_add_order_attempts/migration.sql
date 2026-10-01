-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "OrderAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "riderId" TEXT NOT NULL,
    "failureReason" "FailureReason",
    "dispatchedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "landmarkNote" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderAttempt_orderId_idx" ON "OrderAttempt"("orderId");

-- AddForeignKey
ALTER TABLE "OrderAttempt" ADD CONSTRAINT "OrderAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAttempt" ADD CONSTRAINT "OrderAttempt_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
