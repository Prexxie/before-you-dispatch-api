-- CreateEnum
CREATE TYPE "ThemeColor" AS ENUM ('green', 'crimson', 'navy', 'amber', 'purple');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "themeColor" "ThemeColor" NOT NULL DEFAULT 'green';
