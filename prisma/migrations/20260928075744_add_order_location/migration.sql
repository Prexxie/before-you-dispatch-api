-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "landmarkNote" TEXT,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "locationSavedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SavedLocation" (
    "phoneKey" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "landmarkNote" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedLocation_pkey" PRIMARY KEY ("phoneKey")
);
