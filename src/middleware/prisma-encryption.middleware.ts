import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
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

// Relation paths that lead to a User, derived from the Prisma schema at
// startup rather than a hand-maintained list. Each entry is the field name on
// the model that points at User (e.g. `user` on GroupMember, `requester` and
// `responder` on PaymentRequest). A new relation added to the schema is picked
// up automatically, so a phone filter through it is rewritten without a code
// change.
type UserRelationPaths = Map<string, Set<string>>;

function buildUserRelationPaths(): UserRelationPaths {
    const paths: UserRelationPaths = new Map();
    const models = Prisma.dmmf.datamodel.models;

    for (const model of models) {
        const userRelations = new Set<string>();
        for (const field of model.fields) {
            if (field.kind === 'object' && field.type === 'User') {
                userRelations.add(field.name);
            }
        }
        if (userRelations.size > 0) {
            paths.set(model.name, userRelations);
        }
    }

    return paths;
}

const USER_RELATION_PATHS: UserRelationPaths = buildUserRelationPaths();

// Rewrites every nested `<relation>.phoneNumber` filter where `<relation>` is a
// field on the model that points at User. Driven by the schema-derived
// USER_RELATION_PATHS map, so it covers GroupMember.user, PaymentRequest's
// requester/responder, and any relation added later.
function rewriteNestedUserFilter(
    model: string | undefined,
    where: Record<string, any> | undefined,
): Record<string, any> | undefined {
    if (!where || typeof where !== 'object' || !model) {
        return where;
    }

    const relations = USER_RELATION_PATHS.get(model);
    if (!relations) {
        return where;
    }

    let rewritten: Record<string, any> | undefined;

    for (const relation of relations) {
        const nested = where[relation];
        if (!nested || typeof nested !== 'object' || !looksLikePlaintextPhone(nested.phoneNumber)) {
            continue;
        }

        const nestedCopy = { ...nested };
        const plaintext = nestedCopy.phoneNumber;
        delete nestedCopy.phoneNumber;
        nestedCopy.phoneNumberHash = hmacPhone(plaintext);

        rewritten = rewritten ?? { ...where };
        rewritten[relation] = nestedCopy;
    }

    return rewritten ?? where;
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

export function applyEncryptionMiddleware(prismaClient: PrismaClient): void {
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
            const rewritten = isUserModel ? rewriteWhereClause(where) : rewriteNestedUserFilter(params.model, where);
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

export { buildUserRelationPaths, USER_RELATION_PATHS };
