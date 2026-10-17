/**
 * Guarded access to the `User.stellarWallet` JSON blob.
 *
 * The column is nullable text (see prisma/schema.prisma), so a historical row
 * can be missing, truncated, written in the pre-encryption format (a bare
 * public key), or simply hold something that is not JSON. A bare JSON.parse()
 * in a handler turns any of those into a SyntaxError that escapes to the
 * top-level catch and is reported to the user as an internal error.
 *
 * Every handler reads the column through parseStellarWallet() so that an
 * unreadable blob is a known, user-facing condition instead of a crash.
 */

/** Canonical shape of a row written by the wallet provisioning flow. */
export interface StellarWalletBlob {
    publicKey: string;
    encryptedSecret: string;
    iv: string;
    authTag: string;
    keyVersion?: number;
}

export type WalletParseResult =
    /** No wallet has been stored for this user (NULL/empty column). */
    | { status: 'absent' }
    /** Something is stored, but it is not a usable wallet blob. */
    | { status: 'unreadable' }
    /** The blob parsed and carries the fields handlers need. */
    | { status: 'ok'; wallet: StellarWalletBlob };

const REQUIRED_FIELDS = ['publicKey', 'encryptedSecret', 'iv', 'authTag'] as const;

/**
 * Parses a `stellarWallet` value without ever throwing.
 *
 * Returns `absent` only when the column is genuinely empty; anything that
 * cannot be turned into a complete wallet blob is reported as `unreadable`.
 */
export function parseStellarWallet(raw: string | null | undefined): WalletParseResult {
    if (raw === null || raw === undefined || raw.trim() === '') {
        return { status: 'absent' };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { status: 'unreadable' };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { status: 'unreadable' };
    }

    const candidate = parsed as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
        const value = candidate[field];
        if (typeof value !== 'string' || value.trim() === '') {
            return { status: 'unreadable' };
        }
    }

    // keyVersion is optional and only meaningful when it is a number; a
    // non-numeric value is ignored so the caller falls back to the user's
    // encryptionKeyVersion instead of failing the whole lookup.
    const keyVersion = typeof candidate.keyVersion === 'number' ? candidate.keyVersion : undefined;

    return {
        status: 'ok',
        wallet: {
            publicKey: candidate.publicKey as string,
            encryptedSecret: candidate.encryptedSecret as string,
            iv: candidate.iv as string,
            authTag: candidate.authTag as string,
            keyVersion,
        },
    };
}
