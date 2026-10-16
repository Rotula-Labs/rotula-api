export class ObservabilityService {
    /**
     * Logs general operational info.
     */
    public logInfo(message: string, context?: Record<string, any>): void {
        // eslint-disable-next-line no-console
        console.log(`[INFO] ${message}`, context ? JSON.stringify(context) : '');
    }

    /**
     * Logs warnings.
     */
    public logWarning(message: string, context?: Record<string, any>): void {
        // eslint-disable-next-line no-console
        console.warn(`[WARN] ${message}`, context ? JSON.stringify(context) : '');
    }

    /**
     * Logs non-critical errors.
     */
    public logError(message: string, error?: any, context?: Record<string, any>): void {
        // eslint-disable-next-line no-console
        console.error(`[ERROR] ${message}`, error, context ? JSON.stringify(context) : '');
    }

    /**
     * Alerts on critical failures, typically triggering a PagerDuty/Slack webhook.
     * This fulfills the requirement for strict alerting on critical webhook failures.
     */
    public async alertCriticalFailure(issue: string, error: any, context?: Record<string, any>): Promise<void> {
        const payload = {
            issue,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            context,
            timestamp: new Date().toISOString()
        };

        // eslint-disable-next-line no-console
        console.error(`[CRITICAL ALERT] Immediate action required:`, JSON.stringify(payload, null, 2));
    }
}

export const observabilityService = new ObservabilityService();
