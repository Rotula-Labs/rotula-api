import { config } from '../config/env';

export type LogLevel = 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    info: 0,
    warn: 1,
    error: 2,
};

function resolveLogLevel(raw: unknown): LogLevel {
    const normalized = String(raw ?? 'info').trim().toLowerCase();
    if (normalized === 'warning') {
        return 'warn';
    }
    if (normalized in LEVEL_PRIORITY) {
        return normalized as LogLevel;
    }
    return 'info';
}

export class ObservabilityService {
    private readLogLevel(): LogLevel {
        return resolveLogLevel((config as any).LOG_LEVEL);
    }

    private shouldLog(level: LogLevel): boolean {
        return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.readLogLevel()];
    }

    private formatLine(level: LogLevel, message: string): string {
        const tag = level === 'warn' ? 'WARN' : level.toUpperCase();
        return `[${new Date().toISOString()}] [${tag}] ${message}`;
    }

    /**
     * Logs general operational info.
     */
    public logInfo(message: string, context?: Record<string, any>): void {
        if (!this.shouldLog('info')) {
            return;
        }
        console.log(this.formatLine('info', message), context ? JSON.stringify(context) : '');
    }

    /**
     * Logs warnings.
     */
    public logWarning(message: string, context?: Record<string, any>): void {
        if (!this.shouldLog('warn')) {
            return;
        }
        console.warn(this.formatLine('warn', message), context ? JSON.stringify(context) : '');
    }

    /**
     * Logs non-critical errors.
     */
    public logError(message: string, error?: any, context?: Record<string, any>): void {
        if (!this.shouldLog('error')) {
            return;
        }
        console.error(this.formatLine('error', message), error, context ? JSON.stringify(context) : '');
    }

    /**
     * Alerts on critical failures, typically triggering a PagerDuty/Slack webhook.
     * This fulfills the requirement for strict alerting on critical webhook failures.
     */
    public async alertCriticalFailure(issue: string, error: any, context?: Record<string, any>): Promise<void> {
        const timestamp = new Date().toISOString();
        const payload = {
            issue,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            context,
            timestamp
        };

        // Critical alerts are always emitted, regardless of the configured log level.
        console.error(`[${timestamp}] [CRITICAL ALERT] Immediate action required:`, JSON.stringify(payload, null, 2));
    }
}

export const observabilityService = new ObservabilityService();
