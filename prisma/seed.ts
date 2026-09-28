import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";

// A demo vendor account to log in with locally, plus sample riders so the
// create order form has someone to assign. Riders get their own management
// page in week 2. Safe to re-run.
const DEMO_VENDOR = {
  id: "demo-vendor-1",
  businessName: "Precious Food Business",
  businessAddress: "12 Allen Avenue, Ikeja",
  businessPhone: "0803 214 7765",
  email: "demo@beforeyoudispatch.test",
  password: "ChangeMe123!",
};

const RIDERS = [
  { id: "seed-rider-1", name: "Tunde Bakare", phone: "+2348012345678", vehicle: "bike" },
  { id: "seed-rider-2", name: "Chidi Okafor", phone: "+2348120045521", vehicle: "car" },
  { id: "seed-rider-3", name: "Ngozi Eze", phone: "+2349067713348", vehicle: "bike" },
] as const;

async function main() {
  const vendor = await prisma.vendor.upsert({
    where: { id: DEMO_VENDOR.id },
    update: {},
    create: {
      id: DEMO_VENDOR.id,
      businessName: DEMO_VENDOR.businessName,
      businessAddress: DEMO_VENDOR.businessAddress,
      businessPhone: DEMO_VENDOR.businessPhone,
      email: DEMO_VENDOR.email,
      passwordHash: await hashPassword(DEMO_VENDOR.password),
    },
  });
  console.log(
    `Seeded vendor ${vendor.id} — log in with ${DEMO_VENDOR.email} / ${DEMO_VENDOR.password}`,
  );

  for (const data of RIDERS) {
    const rider = await prisma.rider.upsert({
      where: { id: data.id },
      update: { vehicle: data.vehicle, vendorId: vendor.id },
      create: { ...data, vendorId: vendor.id },
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
