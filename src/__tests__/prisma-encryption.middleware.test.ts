import { encryptField, hmacPhone, decryptField } from '../utils/encryption.util';
import { applyEncryptionMiddleware } from '../middleware/prisma-encryption.middleware';
import { config } from '../config/env';

const TEST_PHONE = '+2348012345678';

type Middleware = (params: any, next: (params: any) => Promise<any>) => Promise<any>;

// Captures the middleware a client registers so we can drive it with mocked
// params and a fake persistence layer.
function captureMiddleware(): { client: any; middleware: Middleware } {
    const client: any = {};
    client.$use = jest.fn((mw: Middleware) => {
        client.registered = mw;
    });
    applyEncryptionMiddleware(client);
    return { client, middleware: client.registered };
}

function isBlob(value: unknown): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    try {
        const parsed = JSON.parse(value);
        return (
            parsed !== null &&
            typeof parsed === 'object' &&
            typeof parsed.c === 'string' &&
            typeof parsed.iv === 'string' &&
            typeof parsed.tag === 'string'
        );
    } catch {
        return false;
    }
}

describe('prisma-encryption.middleware', () => {
    let originalConfig: typeof config;
    let store: Map<string, string>;
    let next: jest.Mock;

    beforeEach(() => {
        originalConfig = { ...config };
        config.ENCRYPTION_KEYS = {
            1: '1111111111111111111111111111111111111111111111111111111111111111',
            2: '2222222222222222222222222222222222222222222222222222222222222222',
        };
        config.CURRENT_ENCRYPTION_KEY_VERSION = 2;
        config.HMAC_KEY = '3333333333333333333333333333333333333333333333333333333333333333';

        store = new Map();
        // Fake User table keyed by id, storing exactly what "Prisma" would.
        next = jest.fn(async (params: any) => {
            if (params.action === 'create') {
                const row = { id: 'user-1', ...params.args.data };
                store.set(row.id, JSON.stringify(row));
                return row;
            }
            if (params.action === 'update') {
                const id = params.args.where.id as string;
                const existing = JSON.parse(store.get(id) as string);
                const updated = { ...existing, ...params.args.data };
                store.set(id, JSON.stringify(updated));
                return updated;
            }
            if (params.action === 'findUnique' || params.action === 'findFirst') {
                for (const raw of store.values()) {
                    const row = JSON.parse(raw);
                    const matches = Object.entries(params.args.where).every(([key, value]) => row[key] === value);
                    if (matches) {
                        return row;
                    }
                }
                return null;
            }
            if (params.action === 'findMany') {
                return Array.from(store.values())
                    .map(raw => JSON.parse(raw))
                    .filter(row =>
                        Object.entries(params.args?.where ?? {}).every(([key, value]) => row[key] === value)
                    );
            }
            if (params.action === 'upsert') {
                const existing = Array.from(store.values()).map(raw => JSON.parse(raw));
                const match = existing.find(row =>
                    Object.entries(params.args.where).every(([key, value]) => (row as any)[key] === value)
                );
                if (match) {
                    const updated = { ...match, ...params.args.update };
                    store.set(updated.id, JSON.stringify(updated));
                    return updated;
                }
                const created = { id: 'user-upserted', ...params.args.create };
                store.set(created.id, JSON.stringify(created));
                return created;
            }
            throw new Error(`Unhandled action in fake db: ${params.action}`);
        });
    });

    afterEach(() => {
        Object.assign(config, originalConfig);
    });

    async function run(middleware: Middleware, params: any) {
        return middleware(params, next);
    }

    describe('writes', () => {
        it('encrypts phone number on create and stores no plaintext', async () => {
            const { middleware } = captureMiddleware();

            await run(middleware, { model: 'User', action: 'create', args: { data: { username: 'kolo', phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: false });

            const rawRow = JSON.parse(Array.from(store.values())[0]);
            expect(isBlob(rawRow.phoneNumber)).toBe(true);
            expect(rawRow.phoneNumber).not.toContain(TEST_PHONE);
            expect(rawRow.phoneNumberHash).toBe(hmacPhone(TEST_PHONE));
        });

        it('returns the created user with a decrypted phone number', async () => {
            const { middleware } = captureMiddleware();

            const created = await run(middleware, { model: 'User', action: 'create', args: { data: { phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: false });

            expect(created).toMatchObject({ id: 'user-1' });
            // Write results are decrypted too — callers pass these straight to
            // WhatsApp sends, so ciphertext here would leak downstream.
            expect(created.phoneNumber).toBe(TEST_PHONE);
        });

        it('decrypts the updated row returned by update', async () => {
            const { middleware } = captureMiddleware();
            await run(middleware, { model: 'User', action: 'create', args: { data: { phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: false });

            const updated = await run(middleware, { model: 'User', action: 'update', args: { where: { id: 'user-1' }, data: { language: 'yo' } }, dataPath: [], runInTransaction: false });

            expect(updated.language).toBe('yo');
            expect(updated.phoneNumber).toBe(TEST_PHONE);
        });

        it('does not double-encrypt an already encrypted blob on update', async () => {
            const { middleware } = captureMiddleware();

            await run(middleware, { model: 'User', action: 'create', args: { data: { phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: false });

            const blob = JSON.parse(Array.from(store.values())[0]).phoneNumber;
            await run(middleware, { model: 'User', action: 'update', args: { where: { id: 'user-1' }, data: { language: 'yo' } }, dataPath: [], runInTransaction: false });
            await run(middleware, { model: 'User', action: 'update', args: { where: { id: 'user-1' }, data: { phoneNumber: blob } }, dataPath: [], runInTransaction: false });

            const rawRow = JSON.parse(Array.from(store.values())[0]);
            expect(rawRow.phoneNumber).toBe(blob); // unchanged
            expect(decryptField(rawRow.phoneNumber)).toBe(TEST_PHONE);
        });

        it('ignores non-User models entirely', async () => {
            const { middleware } = captureMiddleware();

            const result = await run(middleware, { model: 'SavingsGroup', action: 'findMany', args: { where: { phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: false });

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'SavingsGroup',
                    args: expect.objectContaining({ where: { phoneNumber: TEST_PHONE } }),
                })
            );
            void result;
        });
    });

    describe('reads', () => {
        beforeEach(async () => {
            const { middleware } = captureMiddleware();
            // Seed through the middleware itself, like production writes would be.
            await run(middleware, { model: 'User', action: 'create', args: { data: { phoneNumber: TEST_PHONE, username: 'ada' } }, dataPath: [], runInTransaction: false });
        });

        it('rewrites plaintext equality filters into hash lookups', async () => {
            const { middleware } = captureMiddleware();

            const user = await run(middleware, { model: 'User', action: 'findUnique', args: { where: { phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: false });

            expect(user).not.toBeNull();
            // The middleware decrypts results before they reach the caller.
            expect(user.phoneNumber).toBe(TEST_PHONE);
            // The fake db only matches on the hash column, proving the rewrite happened.
            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({ args: expect.objectContaining({ where: { phoneNumberHash: hmacPhone(TEST_PHONE) } }) })
            );
        });

        it('returns null when no user matches the hashed lookup', async () => {
            const { middleware } = captureMiddleware();

            const user = await run(middleware, { model: 'User', action: 'findFirst', args: { where: { phoneNumber: '+19999999999' } }, dataPath: [], runInTransaction: false });

            expect(user).toBeNull();
        });

        it('decrypts results of findMany', async () => {
            const { middleware } = captureMiddleware();

            const users = await run(middleware, { model: 'User', action: 'findMany', args: {}, dataPath: [], runInTransaction: false });

            expect(users).toHaveLength(1);
            expect(users[0].phoneNumber).toBe(TEST_PHONE);
        });

        it('rewrites nested user.phoneNumber filters used by relation queries', async () => {
            const { middleware } = captureMiddleware();

            await run(middleware, {
                model: 'GroupMember',
                action: 'findMany',
                args: { where: { user: { phoneNumber: TEST_PHONE } } },
                dataPath: [],
                runInTransaction: false,
            });

            expect(next).toHaveBeenCalledWith(
                expect.objectContaining({
                    args: expect.objectContaining({
                        where: { user: { phoneNumberHash: hmacPhone(TEST_PHONE) } },
                    }),
                })
            );
        });

        it('passes non-phone where clauses through untouched', async () => {
            const { middleware } = captureMiddleware();

            await run(middleware, { model: 'User', action: 'findFirst', args: { where: { username: 'ada' } }, dataPath: [], runInTransaction: false });

            expect(next).toHaveBeenCalledWith(expect.objectContaining({ args: expect.objectContaining({ where: { username: 'ada' } }) }));
        });
    });

    describe('transaction and raw-query bypass', () => {
        it('decrypts a user read inside a transaction callback', async () => {
            const { middleware } = captureMiddleware();
            await run(middleware, { model: 'User', action: 'create', args: { data: { phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: false });

            // Simulate prisma.$transaction(async tx => ...) where tx reuses the
            // same middleware chain. The read must still come back decrypted.
            const tx = { $use: (mw: Middleware) => mw };
            const txMiddleware = (tx as any).$use(middleware);
            const user = await txMiddleware(
                { model: 'User', action: 'findUnique', args: { where: { phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: true },
                next
            );

            expect(user).not.toBeNull();
            expect(user.phoneNumber).toBe(TEST_PHONE);
        });

        it('guards raw queries that name an encrypted column', async () => {
            const { middleware } = captureMiddleware();

            await expect(
                run(middleware, {
                    model: 'User',
                    action: '$queryRaw',
                    args: { query: 'SELECT * FROM "User" WHERE "phoneNumber" = $1', values: [TEST_PHONE] },
                    dataPath: [],
                    runInTransaction: false,
                })
            ).rejects.toThrow(/phoneNumber/);

            expect(next).not.toHaveBeenCalled();
        });

        it('guards raw execute queries that name an encrypted column', async () => {
            const { middleware } = captureMiddleware();

            await expect(
                run(middleware, {
                    model: 'User',
                    action: '$executeRaw',
                    args: { query: 'UPDATE "User" SET "phoneNumber" = $1', values: [TEST_PHONE] },
                    dataPath: [],
                    runInTransaction: false,
                })
            ).rejects.toThrow(/phoneNumber/);

            expect(next).not.toHaveBeenCalled();
        });

        it('guards raw queries that name the phone number hash column', async () => {
            const { middleware } = captureMiddleware();

            await expect(
                run(middleware, {
                    model: 'User',
                    action: '$queryRaw',
                    args: { query: 'SELECT * FROM "User" WHERE "phoneNumberHash" = $1', values: [hmacPhone(TEST_PHONE)] },
                    dataPath: [],
                    runInTransaction: false,
                })
            ).rejects.toThrow(/phoneNumberHash/);

            expect(next).not.toHaveBeenCalled();
        });

        it('allows raw queries that do not name an encrypted column', async () => {
            const { middleware } = captureMiddleware();
            next.mockResolvedValue([{ count: 0 }]);

            await run(middleware, {
                model: 'User',
                action: '$queryRaw',
                args: { query: 'SELECT COUNT(*) FROM "User"', values: [] },
                dataPath: [],
                runInTransaction: false,
            });

            expect(next).toHaveBeenCalled();
        });
    });

    describe('performance', () => {
        it('keeps encrypted lookups well under the latency budget', async () => {
            const { middleware } = captureMiddleware();
            await run(middleware, { model: 'User', action: 'create', args: { data: { phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: false });

            const start = Date.now();
            for (let i = 0; i < 50; i += 1) {
                await run(middleware, { model: 'User', action: 'findUnique', args: { where: { phoneNumber: TEST_PHONE } }, dataPath: [], runInTransaction: false });
            }
            const elapsed = Date.now() - start;

            // 50 encrypted lookups should complete fast; generous budget to
            // avoid faking on slow CI machines.
            expect(elapsed).toBeLessThan(5000);
        });
    });
});
