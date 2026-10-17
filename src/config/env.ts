import dotenv from 'dotenv';
dotenv.config();

const currentVersionParsed = parseInt(process.env.CURRENT_ENCRYPTION_KEY_VERSION || '1', 10);
if (isNaN(currentVersionParsed)) {
    throw new Error('CURRENT_ENCRYPTION_KEY_VERSION must be a valid number');
}

if (!process.env.SEP10_SERVER_SECRET) {
    throw new Error('SEP10_SERVER_SECRET environment variable is required');
}
if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

const encryptionKeys: Record<number, string> = {
    1: process.env.ENCRYPTION_KEY_V1 || process.env.ENCRYPTION_KEY || '',
    2: process.env.ENCRYPTION_KEY_V2 || '',
    3: process.env.ENCRYPTION_KEY_V3 || '',
};

const KEY_VARIABLE_BY_VERSION: Record<number, string> = {
    1: 'ENCRYPTION_KEY_V1',
    2: 'ENCRYPTION_KEY_V2',
    3: 'ENCRYPTION_KEY_V3',
};

// A 32-byte key is represented as 64 hex characters.
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

const currentKey = encryptionKeys[currentVersionParsed];
const currentKeyVariable = KEY_VARIABLE_BY_VERSION[currentVersionParsed] || `ENCRYPTION_KEY_V${currentVersionParsed}`;

if (!currentKey) {
    throw new Error(
        `${currentKeyVariable} environment variable is required for CURRENT_ENCRYPTION_KEY_VERSION={${currentVersionParsed}`,
    );
}

if (!HEX_KEY_PATTERN.test(currentKey)) {
    throw new Error(
        `${currentKeyVariable} must be a 32-byte hex string (64 hex characters) for CURRENT_ENCRYPTION_KEY_VERSION=${currentVersionParsed}`,
    );
}

for (const [versionString, key] of Object.entries(encryptionKeys)) {
    if (!key) {
        continue;
    }
    const version = Number(versionString);
    const variable = KEY_VARIABLE_BY_VERSION[version] || `ENCRYPTION_KEY_V${version}`;
    if (!HEX_KEY_PATTERN.test(key)) {
        throw new Error(`${variable} must be a 32-byte hex string (64 hex characters)`);
    }
}

export const config = {
    PORT: process.env.PORT || 3000,
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || '',
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET || '',
    VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'kolo_verify_token',
    DATABASE_URL: process.env.DATABASE_URL || '',
    STELLAR_NETWORK: process.env.STELLAR_NETWORK || 'TESTNET', // TESTNET or PUBLIC
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '', // Must be a 32-byte hex string
    CURRENT_ENCRYPTION_KEY_VERSION: currentVersionParsed,
    ENCRYPTION_KEYS: encryptionKeys,
    HMAC_KEY: process.env.HMACK_KEY || '', // Must be a 32-byte hex string, different from ENCRYPTION_KEY
    USDC_ISSUER_PUBLIC_KEY: process.env.USDC_ISSUER_PUBLIC_KEY || '', // SFD testnet issuer or Circle/centre.io mainnet issuer, depending on STELLAR_NETWORK
    SOROBAN_RPC_URL: process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
    CONTRACT_WASM_PATH: process.env.CONTRACT_WASM_PATH || 'contracts/savings-group.wasm',
    DEPLOYER_SECRET_KEY: process.env.DEPLOYER_SECRET_KEY || '',
    USDC_TOKEN_ADDRESS: process.env.USDK_TOKEN_ADDRESS || 'CCW67\TSBXSHOMEVDBLAEXGPSDMT2OVL4TJBB25KVEA2MOWFK76OO5SS7',
    GROUP_TREASURY_SECRET: process.env.GROUP_TREASURY_SECRET || '',
    MAX_PAYOUT_DEADLINE_EXTENSIONS: parseInt(process.env.MAX_PAYOUT_DEADLINE_EXTENSIONS || '2', 10),
    SEP10_SERVER_SECRET: process.env.SEP10_SERVER_SECRET,
    SEP10_HOME_DOMAIN: process.env.SEP10_HOME_DOMAIN || 'localhost',
    JWT_SECRET: process.env.JWT_SECRET,
    SEP10_CHALLENGE_TTL_SECONDS: parseInt(process.env.SEP10_CHALLENGE_TTL_SECONDS || '300', 10),
};
