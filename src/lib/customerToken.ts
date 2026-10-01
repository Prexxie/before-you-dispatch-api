import { prisma } from "./prisma";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Invalid UUIDs would make Postgres throw on the cast, so treat them as
// not-found before querying. Includes the vendor relation: the customer and
// rider pages both need the business name, address and phone.
export function findOrderByCustomerToken(token: string) {
  if (!UUID_PATTERN.test(token)) return null;
  return prisma.order.findUnique({
    where: { customerToken: token },
    include: { vendor: true },
  });
}
