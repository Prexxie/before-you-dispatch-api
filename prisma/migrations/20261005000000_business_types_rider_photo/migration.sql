-- New business-type list ("What kind of business do you run?"), a free-text
-- type for "Other", and an optional rider photo.
--
-- Existing vendors keep a sensible category:
--   retail_ecommerce   -> ecommerce
--   delivery_logistics -> courier_dispatch
-- food_restaurant, pharmacy and other carry over unchanged.

-- CreateEnum
CREATE TYPE "VendorCategory_new" AS ENUM ('food_restaurant', 'ecommerce', 'retail_store', 'courier_dispatch', 'phones_gadgets', 'pharmacy', 'fashion_clothing', 'hair_beauty', 'health_wellness', 'other');

-- AlterTable
ALTER TABLE "Vendor" ALTER COLUMN "category" TYPE "VendorCategory_new" USING (
  CASE "category"::text
    WHEN 'retail_ecommerce' THEN 'ecommerce'
    WHEN 'delivery_logistics' THEN 'courier_dispatch'
    ELSE "category"::text
  END::"VendorCategory_new"
);
ALTER TABLE "Vendor" ADD COLUMN "categoryOther" TEXT;

-- DropEnum
DROP TYPE "VendorCategory";
ALTER TYPE "VendorCategory_new" RENAME TO "VendorCategory";

-- AlterTable
ALTER TABLE "Rider" ADD COLUMN "photoUrl" TEXT;
