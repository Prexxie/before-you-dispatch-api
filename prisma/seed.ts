import { prisma } from "../src/lib/prisma";

// Sample riders so the create order form has someone to assign during local
// dev. Riders get their own management page in week 2. Safe to re-run.
const RIDERS = [
  { id: "seed-rider-1", name: "Tunde Bakare", phone: "+2348012345678", vehicle: "bike" },
  { id: "seed-rider-2", name: "Chidi Okafor", phone: "+2348120045521", vehicle: "car" },
  { id: "seed-rider-3", name: "Ngozi Eze", phone: "+2349067713348", vehicle: "bike" },
] as const;

async function main() {
  for (const data of RIDERS) {
    const rider = await prisma.rider.upsert({
      where: { id: data.id },
      update: { vehicle: data.vehicle },
      create: data,
    });
    console.log(`Seeded rider ${rider.id} (${rider.name})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
