import { PrismaClient } from '@prisma/client';
import { applyEncryptionMiddleware } from '../middleware/prisma-encryption.middleware';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  (globalForPrisma.prisma = new PrismaClient());

applyEncryptionMiddleware(prisma);

export default prisma;
