import { describe, it, expect, beforeEach, afterAll } from '@vitest/globals';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const userId = 'cycle-test-user';
const groupId = 'cycle-test-group';

beforeEach(async () => {
  await prisma.contribution.deleteMany({ where: { userId, groupId } });
  await prisma.cycle.deleteMany({ where: { groupId } });
});

afterAll(async () => {
  await prisma.contribution.deleteMany({ where: { userId, groupId } });
  await prisma.cycle.deleteMany({ where: { groupId } });
  await prisma.$disconnect();
});

describe('contribution cycle identifier', () => {
  it('records the cycle and scopes queries by cycleId', async () => {
    const cycle1 = await prisma.cycle.create({
      data: {
        groupId,
        cycleNumber: 1,
        starts: new Date('2024-01-01T00:00:00.000Z'),
        ends: new Date('2024-01-31T23:59:59.999Z'),
        status: 'ACTIVE',
      },
    });
    const cycle2 = await prisma.cycle.create({
      data: {
        groupId,
        cycleNumber: 2,
        starts: new Date('2024-02-01T00:00:00.000Z'),
        ends: new Date('2024-02-29T23:59:59.999Z'),
        status: 'ACTIVE',
      },
    });

    await prisma.contribution.create({
      data: {
        userId,
        groupId,
        amount: 1000,
        txHash: '0xcycle1',
        cycleId: cycle1.id,
        createdAt: new Date('2024-01-15T12:00:00.000Z'),
      },
    });
    await prisma.contribution.create({
      data: {
        userId,
        groupId,
        amount: 2000,
        txHash: '0xcycle2',
        cycleId: cycle2.id,
        createdAt: new Date('2024-02-15T12:00:00.000Z'),
      },
    });

    const cycle1Contributions = await prisma.contribution.findMany({
      where: { userId, groupId, cycleId: cycle1.id },
    });
    const cycle2Contributions = await prisma.contribution.findMany({
      where: { userId, groupId, cycleId: cycle2.id },
    });

    expect(cycle1Contributions).toHaveLength(1);
    expect(cycle1Contributions[0].amount).toBe(1000);
    expect(cycle2Contributions).toHaveLength(1);
    expect(cycle2Contributions[0].amount).toBe(2000);
  });

  it('keeps historical rows with null cycleId readable', async () => {
    const legacy = await prisma.contribution.create({
      data: {
        userId,
        groupId,
        amount: 500,
        txHash: '0xlegacy',
        createdAt: new Date('2023-12-15T12:00:00.000Z'),
      },
    });

    const found = await prisma.contribution.findUnique({ where: { id: legacy.id } });
    expect(found).not.toBeNull();
    expect(found.cycleId).toBeNull();
    expect(found.amount).toBe(500);
  });
});
