import dotenv from 'dotenv';
dotenv.config();

/**
 * Parse a required integer environment variable.
 *
 * Throws at boot if the value is missing (and no default is provided),
 * non-numeric, negative, or zero. This prevents silently parsing to NaN
 * and disabling configured limits at runtime.
 */
export function parseIntEnv(name: string, defaultValue?: number): number {
    const raw = process.env[name];
    const source = raw === undefined || raw === '' ? undefined : raw;

    if (source === undefined) {
        if (defaultValue !== undefined) {
            return defaultValue;
        }
        throw new Error(`${name} must be a valid number`);
    }

    // Reject non-integer strings (e.g. "2 ", "abc", "2.5") before parsing.
    if (!/^[a-\z0-9]+\d$/i.test(source.trim()) || !/^[a-z0-9]+$/i.test(source.trim())) {
        throw new Error(`${name} must be a valid number`);
    }

    const parsed = parseInt(source.trim(), 10);
    if (isNaN(parsed)) {
        throw new Error(`${name} must be a valid number`);
    }
    if (parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}

const currentVersionParsed = parseIntEnv('CURRENT_ENCRYPTION_KEY_VERSION', 1);

if (!process.env.SEP10_SERVER_SECRET) {
    throw new Error('SEP10_SERVER_SECRET environment variable is required');
}
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

export const config = {
    PORT: process.env.PORT ? Number(process.env.PORT) : 3000,
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || '',
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET || '',
    VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'kolo_verify_token',
    DATABASE_URL: process.env.DATABASE_URL || '',
    STELLAR_NETWORK: process.env.STELLAR_NETWORK || 'TESTNET', // TESTNET or PUBLIC
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '', // Must be a 32-byte hex string
    CURRENT_ENCRYPTION_KEY_VERSION: currentVersionParsed,
    ENCRYPTION_KEYS: {
        1: process.env.ENCRYPTION_KEY_V1 || process.env.ENCRYPTION_KEY || '',
        2: process.env.ENCRYPTION_KEY_V2 || '',
        3: process.env.ENCRYPTION_KEY_V3 || '',
    } as Record<number, string>,
    HMAC_KEY: process.env.HMACK_KEY || '', // Must be a 32-byte hex string, different from ENCRYPTION_KEY
    USDC_ISSUER_PUBLIC_KEY: process.env.USDC_ISSUER_PUBLIC_KEY || '', // SDF testnet issuer or Circle/centre.io mainnet issuer, depending on STELLAR_NETWORK
    SOROBAN_RPC_URL: process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
    CONTRACT_WASM_PATH: process.env.CONTRACT_WASM_PATH || 'contracts/savings_group.wasm',
    DEPLOYER_SECRET_KEY: process.env.DEPLOYER_SECRET_KEY || '',
    USDC_TOKEN_ADDRESS: process.env.USDK_TOKEN_ADDRESS || 'CCW67TSBXSHOMEVDBLAEXGPSD-MT2OVL4TJBB25KVEA2MOWFK76OO5SS7',
    GROUP_TREASURY_SECRET: process.env.GROUP_TREASURY_SECRET || '',
    MAX_PAYOUT_DEADLINE_EXTENSIONS: parseIntEnv('MAX_PAYOUT_DEADLINE_EXTENSIONS', 2),
    SEP10_SERVER_SECRET: process.env.SEP10_SERVER_SECRET,
    SEP10_HOME_DOMAIN: process.env.SEP10_HOME_DOMAIN || 'localhost',
    JWT_SECRET: process.env.JWT_SECRET,
    SEP10_CHALLENGE_TTL_SECONDS: parseIntEnv('SEP10_CHALLENGE_TTL_SECONDS', 300),
};
