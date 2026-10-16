import { PrismaClient } from '@prisma/client';
import { applyEncryptionMiddleware } from '../middleware/prisma-encryption.middleware';

const prisma = new PrismaClient();

applyEncryptionMiddleware(prisma);

export { prisma };
