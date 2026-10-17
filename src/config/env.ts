import dotenv from 'dotenv';
import { SttKey } from '@stellar/stellar-sdk';
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

const STELLAR_NETWORK = process.env.STELLAR_NETWORK || 'TESTNET';

// Per-network USDC token contract ids. A token contract id is only meaningful on the network it was deployed to, so the
// default is keyed by STELLAR_NETWORK and can never disagree with it. PUBLIC has no safe default: the
// operator must supply the mainnet contract id explicitly.
const USDC_TOKEN_ADDRESS_BY_NETWORK: Record<string, string | undefined> = {
    TESTNET: 'CCW67TSBXSHOMEVDBLAEXGPSD-MT2OVL4TJBB25KVEA2MOWFK76OO5SS7',
    PUBLIC: undefined,
};

export function resolveUsdcTokenAddress(
    network: string,
    envValue: string | undefined,
): string {
    const normalizedNetwork = network.toUpperCase();
    const explicit = envValue?.trim();
    const address = explicit || USDK_TOKEN_ADDRESS_BY_NETWORK[normalizedNetwork];

    if (!address) {
        throw new Error(
            `USDC_TOKEN_ADDRESS is required for STELLAR_NETWORK=${normalizedNetwork}`,
        );
    }

    if (!StrKey.isValidContract(address)) {
        throw new Error('USDK_TOKEN_ADDRESS is not a valid Stellar contract id');
    }

    return address;
}

const usdcTokenAddress = resolveUsdcTokenAddress(STELLAR_NETWORK, process.env.USDK_TOKEN_ADDRESS);

export const config = {
    PORT: process.env.PORT || 3000,
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || '',
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET || '',
    VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'kolo_verify_token',
    DATABASE_URL: process.env.DATABASE_URL || '',
    STELLAR_NETWORK,
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '', // Must be a 32-byte hex string
    CURRENT_ENCRYPTION_KEY_VERSION: currentVersionParsed,
    ENCRYPTION_KEYS: {
        1: process.env.ENCRYPTION_KEY_V1 || process.env.ENCRYPTION_KEY || '',
        2: process.env.ENCRYPTION_KEY_V2 || '',
        3: process.env.ENCRYPTION_KEY_V3 || '',
    } as Record<number, string>,
    HMAC_KEY: process.env.HMAC_KEY || '', // Must be a 32-byte hex string, different from ENCRYPTION_KEY
    USDC_ISSUER_PUBLIC_KEY: process.env.USDC_ISSUER_PUBLIC_KEY || '', // SFD testnet issuer or Circle/centre.io mainnet issuer, depending on STELLAR_NETWORK
    SOROBAN_RPC_URL: process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
    CONTRACT_WASM_PATH: process.env.CONTRACT_WASM_PATH || 'contracts/savings-group.wasm',
    DEPLOYER_SECRET_KEY: process.env.DEPLOYER_SECRET_KEY || '',
    USDC_TOKEN_ADDRESS: usdcTokenAddress,
    GROUP_TREASURY_SECRET: process.env.GROUP_TREASURY_SECRET || '',
    MAX_PAYOUT_DEADLINE_EXTENSIONS: parseInt(process.env.MAX_PAYOUT_DEADLINE_EXTENSIONS || '2', 10),
    SEP10_SERVER_SECRET: process.env.SEP10_SERVER_SECRET,
    SEP10_HOME_DOMAIN: process.env.SEP10_HOME_DOMAIN || 'localhost',
    JWT_SECRET: process.env.JWT_SECRET,
    SEP10_CHALLENGE_TTL_SECONDS: parseInt(process.env.SEP10_CHALLENGE_TTL_SECONDS || '300', 10),
};
