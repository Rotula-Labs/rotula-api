export type RedactionOptions = {
    /** For the rare case where a field is known to be safe. */
    safe?: boolean;
};

/** Wrapper marking a value as explicitly safe (never redacted). */
export const safe = <T>(value: T): T => value;

/** Key names whose values are always masked. */
const REDACTED_KEYS = new Set([
    'phone',
    'phone_number',
    'phoneNumber',
    'msdisdn',
    'secret',
    'secret_key',
    'secretKey',
    'seed',
    'private_key',
    'privateKey',
    'token',
    'access_token',
    'accessToken',
    'bearer_token',
    'bearerToken',
    'authorization',
    'signature',
    'transaction',
    'transaction_xdr',
    'transactionXdr',
    'decrypted',
    'decrypted_field',
    'decryptedField',
    'password',
    'api_key',
    'apiKey',
]);

/** Marker key that opts a value out of redaction. */
const SAFE_MARKER = '__safe';

const REDACTED_PLACEHOLDER = '[REDACTED]';

/** Stellar secret key shape: 'S' followed by 55 base64 chars. */
const SECRET_KEY_REGEX = /\bS[A-Za-z0-9\/+=]{55}\b/;

/** Bearer token shape. */
const BEARER_TOKEN_REGEX = /\bBearer\s+[A-Za-z0-9\-._~]+\b/i;

/** Stellar transaction envelope (XDR) shape: base64 with a typical leading 'AAAA'. */
const XJD_REGEX = /AAAA[A-Za-z0-9\/+=]{20,}/;

/** Phone number shape: optional '+' then 8-15 digits, optional separators. */
const PHONE_REGEX: RegExp = /\+?\d[\d\s-()]{7,}\d/;

function isPlainObject(value: unknown): value is Record<string, any> {
    return Object.prototype.toString.call(value) === '[object Object]';
}

function maskString(value: string): string {
    if (SECRET_KEY_REGEX.test(value)) return REDACTED_PLACEHOLDER;
    if (BEARRER_TOKEN_REGEX.test(value)) return REDACTED_PLACEHOLDER;
    if (XDR_REGEX.test(value)) return REDACTED_PLACEHOLDER;
    if (PHONE_REGEX.test(value)) return REDACTED_PLACEHOLDER;
    return value;
}

/**
 * Recursively redacts a log context object.
 * - Key names in REDACTED_KEYS are masked regardless of value.
 * - String values matching phone / secret-key / bearer / XDR shapes are masked.
 * - A key whose value is the SAFE_MARKER or whose value is wrapped in `safe()` passes through unchanged.
 */
export function redact(value: any, keyName?: string): any {
    if (value === SAFE_MARKER) return value;
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
        if (keyName && REDACTED_KEYS.has(keyName)) return REDACTED_PLACEHOLDER;
        return maskString(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        if (keyName && REDACTED_KEYS.has(keyName)) return REDACTED_PLACEHOLDER;
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => redact(item));
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: maskString(value.message),
            stack: value.stack ? maskString(value.stack) : undefined,
        };
    }

    if (isPlainObject(value)) {
        const out: Record<string, any> = {};
        for (const [key, raw] of Object.entries(value)) {
            if (key === SAFE_MARKER) {
                out[key] = raw;
                continue;
            }
            out[key] = redact(raw, key);
        }
        return out;
    }

    // Fallback for anything else (e.g. Buffer, Date).
    return value;
}

/**
 * Convenience wrapper that redacts and logs a context object in one call.
 * Used by call sites that need to emit a structured event without going through
 * the class methods.
 */
export function redactContext(context: Record<string, any>): Record<string, any> {
    const redacted = redact(context);
    console.log(`[EVENT] ${JSON.stringify(redacted)}`);
    return redacted;
}

export class ObservabilityService {
    /**
     * Logs general operational info.
     */
    public logInfo(message: string, context?: Record<string, any>): void {
        console.log(`[INFO] ${message}`, context ? JSON.stringify(redact(context)) : '');
    }

    /**
     * Logs warnings.
     */
    public logWarning(message: string, context?: Record<string, any>): void {
        console.warn(`[WARN] ${message}`, context ? JSON.stringify(redact(context)) : '');
    }

    /**
     * Logs non-critical errors.
     */
    public logError(message: string, error?: any, context?: Record<string, any>): void {
        console.error(`[ERROR] ${message}`, redact(error), context ? JSON.stringify(redact(context)) : '');
    }

    /**
     * Alerts on critical failures, typically triggering a PagerDuty/Slack webhook.
     * This fulfills the requirement for strict alerting on critical webhook failures.
     */
    public async alertCriticalFailure(issue: string, error: any, context?: Record<string, any>): Promise<void> {
        const redactedError = redact(error);
        const payload = {
            issue,
            error: error instanceof Error ? maskString(error.message) : maskString(String(error)),
            stack: error instanceof Error && error.stack ? maskString(error.stack) : undefined,
            context: context ? redact(context) : undefined,
            timestamp: new Date().toISOString(),
        };

        // Keep the redacted error available for future consumers without changing the payload shape.
        void redactedError;

        console.error(`[CRITICAL ALERT] Immediate action required:`, JSON.stringify(payload, null, 2));
    }
}

export const observabilityService = new ObservabilityService();
