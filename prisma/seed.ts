import { prisma } from "../src/lib/prisma";

// A sample rider so POST /orders has a riderId to assign during local dev.
// There's no rider-management endpoint in the MVP yet.
async function main() {
  const rider = await prisma.rider.upsert({
    where: { id: "seed-rider-1" },
    update: {},
    create: { id: "seed-rider-1", name: "Tunde Bakare", phone: "+2348012345678" },
  });
  console.log(`Seeded rider ${rider.id} (${rider.name})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
