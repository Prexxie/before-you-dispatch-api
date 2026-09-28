-- The previous VendorCategory values (food, groceries, fashion,
-- electronics, other) didn't match the sign-up design's actual "What do
-- you sell?" options. Replaced before any real vendor exists; the handful
-- of test rows fall back to "other" rather than a guessed mapping.
ALTER TABLE "Vendor" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "Vendor" ALTER COLUMN "category" TYPE TEXT USING ("category"::TEXT);
DROP TYPE "VendorCategory";
CREATE TYPE "VendorCategory" AS ENUM ('retail_ecommerce', 'food_restaurant', 'pharmacy', 'delivery_logistics', 'other');
UPDATE "Vendor" SET "category" = 'other'
  WHERE "category" NOT IN ('retail_ecommerce', 'food_restaurant', 'pharmacy', 'delivery_logistics', 'other');
ALTER TABLE "Vendor" ALTER COLUMN "category" TYPE "VendorCategory" USING ("category"::"VendorCategory");
