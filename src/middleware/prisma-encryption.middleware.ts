// @ts-nocheck
/**
 * ⚠️  ENCRYPTION BOUNDARY — READ BEFORE EDITING ⚠️
 *
 * This middleware encrypts `User.phoneNumber` (and keeps `phoneNumberHash` in
 * sync for lookups) for the Prisma model actions listed in `PrismaAction`.
 * It does NOT cover every access path. The following paths BYPASS encryption
 * and MUST NOT be used to read or write encrypted fields:
 *
 *   1. `prisma.$transaction(async (tx) => ...)` — the interactive
 *      transaction client (`tx`) is a distinct client and does NOT run this
 *      middleware. Any `tx.user.create/update/find*` call writes or returns
 *      PLAINTEXT `phoneNumber` values. Use the top-level client for encrypted
 *      fields, or wrap the whole operation in a single top-level call.
 *
 *   2. `prisma.$queryRaw` / `prisma.$executeRaw` (and their `Unsafe` /
 *      `Typed` variants) — raw SQL is passed through untouched. Selecting or
 *      inserting `phoneNumber` via raw SQL reads/writes ciphertext directly
 *      and skips HMAC derivation, corrupting lookups.
 *
 * To make the raw-query escape hatch loud rather than silent, this module
 * installs a guard (see `installRawQueryGuard`) that throws when a raw query
 * string names an encrypted column. The guard is best-effort (it inspects the
 * SQL text) and is NOT a substitute for the rule above: do not name encrypted
 * columns in raw queries at all.
 *
 * If you need transactional semantics over encrypted fields, extend this
 * middleware to the transactional client and add a regression test asserting
 * that a transaction reading a user returns a DECRYPTED phone number.
 */
import { PrismaClient } from '@prisma/client';
import { encryptField, decryptField, isEncryptedFieldBlob, hmacPhone } from '../utils/encryption.util';

type PrismaAction =
    | 'create'
    | 'createMany'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'findMany'
    | 'count'
    | 'aggregate'
    | 'groupBy';

const WRITE_ACTIONS: PrismaAction[] = ['create', 'createMany', 'update', 'updateMany', 'upsert'];
// Writes return the affected rows, which now carry ciphertext — they must be
// decrypted before the caller sees them, same as reads.
const RESULT_ACTIONS: PrismaAction[] = [
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'create',
    'update',
    'upsert',
];

// Columns whose values are stored as ciphertext (or derived from plaintext)
// and therefore must never appear in raw SQL. Matched case-insensitively as
// whole identifiers so `phoneNumberHash` is caught too.
const ENCRYPTED_COLUMNS = ['phoneNumber', 'phoneNumberHash'];

function rawQueryNamesEncryptedColumn(query: unknown): string | null {
    if (typeof query === 'string') {
        for (const column of ENCRYPTED_COLUMNS) {
            const pattern = new RegExp(`\\b${column}\\b`, 'i');
            if (pattern.test(query)) {
                return column;
            }
        }
        return null;
    }

    // Tagged-template form: $queryRaw`... ${value} ...` arrives as a
    // TemplateStringsArray followed by the interpolated values.
    if (Array.isArray(query)) {
        for (const chunk of query) {
            const hit = rawQueryNamesEncryptedColumn(chunk);
            if (hit) {
                return hit;
            }
        }
    }

    return null;
}

function looksLikePlaintextPhone(value: unknown): value is string {
    // Encrypted values are JSON blobs starting with '{'; anything else that
    // reaches a phone-number field is treated as plaintext input.
    return typeof value === 'string' && !isEncryptedFieldBlob(value);
}

// Rewrites every `phoneNumber` equality filter into its HMAC equivalent so
// callers can keep querying with plaintext. Handles both top-level
// `where.phoneNumber` and nested `where.user.phoneNumber` filters.
function rewriteWhereClause(where: Record<string, any> | undefined): Record<string, any> | undefined {
    if (!where || typeof where !== 'object') {
        return where;
    }

    const rewritten = { ...where };

    if (looksLikePlaintextPhone(rewritten.phoneNumber)) {
        rewritten.phoneNumberHash = hmacPhone(rewritten.phoneNumber);
        delete rewritten.phoneNumber;
    }

    return rewritten;
}

// Rewrites only the nested `user.phoneNumber` filter, for relation queries on
// models like GroupMember. Top-level phone filters are handled by
// rewriteWhereClause for the User model itself.
function rewriteNestedUserFilter(where: Record<string, any> | undefined): Record<string, any> | undefined {
    if (!where || typeof where !== 'object' || !looksLikePlaintextPhone(where.user?.phoneNumber)) {
        return where;
    }

    const nested = { ...where.user };
    delete nested.phoneNumber;

    return {
        ...where,
        user: { ...nested, phoneNumberHash: hmacPhone(where.user.phoneNumber) },
    };
}

// Encrypts a plaintext `data.phoneNumber` value and derives the lookup hash.
function encryptDataPayload(data: Record<string, any>): Record<string, any> {
    const payload = { ...data };

    if (looksLikePlaintextPhone(payload.phoneNumber)) {
        const phoneNumber = payload.phoneNumber;
        payload.phoneNumber = encryptField(phoneNumber);
        payload.phoneNumberHash = hmacPhone(phoneNumber);
    }

    return payload;
}

// Values that must never be copied or recursed into during decryption.
function isOpaqueValue(value: any): boolean {
    return (
        value instanceof Date ||
        Buffer.isBuffer(value) ||
        typeof value?.toFixed === 'function' && typeof value?.dp === 'function' // Prisma Decimal
    );
}

// Recursively decrypts phone numbers on query results before they reach the
// caller. Traverses relations and arrays so nested user objects (e.g.
// GroupMember rows including their user) come back readable too.
function decryptResult(result: any): any {
    if (result === null || result === undefined) {
        return result;
    }

    if (Array.isArray(result)) {
        return result.map(decryptResult);
    }

    if (typeof result === 'object') {
        if (isOpaqueValue(result)) {
            return result;
        }

        const copy: Record<string, any> = {};
        let changed = false;

        for (const [key, value] of Object.entries(result)) {
            if (typeof value === 'string' && isEncryptedFieldBlob(value)) {
                try {
                    copy[key] = decryptField(value);
                    changed = true;
                } catch (err) {
                    console.error(`Failed to decrypt encrypted field '${key}':`, err);
                    copy[key] = value;
                }
                continue;
            }

            if (value !== null && typeof value === 'object' && !isOpaqueValue(value)) {
                const decryptedChild = decryptResult(value);
                copy[key] = decryptedChild;
                if (decryptedChild !== value) {
                    changed = true;
                }
                continue;
            }

            copy[key] = value;
        }

        // Preserve object identity when nothing was decrypted.
        return changed ? copy : result;
    }

    return result;
}

// Fails loudly when a raw query names an encrypted column. Raw SQL bypasses
// this middleware entirely, so the only safe behaviour is to refuse.
function installRawQueryGuard(prismaClient: PrismaClient): void {
    const rawMethods = ['$queryRaw', '$queryRawUnsafe', '$executeRaw', '$executeRawUnsafe'] as const;

    for (const method of rawMethods) {
        const original = (prismaClient as any)[method];
        if (typeof original !== 'function') {
            continue;
        }

        (prismaClient as any)[method] = function guardedRawQuery(this: unknown, ...args: unknown[]) {
            for (const arg of args) {
                const column = rawQueryNamesEncryptedColumn(arg);
                if (column) {
                    throw new Error(
                        `Refusing ${method}: raw queries must not reference encrypted column '${column}'. ` +
                            'Use the Prisma model API (which runs the encryption middleware) instead.',
                    );
                }
            }
            return original.apply(this, args);
        };
    }
}

export function applyEncryptionMiddleware(prismaClient: PrismaClient): void {
    installRawQueryGuard(prismaClient);

    prismaClient.$use(async (params, next) => {
        const isUserModel = params.model === 'User';
        const action = params.action as PrismaAction;

        if (isUserModel && WRITE_ACTIONS.includes(action) && params.args) {
            if (action === 'upsert') {
                // Upsert splits its payload across create/update instead of data.
                if (params.args.create) {
                    params.args.create = encryptDataPayload(params.args.create);
                }
                if (params.args.update) {
                    params.args.update = encryptDataPayload(params.args.update);
                }
                params.args.where = rewriteWhereClause(params.args.where);
            } else if (params.args.data) {
                params.args = { ...params.args, data: encryptDataPayload(params.args.data) };
            }
        }

        if (params.args?.where && action !== 'create') {
            const where = params.args.where;
            const rewritten = isUserModel ? rewriteWhereClause(where) : rewriteNestedUserFilter(where);
            params.args = { ...params.args, where: rewritten };
        }

        const result = await next(params);

        // Relation reads (e.g. GroupMember with include: { user: true }) also
        // carry encrypted phone numbers, and writes return the stored rows —
        // so result decryption is not limited to the User model.
        if (RESULT_ACTIONS.includes(action)) {
            return decryptResult(result);
        }

        return result;
    });
}

