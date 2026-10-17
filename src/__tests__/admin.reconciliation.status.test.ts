import express from 'express';
import request from 'supertest';

const findManyMock = jest.fn();

jest.mock('../lib/prisma',() => ({
  __esModule: true,
  default: {
    reconciliationMismatch: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

import adminRouter from '../routes/admin.routes';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return app;
};

describe('GET /admin/reconciliation/status', () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it('returns zero groups and totalUnresolved 0 for an empty result', async () => {
    findManyMock.mockResolvedValue([]);
    const res = await request(buildApp()).get('/admin/reconciliation/status');
    expect(res.status).toBe(200);
    expect(res.body.totalUnresolved).toBe(0);
    expect(res.body.byGroup).toEqual({});
  });

  it('groups two mismatches in the same group into one entry with mismatchCount 2', async () => {
    findManyMock.mockResolvedValue([
      { id: '1', group: 'A', resolvedAt: null },
      { id: '2', group: 'A', resolvedAt: null },
    ]);
    const res = await request(buildApp()).get('/admin/reconciliation/status');
    expect(res.status).toBe(200);
    expect(res.body.totalUnresolved).toBe(2);
    expect(Object.keys(res.body.byGroup)).toHaveLength(1);
    expect(res.body.byGroup.A.mismatchCount).toBe(2);
  });

  it('returns two entries for mismatches across two groups', async () => {
    findManyMock.mockResolvedValue([
      { id: '1', group: 'A', resolvedAt: null },
      { id: '2', group: 'B', resolvedAt: null },
    ]);
    const res = await request(buildApp()).get('/admin/reconciliation/status');
    expect(res.status).toBe(200);
    expect(res.body.totalUnresolved).toBe(2);
    expect(Object.keys(res.body.byGroup)).toHaveLength(2);
    expect(res.body.byGroup.A.mismatchCount).toBe(1);
    expect(res.body.byGroup.B.mismatchCount).toBe(1);
  });

  it('filters out resolved rows via resolvedAt: null', async () => {
    findManyMock.mockResolvedValue([]);
    await request(buildApp()).get('/admin/reconciliation/status');
    expect(findManyMock).toHaveBeenCalledTimes(1);
    const callArg = findManyMock.mock.calls[0][0];
    expect(callArg.where).toEqual(expect.objectContaining({ resolvedAt: null }));
  });
});
