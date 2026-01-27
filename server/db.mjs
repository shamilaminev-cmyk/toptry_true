import { PrismaClient } from '@prisma/client';

let prisma = null;

/**
 * Create prisma client if DATABASE_URL is configured.
 * The app should still boot without DB (MVP dev mode), but persistence endpoints
 * will become no-ops.
 */
export function getPrisma() {
  if (prisma) return prisma;
  if (!process.env.DATABASE_URL) return null;
  prisma = new PrismaClient();
  return prisma;
}

export async function getPublicUserById(userId) {
  const p = getPrisma();
  if (!p) return null;
  return p.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, avatarUrl: true, isPublic: true },
  });
}
